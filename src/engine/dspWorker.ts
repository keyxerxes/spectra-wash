import type {
  PipelineConfig,
  QualityMetrics,
  RadialProfilePoint,
  WorkerRequest,
  WorkerResponse,
} from '../types/spectra';

interface WorkerScope {
  onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null;
  postMessage: (message: WorkerResponse, transfer?: Transferable[]) => void;
}

const ctx = self as unknown as WorkerScope;

function postProgress(jobId: number, stage: number, label: string, percent: number) {
  const msg: WorkerResponse = { type: 'progress', jobId, stage, label, percent };
  ctx.postMessage(msg);
}

function clampByte(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : Math.round(v);
}

function clampIndex(i: number, max: number): number {
  return i < 0 ? 0 : i > max ? max : i;
}

/** Deterministic fast PRNG (Mulberry32) */
function createRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Box-Muller zero-mean unit-variance Gaussian sample */
function gaussianNoise(rng: () => number): number {
  let u1 = rng();
  const u2 = rng();
  if (u1 < 1e-7) u1 = 1e-7;
  return Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
}

/** Catmull-Rom / Keys bicubic weight (a = -0.5) */
function cubicWeight(t: number): number {
  const x = Math.abs(t);
  if (x <= 1) {
    return (1.5 * x - 2.5) * x * x + 1.0;
  }
  if (x < 2) {
    return ((-0.5 * x + 2.5) * x - 4.0) * x + 2.0;
  }
  return 0;
}

/** Lanczos-3 kernel weight */
function lanczos3Weight(t: number): number {
  const x = Math.abs(t);
  if (x < 1e-6) return 1.0;
  if (x >= 3.0) return 0.0;
  const pix = Math.PI * x;
  const pix3 = pix / 3.0;
  return (Math.sin(pix) / pix) * (Math.sin(pix3) / pix3);
}

/** Sample RGB at fractional (sx, sy) with 4x4 Keys Bicubic interpolation */
function sampleBicubic(
  src: Uint8ClampedArray,
  width: number,
  height: number,
  sx: number,
  sy: number,
  outRgb: Float32Array,
  outOffset: number,
) {
  const x0 = Math.floor(sx);
  const y0 = Math.floor(sy);
  const fx = sx - x0;
  const fy = sy - y0;

  const wx0 = cubicWeight(fx + 1);
  const wx1 = cubicWeight(fx);
  const wx2 = cubicWeight(fx - 1);
  const wx3 = cubicWeight(fx - 2);

  const wy0 = cubicWeight(fy + 1);
  const wy1 = cubicWeight(fy);
  const wy2 = cubicWeight(fy - 1);
  const wy3 = cubicWeight(fy - 2);

  const wxs = [wx0, wx1, wx2, wx3];
  const wys = [wy0, wy1, wy2, wy3];

  const maxX = width - 1;
  const maxY = height - 1;

  let r = 0;
  let g = 0;
  let b = 0;
  let wSum = 0;

  for (let j = -1; j <= 2; j++) {
    const wy = wys[j + 1];
    const py = clampIndex(y0 + j, maxY) * width;
    for (let i = -1; i <= 2; i++) {
      const w = wy * wxs[i + 1];
      const idx = (py + clampIndex(x0 + i, maxX)) << 2;
      r += src[idx] * w;
      g += src[idx + 1] * w;
      b += src[idx + 2] * w;
      wSum += w;
    }
  }

  const inv = wSum !== 0 ? 1.0 / wSum : 1.0;
  outRgb[outOffset] = r * inv;
  outRgb[outOffset + 1] = g * inv;
  outRgb[outOffset + 2] = b * inv;
}

/** Sample RGB at fractional (sx, sy) with 6x6 Lanczos-3 interpolation */
function sampleLanczos3(
  src: Uint8ClampedArray,
  width: number,
  height: number,
  sx: number,
  sy: number,
  outRgb: Float32Array,
  outOffset: number,
) {
  const x0 = Math.floor(sx);
  const y0 = Math.floor(sy);
  const fx = sx - x0;
  const fy = sy - y0;

  const wxs = [
    lanczos3Weight(fx + 2),
    lanczos3Weight(fx + 1),
    lanczos3Weight(fx),
    lanczos3Weight(fx - 1),
    lanczos3Weight(fx - 2),
    lanczos3Weight(fx - 3),
  ];
  const wys = [
    lanczos3Weight(fy + 2),
    lanczos3Weight(fy + 1),
    lanczos3Weight(fy),
    lanczos3Weight(fy - 1),
    lanczos3Weight(fy - 2),
    lanczos3Weight(fy - 3),
  ];

  const maxX = width - 1;
  const maxY = height - 1;

  let r = 0;
  let g = 0;
  let b = 0;
  let wSum = 0;

  for (let j = -2; j <= 3; j++) {
    const wy = wys[j + 2];
    const py = clampIndex(y0 + j, maxY) * width;
    for (let i = -2; i <= 3; i++) {
      const w = wy * wxs[i + 2];
      const idx = (py + clampIndex(x0 + i, maxX)) << 2;
      r += src[idx] * w;
      g += src[idx + 1] * w;
      b += src[idx + 2] * w;
      wSum += w;
    }
  }

  const inv = wSum !== 0 ? 1.0 / wSum : 1.0;
  outRgb[outOffset] = r * inv;
  outRgb[outOffset + 1] = g * inv;
  outRgb[outOffset + 2] = b * inv;
}

