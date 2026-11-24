/**
 * Converts per-pixel raw max-channel difference magnitudes (0..255) into a
 * calibrated Obsidian -> Deep Blue -> Cyan -> Amber -> Rose amplified heatmap.
 */
export function buildDiffHeatmapRgba(
  diffMagnitude: Uint8Array,
  gain: number,
): Uint8ClampedArray {
  const n = diffMagnitude.length;
  const out = new Uint8ClampedArray(n * 4);

  for (let i = 0; i < n; i++) {
    const amplified = Math.min(255, diffMagnitude[i] * gain);
    const t = amplified / 255;

    let r = 9;
    let g = 9;
    let b = 12;

    if (t <= 0.02) {
      r = 9;
      g = 10;
      b = 14;
    } else if (t < 0.35) {
      const k = (t - 0.02) / 0.33;
      r = 9 + k * (8 - 9);
      g = 10 + k * (94 - 10);
      b = 14 + k * (138 - 14);
    } else if (t < 0.65) {
      const k = (t - 0.35) / 0.3;
      r = 8 + k * (6 - 8);
      g = 94 + k * (182 - 94);
      b = 138 + k * (212 - 138);
    } else if (t < 0.85) {
      const k = (t - 0.65) / 0.2;
      r = 6 + k * (245 - 6);
      g = 182 + k * (158 - 182);
      b = 212 + k * (11 - 212);
    } else {
      const k = (t - 0.85) / 0.15;
      r = 245 + k * (244 - 245);
      g = 158 + k * (63 - 158);
      b = 11 + k * (94 - 11);
    }

    const idx = i << 2;
    out[idx] = Math.round(r);
    out[idx + 1] = Math.round(g);
    out[idx + 2] = Math.round(b);
    out[idx + 3] = 255;
  }

  return out;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}
