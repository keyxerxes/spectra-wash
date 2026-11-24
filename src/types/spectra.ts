export type PresetKey = 'stealth' | 'balanced' | 'maximum' | 'custom';

export type OutputFormat = 'png' | 'webp';

export type ViewportMode = 'split' | 'diff' | 'mask' | 'processed';

export interface PipelineConfig {
  // Stage 1: Sub-Pixel Non-Linear Mesh Warping
  meshEnabled: boolean;
  meshAmplitude: number; // 0.0 - 2.5 px (typical 0.8 - 1.5)
  meshWavelength: number; // 140 - 400 px (typical 200 - 350)
  meshSeed: number;

  // Stage 2: Texture-Adaptive JND Luminance Processing
  jndEnabled: boolean;
  bilateralStrength: number; // 0.0 - 1.0 (flat region Y-channel smoothing)
  textureSigma: number; // 0.0 - 2.5 (typical 0.5 - 1.5)
  edgeThreshold: number; // 8 - 45 (local variance/gradient transition)

  // Stage 3: Fractional Affine + Micro-Contrast Recovery
  affineEnabled: boolean;
  rotationDeg: number; // 0.0 - 0.8 deg (typical 0.3)
  resampler: 'lanczos3' | 'bicubic';
  unsharpRadius: number; // 0.4 - 1.6 px (typical 0.8)
  unsharpAmount: number; // 0.0 - 0.6 (typical 0.25)

  // Stage 4: Metadata & Format
  outputFormat: OutputFormat;
  webpQuality: number; // 0.96 - 1.0
}

export const PRESETS: Record<Exclude<PresetKey, 'custom'>, {
  label: string;
  summary: string;
  config: PipelineConfig;
}> = {
  stealth: {
    label: 'Stealth',
    summary: 'Imperceptible sub-pixel shift and JND-masked luminance floor (PSNR > 42 dB).',
    config: {
      meshEnabled: true,
      meshAmplitude: 0.85,
      meshWavelength: 320,
      meshSeed: 4109,
      jndEnabled: true,
      bilateralStrength: 0.35,
      textureSigma: 0.65,
      edgeThreshold: 22,
      affineEnabled: false,
      rotationDeg: 0.15,
      resampler: 'lanczos3',
      unsharpRadius: 0.8,
      unsharpAmount: 0.18,
      outputFormat: 'png',
      webpQuality: 1.0,
    },
  },
  balanced: {
    label: 'Balanced',
    summary: 'Full 4-stage pipeline with 0.3° affine auto-crop, JND luminance, and unsharp recovery.',
    config: {
      meshEnabled: true,
      meshAmplitude: 1.15,
      meshWavelength: 260,
      meshSeed: 7331,
      jndEnabled: true,
      bilateralStrength: 0.55,
      textureSigma: 1.05,
      edgeThreshold: 18,
      affineEnabled: true,
      rotationDeg: 0.3,
      resampler: 'lanczos3',
      unsharpRadius: 0.8,
      unsharpAmount: 0.25,
      outputFormat: 'png',
      webpQuality: 1.0,
    },
  },
  maximum: {
    label: 'Maximum',
    summary: 'Aggressive multi-axis phase disruption and stronger textured JND perturbation.',
    config: {
      meshEnabled: true,
      meshAmplitude: 1.5,
      meshWavelength: 205,
      meshSeed: 9283,
      jndEnabled: true,
      bilateralStrength: 0.8,
      textureSigma: 1.5,
      edgeThreshold: 14,
      affineEnabled: true,
      rotationDeg: 0.45,
      resampler: 'lanczos3',
      unsharpRadius: 0.9,
      unsharpAmount: 0.32,
      outputFormat: 'png',
      webpQuality: 1.0,
    },
  },
};

export interface MetadataChunk {
  id: string;
  type: string;
  category: 'critical' | 'exif' | 'xmp' | 'iptc' | 'c2pa' | 'text' | 'color' | 'ancillary';
  offset: number;
  size: number;
  summary: string;
  rawSnippet?: string;
  flagged: boolean;
}

export interface DetectedSignature {
  vendor: string;
  tag: string;
  category: 'C2PA Content Credentials' | 'AI Provenance Marker' | 'Generator Parameters' | 'Editing Software';
  severity: 'high' | 'medium' | 'info';
  evidence: string;
}

export interface ForensicReport {
  containerFormat: 'PNG' | 'JPEG' | 'WEBP' | 'UNKNOWN';
  fileSizeBytes: number;
  totalChunks: number;
  metadataChunksCount: number;
  chunks: MetadataChunk[];
  signatures: DetectedSignature[];
  status: 'ai-signatures-detected' | 'metadata-present' | 'clean';
  hasC2PA: boolean;
  hasExif: boolean;
  hasXmp: boolean;
  hasIptc: boolean;
}

export interface RadialProfilePoint {
  freq: number; // 0.0 to 0.5 cycles/px
  original: number; // log-power normalized
  processed: number; // log-power normalized
}

export interface SpectralAnalysis {
  fftSize: number;
  originalSpectrumRgba: Uint8ClampedArray;
  processedSpectrumRgba: Uint8ClampedArray;
  radialProfile: RadialProfilePoint[];
  originalAnomalyRatio: number; // Peak-to-median high-freq ratio (dB above floor)
  processedAnomalyRatio: number;
  hfEnergyDeltaPct: number; // % shift in high-frequency band energy
  peakSuppressionPct: number; // % reduction in narrowband periodic peak excess
}

export interface QualityMetrics {
  psnr: number;
  ssim: number;
  mae: number;
  maxChannelDiff: number;
  flatRegionPct: number;
  texturedRegionPct: number;
  processingMs: number;
}

export interface WorkerRequest {
  type: 'process';
  jobId: number;
  width: number;
  height: number;
  rgbaBuffer: ArrayBuffer;
  config: PipelineConfig;
}

export interface WorkerProgressMessage {
  type: 'progress';
  jobId: number;
  stage: number;
  label: string;
  percent: number;
}

export interface WorkerResultMessage {
  type: 'result';
  jobId: number;
  width: number;
  height: number;
  processedRgba: ArrayBuffer;
  diffMagnitude: ArrayBuffer; // Uint8Array per pixel (0..255 raw max channel diff)
  maskRgba: ArrayBuffer;
  metrics: QualityMetrics;
  spectral: {
    fftSize: number;
    originalSpectrumRgba: ArrayBuffer;
    processedSpectrumRgba: ArrayBuffer;
    radialProfile: RadialProfilePoint[];
    originalAnomalyRatio: number;
    processedAnomalyRatio: number;
    hfEnergyDeltaPct: number;
    peakSuppressionPct: number;
  };
}

export interface WorkerErrorMessage {
  type: 'error';
  jobId: number;
  message: string;
}

export type WorkerResponse = WorkerProgressMessage | WorkerResultMessage | WorkerErrorMessage;