/**
 * STAGE 1: Sub-Pixel Non-Linear Mesh Warping
 * Dual-axis sinusoidal spatial displacement with Keys Bicubic interpolation.
 */
function runStage1MeshWarp(
  src: Uint8ClampedArray,
  width: number,
  height: number,
  config: PipelineConfig,
): Uint8ClampedArray {
  if (!config.meshEnabled || config.meshAmplitude <= 0.001) {
    return new Uint8ClampedArray(src);
  }

  const out = new Uint8ClampedArray(src.length);
  const rng = createRng(config.meshSeed ^ 0x51a7);
  const phi1 = rng() * Math.PI * 2;
  const phi2 = rng() * Math.PI * 2;
  const phi3 = rng() * Math.PI * 2;
  const phi4 = rng() * Math.PI * 2;

  const amp = config.meshAmplitude;
  const lamX = Math.max(80, config.meshWavelength);
  const lamY = Math.max(80, config.meshWavelength * 0.91);
  const twoPi = Math.PI * 2;

  // Precompute 1D sinusoids for dramatic speedup
  const sinY1 = new Float32Array(height);
  const sinY2 = new Float32Array(height);
  for (let y = 0; y < height; y++) {
    sinY1[y] = Math.sin((twoPi * y) / lamY + phi1);
    sinY2[y] = Math.sin((twoPi * y) / (lamY * 1.37) + phi4);
  }

  const sinX1 = new Float32Array(width);
  const sinX2 = new Float32Array(width);
  for (let x = 0; x < width; x++) {
    sinX1[x] = Math.sin((twoPi * x) / lamX + phi3);
    sinX2[x] = Math.sin((twoPi * x) / (lamX * 1.37) + phi2);
  }

  const tmp = new Float32Array(3);

  for (let y = 0; y < height; y++) {
    const dyBase = 0.35 * amp * sinY2[y];
    const dxBase = amp * sinY1[y];
    const row = y * width;

    for (let x = 0; x < width; x++) {
      const sx = x + dxBase + 0.35 * amp * sinX2[x];
      const sy = y + amp * sinX1[x] + dyBase;

      sampleBicubic(src, width, height, sx, sy, tmp, 0);
      const idx = (row + x) << 2;
      out[idx] = clampByte(tmp[0]);
      out[idx + 1] = clampByte(tmp[1]);
      out[idx + 2] = clampByte(tmp[2]);
      out[idx + 3] = src[idx + 3];
    }
  }

  return out;
}

/**
 * STAGE 2: Texture-Adaptive JND Luminance Processing
 * YCbCr conversion + 3x3 variance/Sobel mask + flat Y bilateral + textured Y Gaussian perturbation.
 */
function runStage2JndLuminance(
  src: Uint8ClampedArray,
  width: number,
  height: number,
  config: PipelineConfig,
): {
  rgba: Uint8ClampedArray;
  maskRgba: Uint8ClampedArray;
  flatPct: number;
  texturedPct: number;
} {
  const n = width * height;
  const yChan = new Float32Array(n);
  const cbChan = new Float32Array(n);
  const crChan = new Float32Array(n);

  // BT.709 RGB -> YCbCr
  for (let i = 0; i < n; i++) {
    const idx = i << 2;
    const r = src[idx];
    const g = src[idx + 1];
    const b = src[idx + 2];
    const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    yChan[i] = y;
    cbChan[i] = (b - y) * 0.5389;
    crChan[i] = (r - y) * 0.6350;
  }

  // Build local 3x3 variance + Sobel gradient texture mask in [0, 1]
  const mask = new Float32Array(n);
  const maskRgba = new Uint8ClampedArray(n * 4);
  const thresh = Math.max(4, config.edgeThreshold);
  let flatCount = 0;
  let texturedCount = 0;

  for (let y = 0; y < height; y++) {
    const ym1 = clampIndex(y - 1, height - 1) * width;
    const y0 = y * width;
    const yp1 = clampIndex(y + 1, height - 1) * width;

    for (let x = 0; x < width; x++) {
      const xm1 = clampIndex(x - 1, width - 1);
      const xp1 = clampIndex(x + 1, width - 1);

      const p00 = yChan[ym1 + xm1];
      const p01 = yChan[ym1 + x];
      const p02 = yChan[ym1 + xp1];
      const p10 = yChan[y0 + xm1];
      const p11 = yChan[y0 + x];
      const p12 = yChan[y0 + xp1];
      const p20 = yChan[yp1 + xm1];
      const p21 = yChan[yp1 + x];
      const p22 = yChan[yp1 + xp1];

      const mean = (p00 + p01 + p02 + p10 + p11 + p12 + p20 + p21 + p22) / 9.0;
      const variance =
        ((p00 - mean) ** 2 +
          (p01 - mean) ** 2 +
          (p02 - mean) ** 2 +
          (p10 - mean) ** 2 +
          (p11 - mean) ** 2 +
          (p12 - mean) ** 2 +
          (p20 - mean) ** 2 +
          (p21 - mean) ** 2 +
          (p22 - mean) ** 2) /
        9.0;
      const stdDev = Math.sqrt(variance);

      // Sobel edge gradient magnitude
      const gx = -p00 + p02 - 2 * p10 + 2 * p12 - p20 + p22;
      const gy = -p00 - 2 * p01 - p02 + p20 + 2 * p21 + p22;
      const grad = Math.sqrt(gx * gx + gy * gy) * 0.25;

      const activity = stdDev * 1.35 + grad * 0.45;
      // Smooth sigmoid-like ramp centered on edgeThreshold
      const norm = Math.max(0, Math.min(1, (activity - thresh * 0.35) / (thresh * 1.35)));
      const smooth = norm * norm * (3 - 2 * norm);

      const i = y0 + x;
      mask[i] = smooth;
      if (smooth < 0.35) flatCount++;
      else texturedCount++;

      // Render forensic mask preview: deep zinc (#0b0e14) for flat, cyan (#06b6d4) -> amber for high texture
      const mIdx = i << 2;
      if (smooth < 0.72) {
        const t = smooth / 0.72;
        maskRgba[mIdx] = Math.round(11 + t * (6 - 11));
        maskRgba[mIdx + 1] = Math.round(14 + t * (182 - 14));
        maskRgba[mIdx + 2] = Math.round(20 + t * (212 - 20));
      } else {
        const t = (smooth - 0.72) / 0.28;
        maskRgba[mIdx] = Math.round(6 + t * (245 - 6));
        maskRgba[mIdx + 1] = Math.round(182 + t * (158 - 182));
        maskRgba[mIdx + 2] = Math.round(212 + t * (11 - 212));
      }
      maskRgba[mIdx + 3] = 255;
    }
  }

  if (!config.jndEnabled) {
    return {
      rgba: new Uint8ClampedArray(src),
      maskRgba,
      flatPct: (flatCount / n) * 100,
      texturedPct: (texturedCount / n) * 100,
    };
  }

  const yOut = new Float32Array(n);
  const rng = createRng(config.meshSeed ^ 0x9e3779b9);

  // Spatial weights for 3x3 bilateral kernel (sigma_s = 1.15)
  const spCenter = 1.0;
  const spOrtho = Math.exp(-1.0 / (2 * 1.15 * 1.15));
  const spDiag = Math.exp(-2.0 / (2 * 1.15 * 1.15));
  const invTwoSigmaR2 = 1.0 / (2 * 11.5 * 11.5);

  const bilateralStr = Math.max(0, Math.min(1, config.bilateralStrength));
  const sigma = Math.max(0, config.textureSigma);

  for (let y = 0; y < height; y++) {
    const ym1 = clampIndex(y - 1, height - 1) * width;
    const y0 = y * width;
    const yp1 = clampIndex(y + 1, height - 1) * width;

    for (let x = 0; x < width; x++) {
      const i = y0 + x;
      const yc = yChan[i];
      const m = mask[i]; // 0 = flat, 1 = high texture

      let yVal = yc;

      // 1) Flat regions: edge-preserving Y-only bilateral smoothing
      if (bilateralStr > 0.001 && m < 0.85) {
        const xm1 = clampIndex(x - 1, width - 1);
        const xp1 = clampIndex(x + 1, width - 1);

        let wSum = spCenter;
        let acc = yc * spCenter;

        const addNeighbor = (val: number, spW: number) => {
          const d = val - yc;
          const w = spW * Math.exp(-(d * d) * invTwoSigmaR2);
          wSum += w;
          acc += val * w;
        };

        addNeighbor(yChan[ym1 + xm1], spDiag);
        addNeighbor(yChan[ym1 + x], spOrtho);
        addNeighbor(yChan[ym1 + xp1], spDiag);
        addNeighbor(yChan[y0 + xm1], spOrtho);
        addNeighbor(yChan[y0 + xp1], spOrtho);
        addNeighbor(yChan[yp1 + xm1], spDiag);
        addNeighbor(yChan[yp1 + x], spOrtho);
        addNeighbor(yChan[yp1 + xp1], spDiag);

        const smoothY = acc / wSum;
        const flatBlend = (1.0 - m) * bilateralStr;
        yVal = yc + (smoothY - yc) * flatBlend;
      }

      // 2) High-texture regions: micro Gaussian luminance perturbation weighted by JND
      if (sigma > 0.001 && m > 0.05) {
        // Subtle Weber luminance adaptation: slightly higher JND tolerance in shadows/highlights
        const lumFactor = 0.85 + 0.3 * Math.abs((yc - 128) / 128);
        const noise = gaussianNoise(rng) * sigma * m * lumFactor;
        yVal += noise;
      }

      yOut[i] = yVal < 0 ? 0 : yVal > 255 ? 255 : yVal;
    }
  }

  // Inverse BT.709 YCbCr -> RGB (Cb and Cr untouched)
  const out = new Uint8ClampedArray(src.length);
  for (let i = 0; i < n; i++) {
    const idx = i << 2;
    const y = yOut[i];
    const cb = cbChan[i];
    const cr = crChan[i];
    out[idx] = clampByte(y + 1.5748 * cr);
    out[idx + 1] = clampByte(y - 0.1873 * cb - 0.4681 * cr);
    out[idx + 2] = clampByte(y + 1.8556 * cb);
    out[idx + 3] = src[idx + 3];
  }

  return {
    rgba: out,
    maskRgba,
    flatPct: (flatCount / n) * 100,
    texturedPct: (texturedCount / n) * 100,
  };
}

/**
 * STAGE 3A: Single-pass Fractional Rotation + Inscribed Auto-Crop + Lanczos-3 / Bicubic Rescale
 */
function runStage3Affine(
  src: Uint8ClampedArray,
  width: number,
  height: number,
  config: PipelineConfig,
): Uint8ClampedArray {
  if (!config.affineEnabled || Math.abs(config.rotationDeg) < 0.005) {
    return new Uint8ClampedArray(src);
  }

  const out = new Uint8ClampedArray(src.length);
  const rad = (config.rotationDeg * Math.PI) / 180.0;
  const cosA = Math.cos(rad);
  const sinA = Math.sin(rad);
  const absSin = Math.abs(sinA);
  const absCos = Math.abs(cosA);

  // Closed-form inscribed rectangle scale factor ensuring zero empty border pixels
  const aspectMax = Math.max(width / height, height / width);
  const cropScale = absCos + aspectMax * absSin;
  const invScale = 1.0 / cropScale;

  const cx = (width - 1) * 0.5;
  const cy = (height - 1) * 0.5;
  const tmp = new Float32Array(3);
  const useLanczos = config.resampler === 'lanczos3';

  for (let y = 0; y < height; y++) {
    const dy = (y - cy) * invScale;
    const row = y * width;
    for (let x = 0; x < width; x++) {
      const dx = (x - cx) * invScale;
      const sx = cx + dx * cosA + dy * sinA;
      const sy = cy - dx * sinA + dy * cosA;

      if (useLanczos) {
        sampleLanczos3(src, width, height, sx, sy, tmp, 0);
      } else {
        sampleBicubic(src, width, height, sx, sy, tmp, 0);
      }

      const idx = (row + x) << 2;
      out[idx] = clampByte(tmp[0]);
      out[idx + 1] = clampByte(tmp[1]);
      out[idx + 2] = clampByte(tmp[2]);
      out[idx + 3] = src[idx + 3];
    }
  }

  return out;
}

/**
 * STAGE 3B: Micro-Contrast Recovery via Separable Gaussian Unsharp Mask
 */
function runStage3UnsharpMask(
  src: Uint8ClampedArray,
  width: number,
  height: number,
  radius: number,
  amount: number,
): Uint8ClampedArray {
  if (amount <= 0.005 || radius <= 0.05) {
    return src;
  }

  const kernelRadius = Math.max(1, Math.min(4, Math.ceil(radius * 2.5)));
  const kSize = kernelRadius * 2 + 1;
  const kernel = new Float32Array(kSize);
  const twoSigma2 = 2.0 * radius * radius;
  let kSum = 0;
  for (let k = -kernelRadius; k <= kernelRadius; k++) {
    const w = Math.exp(-(k * k) / twoSigma2);
    kernel[k + kernelRadius] = w;
    kSum += w;
  }
  for (let i = 0; i < kSize; i++) kernel[i] /= kSum;

  const n = width * height;
  const tmpR = new Float32Array(n);
  const tmpG = new Float32Array(n);
  const tmpB = new Float32Array(n);

  // Horizontal pass
  const maxX = width - 1;
  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      for (let k = -kernelRadius; k <= kernelRadius; k++) {
        const w = kernel[k + kernelRadius];
        const idx = (row + clampIndex(x + k, maxX)) << 2;
        r += src[idx] * w;
        g += src[idx + 1] * w;
        b += src[idx + 2] * w;
      }
      const p = row + x;
      tmpR[p] = r;
      tmpG[p] = g;
      tmpB[p] = b;
    }
  }

  // Vertical pass + unsharp recombination
  const out = new Uint8ClampedArray(src.length);
  const maxY = height - 1;
  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      let br = 0;
      let bg = 0;
      let bb = 0;
      for (let k = -kernelRadius; k <= kernelRadius; k++) {
        const w = kernel[k + kernelRadius];
        const p = clampIndex(y + k, maxY) * width + x;
        br += tmpR[p] * w;
        bg += tmpG[p] * w;
        bb += tmpB[p] * w;
      }
      const idx = (row + x) << 2;
      out[idx] = clampByte(src[idx] + amount * (src[idx] - br));
      out[idx + 1] = clampByte(src[idx + 1] + amount * (src[idx + 1] - bg));
      out[idx + 2] = clampByte(src[idx + 2] + amount * (src[idx + 2] - bb));
      out[idx + 3] = src[idx + 3];
    }
  }

  return out;
}

/**
 * Compute PSNR, windowed 8x8 SSIM, MAE, Max Channel Diff, and raw per-pixel diff magnitude.
 */
function computeQualityAndDiff(
  orig: Uint8ClampedArray,
  proc: Uint8ClampedArray,
  width: number,
  height: number,
): {
  psnr: number;
  ssim: number;
  mae: number;
  maxChannelDiff: number;
  diffMagnitude: Uint8Array;
} {
  const n = width * height;
  const diffMagnitude = new Uint8Array(n);
  let sumSqErr = 0;
  let sumAbsErr = 0;
  let maxDiff = 0;

  const yOrig = new Float32Array(n);
  const yProc = new Float32Array(n);

  for (let i = 0; i < n; i++) {
    const idx = i << 2;
    const dr = Math.abs(orig[idx] - proc[idx]);
    const dg = Math.abs(orig[idx + 1] - proc[idx + 1]);
    const db = Math.abs(orig[idx + 2] - proc[idx + 2]);

    sumSqErr += dr * dr + dg * dg + db * db;
    sumAbsErr += dr + dg + db;

    const localMax = dr > dg ? (dr > db ? dr : db) : dg > db ? dg : db;
    if (localMax > maxDiff) maxDiff = localMax;
    diffMagnitude[i] = localMax;

    yOrig[i] = 0.2126 * orig[idx] + 0.7152 * orig[idx + 1] + 0.0722 * orig[idx + 2];
    yProc[i] = 0.2126 * proc[idx] + 0.7152 * proc[idx + 1] + 0.0722 * proc[idx + 2];
  }

  const mse = sumSqErr / (n * 3);
  const psnr = mse < 1e-9 ? 99.9 : 10 * Math.log10((255 * 255) / mse);
  const mae = sumAbsErr / (n * 3);

  // Windowed 8x8 SSIM across luminance plane
  const C1 = (0.01 * 255) ** 2;
  const C2 = (0.03 * 255) ** 2;
  let ssimSum = 0;
  let blockCount = 0;

  for (let by = 0; by + 8 <= height; by += 8) {
    for (let bx = 0; bx + 8 <= width; bx += 8) {
      let meanX = 0;
      let meanY = 0;
      for (let dy = 0; dy < 8; dy++) {
        const row = (by + dy) * width + bx;
        for (let dx = 0; dx < 8; dx++) {
          meanX += yOrig[row + dx];
          meanY += yProc[row + dx];
        }
      }
      meanX /= 64;
      meanY /= 64;

      let varX = 0;
      let varY = 0;
      let covXY = 0;
      for (let dy = 0; dy < 8; dy++) {
        const row = (by + dy) * width + bx;
        for (let dx = 0; dx < 8; dx++) {
          const ux = yOrig[row + dx] - meanX;
          const uy = yProc[row + dx] - meanY;
          varX += ux * ux;
          varY += uy * uy;
          covXY += ux * uy;
        }
      }
      varX /= 63;
      varY /= 63;
      covXY /= 63;

      const num = (2 * meanX * meanY + C1) * (2 * covXY + C2);
      const den = (meanX * meanX + meanY * meanY + C1) * (varX + varY + C2);
      ssimSum += num / den;
      blockCount++;
    }
  }

  const ssim = blockCount > 0 ? Math.max(0, Math.min(1, ssimSum / blockCount)) : 1.0;

  return { psnr, ssim, mae, maxChannelDiff: maxDiff, diffMagnitude };
}

/** In-place iterative Cooley-Tukey Radix-2 1D FFT */
function fft1D(re: Float64Array, im: Float64Array) {
  const n = re.length;
  // Bit-reversal permutation
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) {
      j ^= bit;
    }
    j ^= bit;
    if (i < j) {
      let t = re[i];
      re[i] = re[j];
      re[j] = t;
      t = im[i];
      im[i] = im[j];
      im[j] = t;
    }
  }

  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2.0 * Math.PI) / len;
    const wLenRe = Math.cos(ang);
    const wLenIm = Math.sin(ang);
    const half = len >> 1;

    for (let i = 0; i < n; i += len) {
      let wRe = 1.0;
      let wIm = 0.0;
      for (let j = 0; j < half; j++) {
        const uRe = re[i + j];
        const uIm = im[i + j];
        const vRe = re[i + j + half] * wRe - im[i + j + half] * wIm;
        const vIm = re[i + j + half] * wIm + im[i + j + half] * wRe;

        re[i + j] = uRe + vRe;
        im[i + j] = uIm + vIm;
        re[i + j + half] = uRe - vRe;
        im[i + j + half] = uIm - vIm;

        const nextWRe = wRe * wLenRe - wIm * wLenIm;
        wIm = wRe * wLenIm + wIm * wLenRe;
        wRe = nextWRe;
      }
    }
  }
}

/**
 * Compute centered 256x256 2D High-Pass Luminance FFT log-magnitude spectrum.
 */
function compute2DHighPassSpectrum(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  N: number,
): Float64Array {
  // Center-crop (or mirror-sample if image < N) luminance patch
  const lum = new Float64Array(N * N);
  const startX = Math.max(0, Math.floor((width - N) / 2));
  const startY = Math.max(0, Math.floor((height - N) / 2));

  for (let y = 0; y < N; y++) {
    const sy = Math.min(height - 1, startY + (y % height));
    const srcRow = sy * width;
    const dstRow = y * N;
    for (let x = 0; x < N; x++) {
      const sx = Math.min(width - 1, startX + (x % width));
      const idx = (srcRow + sx) << 2;
      lum[dstRow + x] = 0.2126 * rgba[idx] + 0.7152 * rgba[idx + 1] + 0.0722 * rgba[idx + 2];
    }
  }

  // 1D Hann window
  const hann = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    hann[i] = 0.5 * (1.0 - Math.cos((2.0 * Math.PI * i) / (N - 1)));
  }

  // High-pass residual (pixel - 3x3 local mean) * 2D Hann window to expose mid/high freq carriers
  const re = new Float64Array(N * N);
  const im = new Float64Array(N * N);

  for (let y = 0; y < N; y++) {
    const ym1 = Math.max(0, y - 1) * N;
    const y0 = y * N;
    const yp1 = Math.min(N - 1, y + 1) * N;
    const hy = hann[y];
    for (let x = 0; x < N; x++) {
      const xm1 = Math.max(0, x - 1);
      const xp1 = Math.min(N - 1, x + 1);
      const localAvg =
        (lum[ym1 + xm1] +
          lum[ym1 + x] +
          lum[ym1 + xp1] +
          lum[y0 + xm1] +
          lum[y0 + x] +
          lum[y0 + xp1] +
          lum[yp1 + xm1] +
          lum[yp1 + x] +
          lum[yp1 + xp1]) /
        9.0;
      re[y0 + x] = (lum[y0 + x] - localAvg) * hy * hann[x];
    }
  }

  // Row FFTs
  const rowRe = new Float64Array(N);
  const rowIm = new Float64Array(N);
  for (let y = 0; y < N; y++) {
    const offset = y * N;
    rowRe.set(re.subarray(offset, offset + N));
    rowIm.fill(0);
    fft1D(rowRe, rowIm);
    re.set(rowRe, offset);
    im.set(rowIm, offset);
  }

  // Column FFTs
  const colRe = new Float64Array(N);
  const colIm = new Float64Array(N);
  for (let x = 0; x < N; x++) {
    for (let y = 0; y < N; y++) {
      colRe[y] = re[y * N + x];
      colIm[y] = im[y * N + x];
    }
    fft1D(colRe, colIm);
    for (let y = 0; y < N; y++) {
      re[y * N + x] = colRe[y];
      im[y * N + x] = colIm[y];
    }
  }

  // Centered fftShift log-magnitude spectrum
  const half = N >> 1;
  const shiftedLogMag = new Float64Array(N * N);
  for (let y = 0; y < N; y++) {
    const sy = (y + half) & (N - 1);
    for (let x = 0; x < N; x++) {
      const sx = (x + half) & (N - 1);
      const srcIdx = y * N + x;
      const mag = Math.sqrt(re[srcIdx] * re[srcIdx] + im[srcIdx] * im[srcIdx]) / N;
      shiftedLogMag[sy * N + sx] = Math.log1p(mag * 4.0);
    }
  }

  return shiftedLogMag;
}

/** Render 2D log-spectrum into scientific Obsidian -> Cyan -> Amber-White RGBA */
function renderSpectrumRgba(logMag: Float64Array, N: number, minVal: number, maxVal: number): Uint8ClampedArray {
  const rgba = new Uint8ClampedArray(N * N * 4);
  const span = Math.max(1e-6, maxVal - minVal);

  for (let i = 0; i < N * N; i++) {
    const t = Math.max(0, Math.min(1, (logMag[i] - minVal) / span));
    // Gamma curve for crisp anomaly peak legibility
    const v = Math.pow(t, 0.88);
    let r = 0;
    let g = 0;
    let b = 0;

    if (v < 0.35) {
      const k = v / 0.35;
      r = 9 + k * (8 - 9);
      g = 11 + k * (46 - 11);
      b = 16 + k * (72 - 16);
    } else if (v < 0.72) {
      const k = (v - 0.35) / 0.37;
      r = 8 + k * (6 - 8);
      g = 46 + k * (182 - 46);
      b = 72 + k * (212 - 72);
    } else if (v < 0.9) {
      const k = (v - 0.72) / 0.18;
      r = 6 + k * (245 - 6);
      g = 182 + k * (158 - 182);
      b = 212 + k * (11 - 212);
    } else {
      const k = (v - 0.9) / 0.1;
      r = 245 + k * (255 - 245);
      g = 158 + k * (248 - 158);
      b = 11 + k * (225 - 11);
    }

    const idx = i << 2;
    rgba[idx] = clampByte(r);
    rgba[idx + 1] = clampByte(g);
    rgba[idx + 2] = clampByte(b);
    rgba[idx + 3] = 255;
  }

  return rgba;
}

/**
 * Analyze both 2D spectra: shared normalization, azimuthal radial profiles,
 * high-frequency energy shift, and narrowband periodic anomaly peak suppression.
 */
function analyzeSpectra(
  origRgba: Uint8ClampedArray,
  procRgba: Uint8ClampedArray,
  width: number,
  height: number,
) {
  const N = 256;
  const origSpec = compute2DHighPassSpectrum(origRgba, width, height, N);
  const procSpec = compute2DHighPassSpectrum(procRgba, width, height, N);

  // Shared dynamic range (99.85 percentile cap so bright peaks pop clearly)
  let maxVal = 0;
  let minVal = Infinity;
  for (let i = 0; i < N * N; i++) {
    if (origSpec[i] > maxVal) maxVal = origSpec[i];
    if (procSpec[i] > maxVal) maxVal = procSpec[i];
    if (origSpec[i] < minVal) minVal = origSpec[i];
    if (procSpec[i] < minVal) minVal = procSpec[i];
  }

  const originalSpectrumRgba = renderSpectrumRgba(origSpec, N, minVal, maxVal);
  const processedSpectrumRgba = renderSpectrumRgba(procSpec, N, minVal, maxVal);

  // 48-bin azimuthal radial frequency profile from DC (0) to Nyquist (0.5 cycles/px)
  const bins = 48;
  const half = N >> 1;
  const origSum = new Float64Array(bins);
  const procSum = new Float64Array(bins);
  const origMaxBin = new Float64Array(bins);
  const procMaxBin = new Float64Array(bins);
  const counts = new Uint32Array(bins);

  let origHfEnergy = 0;
  let procHfEnergy = 0;

  for (let y = 0; y < N; y++) {
    const dy = y - half;
    for (let x = 0; x < N; x++) {
      const dx = x - half;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist >= half) continue;

      const bin = Math.min(bins - 1, Math.floor((dist / half) * bins));
      const idx = y * N + x;
      const ov = origSpec[idx];
      const pv = procSpec[idx];

      origSum[bin] += ov;
      procSum[bin] += pv;
      if (ov > origMaxBin[bin]) origMaxBin[bin] = ov;
      if (pv > procMaxBin[bin]) procMaxBin[bin] = pv;
      counts[bin]++;

      // High-frequency watermark band (0.14 to 0.46 cycles/px, excluding cardinal DC cross)
      if (dist > half * 0.24 && Math.abs(dx) > 3 && Math.abs(dy) > 3) {
        origHfEnergy += ov;
        procHfEnergy += pv;
      }
    }
  }

  const radialProfile: RadialProfilePoint[] = [];
  let origPeakExcess = 0;
  let procPeakExcess = 0;
  let peakBinCount = 0;

  for (let b = 0; b < bins; b++) {
    const c = Math.max(1, counts[b]);
    const oMean = origSum[b] / c;
    const pMean = procSum[b] / c;
    const freq = ((b + 0.5) / bins) * 0.5;
    radialProfile.push({
      freq: Number(freq.toFixed(4)),
      original: Number(oMean.toFixed(4)),
      processed: Number(pMean.toFixed(4)),
    });

    // Narrowband anomaly peak ratio in mid-high frequency band (0.12..0.46 cycles/px)
    if (freq >= 0.12 && freq <= 0.46) {
      origPeakExcess += origMaxBin[b] / Math.max(0.05, oMean);
      procPeakExcess += procMaxBin[b] / Math.max(0.05, pMean);
      peakBinCount++;
    }
  }

  const originalAnomalyRatio = peakBinCount > 0 ? origPeakExcess / peakBinCount : 1.0;
  const processedAnomalyRatio = peakBinCount > 0 ? procPeakExcess / peakBinCount : 1.0;
  const hfEnergyDeltaPct =
    origHfEnergy > 1e-6 ? ((procHfEnergy - origHfEnergy) / origHfEnergy) * 100 : 0;

  const origExcessAboveBase = Math.max(0.01, originalAnomalyRatio - 1.0);
  const procExcessAboveBase = Math.max(0.01, processedAnomalyRatio - 1.0);
  const peakSuppressionPct = Math.max(
    -99,
    Math.min(99.9, ((origExcessAboveBase - procExcessAboveBase) / origExcessAboveBase) * 100),
  );

  return {
    fftSize: N,
    originalSpectrumRgba,
    processedSpectrumRgba,
    radialProfile,
    originalAnomalyRatio,
    processedAnomalyRatio,
    hfEnergyDeltaPct,
    peakSuppressionPct,
  };
}

ctx.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const req = event.data;
  if (req.type !== 'process') return;

  const { jobId, width, height, rgbaBuffer, config } = req;
  const t0 = performance.now();

  try {
    const originalRgba = new Uint8ClampedArray(rgbaBuffer);

    postProgress(jobId, 1, 'Stage 1: Sub-pixel bicubic mesh warping', 15);
    const stage1 = runStage1MeshWarp(originalRgba, width, height, config);

    postProgress(jobId, 2, 'Stage 2: Texture-adaptive YCbCr JND luminance', 42);
    const stage2 = runStage2JndLuminance(stage1, width, height, config);

    postProgress(jobId, 3, 'Stage 3: Fractional affine rescale & unsharp recovery', 68);
    const stage3Affine = runStage3Affine(stage2.rgba, width, height, config);
    const stage3Final = runStage3UnsharpMask(
      stage3Affine,
      width,
      height,
      config.unsharpRadius,
      config.unsharpAmount,
    );

    postProgress(jobId, 4, 'Stage 4: Computing 2D FFT spectrum, PSNR & SSIM', 88);
    const { psnr, ssim, mae, maxChannelDiff, diffMagnitude } = computeQualityAndDiff(
      originalRgba,
      stage3Final,
      width,
      height,
    );
    const spectral = analyzeSpectra(originalRgba, stage3Final, width, height);

    const processingMs = Math.round(performance.now() - t0);
    const metrics: QualityMetrics = {
      psnr,
      ssim,
      mae,
      maxChannelDiff,
      flatRegionPct: stage2.flatPct,
      texturedRegionPct: stage2.texturedPct,
      processingMs,
    };

    const result: WorkerResponse = {
      type: 'result',
      jobId,
      width,
      height,
      processedRgba: stage3Final.buffer as ArrayBuffer,
      diffMagnitude: diffMagnitude.buffer as ArrayBuffer,
      maskRgba: stage2.maskRgba.buffer as ArrayBuffer,
      metrics,
      spectral: {
        fftSize: spectral.fftSize,
        originalSpectrumRgba: spectral.originalSpectrumRgba.buffer as ArrayBuffer,
        processedSpectrumRgba: spectral.processedSpectrumRgba.buffer as ArrayBuffer,
        radialProfile: spectral.radialProfile,
        originalAnomalyRatio: spectral.originalAnomalyRatio,
        processedAnomalyRatio: spectral.processedAnomalyRatio,
        hfEnergyDeltaPct: spectral.hfEnergyDeltaPct,
        peakSuppressionPct: spectral.peakSuppressionPct,
      },
    };

    ctx.postMessage(result, [
      result.processedRgba,
      result.diffMagnitude,
      result.maskRgba,
      result.spectral.originalSpectrumRgba,
      result.spectral.processedSpectrumRgba,
    ]);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'DSP worker execution error';
    const errMsg: WorkerResponse = { type: 'error', jobId, message };
    ctx.postMessage(errMsg);
  }
};
