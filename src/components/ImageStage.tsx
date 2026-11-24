import { useEffect, useRef, useState } from 'react';
import { Columns2, Flame, Layers, Maximize2, Minimize2, Sparkles, Upload } from 'lucide-react';
import { buildDiffHeatmapRgba, formatBytes } from '../engine/heatmapLut';
import type {
  ForensicReport,
  QualityMetrics,
  SpectralAnalysis,
  ViewportMode,
} from '../types/spectra';

interface ImageStageProps {
  filename: string;
  width: number;
  height: number;
  originalUrl: string | null;
  processedUrl: string | null;
  diffMagnitude: Uint8Array | null;
  maskRgba: Uint8ClampedArray | null;
  metrics: QualityMetrics | null;
  spectral: SpectralAnalysis | null;
  originalForensics: ForensicReport | null;
  washedForensics: ForensicReport | null;
  isProcessing: boolean;
  onFileDrop: (file: File) => void;
}

export function ImageStage({
  filename,
  width,
  height,
  originalUrl,
  processedUrl,
  diffMagnitude,
  maskRgba,
  metrics,
  spectral,
  originalForensics,
  washedForensics,
  isProcessing,
  onFileDrop,
}: ImageStageProps) {
  const [viewMode, setViewMode] = useState<ViewportMode>('split');
  const [splitPos, setSplitPos] = useState(50);
  const [diffGain, setDiffGain] = useState<5 | 10 | 20>(10);
  const [zoom100, setZoom100] = useState(false);
  const [isDraggingSplit, setIsDraggingSplit] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [hoverCoord, setHoverCoord] = useState<{ x: number; y: number } | null>(null);

  const stageRef = useRef<HTMLDivElement | null>(null);
  const diffCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const maskCanvasRef = useRef<HTMLCanvasElement | null>(null);

  // Render dynamic amplified pixel-diff heatmap whenever mode/gain/data updates
  useEffect(() => {
    if (viewMode !== 'diff' || !diffMagnitude || !diffCanvasRef.current || width === 0 || height === 0) {
      return;
    }
    const canvas = diffCanvasRef.current;
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const rgba = buildDiffHeatmapRgba(diffMagnitude, diffGain);
    const imgData = new ImageData(new Uint8ClampedArray(rgba), width, height);
    ctx.putImageData(imgData, 0, 0);
  }, [viewMode, diffMagnitude, diffGain, width, height]);

  // Render JND texture mask whenever mode/data updates
  useEffect(() => {
    if (viewMode !== 'mask' || !maskRgba || !maskCanvasRef.current || width === 0 || height === 0) {
      return;
    }
    const canvas = maskCanvasRef.current;
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const imgData = new ImageData(new Uint8ClampedArray(maskRgba), width, height);
    ctx.putImageData(imgData, 0, 0);
  }, [viewMode, maskRgba, width, height]);

  const updateSplitFromClientX = (clientX: number) => {
    if (!stageRef.current) return;
    const rect = stageRef.current.getBoundingClientRect();
    if (rect.width <= 0) return;
    const pct = ((clientX - rect.left) / rect.width) * 100;
    setSplitPos(Math.max(1, Math.min(99, pct)));
  };

  const handleStageMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (stageRef.current && width > 0 && height > 0) {
      const rect = stageRef.current.getBoundingClientRect();
      const nx = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      const ny = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
      setHoverCoord({
        x: Math.round(nx * (width - 1)),
        y: Math.round(ny * (height - 1)),
      });
    }
    if (isDraggingSplit && viewMode === 'split') {
      updateSplitFromClientX(e.clientX);
    }
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (viewMode !== 'split') return;
    e.currentTarget.setPointerCapture(e.pointerId);
    setIsDraggingSplit(true);
    updateSplitFromClientX(e.clientX);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDraggingSplit || viewMode !== 'split') return;
    updateSplitFromClientX(e.clientX);
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (isDraggingSplit) {
      e.currentTarget.releasePointerCapture(e.pointerId);
      setIsDraggingSplit(false);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = () => {
    setIsDragOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file && file.type.startsWith('image/')) {
      onFileDrop(file);
    }
  };

  const modeTabs: Array<{ id: ViewportMode; label: string; icon: typeof Columns2 }> = [
    { id: 'split', label: 'Split Compare', icon: Columns2 },
    { id: 'diff', label: `${diffGain}× Diff Heatmap`, icon: Flame },
    { id: 'mask', label: 'JND Mask', icon: Layers },
    { id: 'processed', label: 'Clean Output', icon: Sparkles },
  ];

  const strippedCount = originalForensics ? originalForensics.metadataChunksCount : 0;
  const residualCount = washedForensics ? washedForensics.metadataChunksCount : 0;

  return (
    <div className="flex min-w-0 flex-1 flex-col bg-[#09090b]">
      {/* Viewport Mode Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-800 px-4 py-3 sm:px-6">
        <div
          role="tablist"
          aria-label="Viewport visualization modes"
          className="flex flex-wrap items-center gap-1 rounded-md border border-zinc-800 bg-zinc-950 p-1"
        >
          {modeTabs.map((tab) => {
            const Icon = tab.icon;
            const active = viewMode === tab.id;
            return (
              <button
                key={tab.id}
                role="tab"
                type="button"
                aria-selected={active}
                onClick={() => setViewMode(tab.id)}
                className={`inline-flex cursor-pointer items-center gap-1.5 whitespace-nowrap rounded px-2.5 py-1.5 text-xs font-medium transition-colors ${
                  active
                    ? 'bg-zinc-800 text-cyan-300'
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                {tab.label}
              </button>
            );
          })}
        </div>

        {/* Right Contextual Controls */}
        <div className="flex items-center gap-4 text-xs text-zinc-400">
          {viewMode === 'diff' && (
            <div className="flex items-center gap-1.5">
              <span className="text-zinc-500">Gain</span>
              <div className="inline-flex rounded border border-zinc-800 bg-zinc-950 p-0.5">
                {([5, 10, 20] as const).map((g) => (
                  <button
                    key={g}
                    type="button"
                    onClick={() => setDiffGain(g)}
                    className={`cursor-pointer rounded px-2 py-0.5 font-mono text-[11px] tabular-nums transition-colors ${
                      diffGain === g
                        ? 'bg-zinc-800 text-amber-400'
                        : 'text-zinc-500 hover:text-zinc-300'
                    }`}
                  >
                    {g}×
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="hidden items-center gap-2 font-mono text-[11px] tabular-nums text-zinc-500 sm:flex">
            <span className="max-w-[180px] truncate text-zinc-300">{filename}</span>
            <span aria-hidden="true">·</span>
            <span>
              {width}×{height}
            </span>
            {originalForensics && (
              <>
                <span aria-hidden="true">·</span>
                <span>{formatBytes(originalForensics.fileSizeBytes)}</span>
              </>
            )}
          </div>

          <button
            type="button"
            onClick={() => setZoom100((z) => !z)}
            title={zoom100 ? 'Fit image to stage' : 'Inspect at 1:1 native pixels'}
            className="inline-flex h-8 cursor-pointer items-center gap-1.5 whitespace-nowrap rounded border border-zinc-800 bg-zinc-900 px-2.5 font-mono text-[11px] text-zinc-300 transition-colors hover:border-zinc-700 hover:text-zinc-100"
          >
            {zoom100 ? (
              <>
                <Minimize2 className="h-3.5 w-3.5" aria-hidden="true" />
                Fit
              </>
            ) : (
              <>
                <Maximize2 className="h-3.5 w-3.5" aria-hidden="true" />
                100%
              </>
            )}
          </button>
        </div>
      </div>

      {/* Main Interactive Canvas / Image Stage */}
      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={`relative flex min-h-[420px] flex-1 items-center justify-center overflow-auto bg-[#070709] p-4 sm:min-h-[520px] sm:p-6 ${
          isDragOver ? 'ring-2 ring-inset ring-cyan-500' : ''
        }`}
      >
        {isDragOver && (
          <div className="pointer-events-none absolute inset-0 z-20 flex flex-col items-center justify-center bg-zinc-950/85">
            <Upload className="mb-2 h-8 w-8 text-cyan-400" aria-hidden="true" />
            <p className="text-sm font-semibold text-zinc-100">Drop image to inspect and wash</p>
            <p className="mt-1 text-xs text-zinc-400">
              100% local in-browser processing — PNG, JPEG, or WebP
            </p>
          </div>
        )}

        {!originalUrl ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <p className="text-sm font-medium text-zinc-300">Loading forensic specimen…</p>
          </div>
        ) : (
          <div
            ref={stageRef}
            onMouseMove={handleStageMouseMove}
            onMouseLeave={() => setHoverCoord(null)}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            className={`relative select-none overflow-hidden border border-zinc-800 bg-zinc-950 ${
              viewMode === 'split' ? 'cursor-ew-resize' : 'cursor-crosshair'
            }`}
            style={
              zoom100
                ? { width: `${width}px`, height: `${height}px`, flexShrink: 0 }
                : {
                    maxWidth: '100%',
                    maxHeight: '640px',
                    aspectRatio: `${width} / ${height}`,
                    width: width >= height ? '100%' : 'auto',
                    height: width < height ? '600px' : 'auto',
                  }
            }
          >
            {/* Mode 1: Interactive Split Before / After */}
            {viewMode === 'split' && (
              <>
                <img
                  src={processedUrl || originalUrl}
                  alt="Processed output preview"
                  referrerPolicy="no-referrer"
                  draggable={false}
                  className="block h-full w-full object-contain"
                />

                {/* Clipped Original Overlay on Left */}
                <div
                  className="absolute inset-0 overflow-hidden"
                  style={{ clipPath: `inset(0 ${100 - splitPos}% 0 0)` }}
                >
                  <img
                    src={originalUrl}
                    alt="Original unprocessed source"
                    referrerPolicy="no-referrer"
                    draggable={false}
                    className="block h-full w-full object-contain"
                  />
                </div>

                {/* Split Hairline & Tactile Handle */}
                <div
                  role="slider"
                  tabIndex={0}
                  aria-label="Before and after split comparison position"
                  aria-valuemin={1}
                  aria-valuemax={99}
                  aria-valuenow={Math.round(splitPos)}
                  onKeyDown={(e) => {
                    if (e.key === 'ArrowLeft') setSplitPos((p) => Math.max(1, p - 2));
                    if (e.key === 'ArrowRight') setSplitPos((p) => Math.min(99, p + 2));
                  }}
                  className="absolute inset-y-0 z-10 w-px bg-cyan-400 focus-visible:outline-2 focus-visible:outline-cyan-300"
                  style={{ left: `${splitPos}%` }}
                >
                  <div className="absolute top-1/2 left-1/2 flex h-9 w-5 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded border border-cyan-400 bg-zinc-950/90 text-cyan-300">
                    <span className="h-3.5 w-0.5 bg-cyan-400" />
                  </div>
                </div>

                {/* Measured Scrim Corner Labels */}
                <div className="pointer-events-none absolute top-3 left-3 rounded bg-zinc-950/80 px-2 py-1 font-mono text-[11px] text-zinc-200">
                  Original
                </div>
                <div className="pointer-events-none absolute top-3 right-3 rounded bg-zinc-950/80 px-2 py-1 font-mono text-[11px] text-cyan-300">
                  Washed
                </div>
              </>
            )}

            {/* Mode 2: Amplified Pixel-Difference Heatmap */}
            {viewMode === 'diff' && (
              <>
                <canvas ref={diffCanvasRef} className="block h-full w-full object-contain" />
                <div className="pointer-events-none absolute bottom-3 left-3 flex items-center gap-3 rounded bg-zinc-950/85 px-2.5 py-1.5 font-mono text-[11px] text-zinc-200">
                  <span>{diffGain}× Δ Map</span>
                  <div className="flex items-center gap-1.5">
                    <span className="text-zinc-500">0</span>
                    <div
                      className="h-2 w-24 rounded-xs"
                      style={{
                        background:
                          'linear-gradient(90deg, #090a0e 0%, #085e8a 35%, #06b6d4 65%, #f59e0b 85%, #f43f5e 100%)',
                      }}
                    />
                    <span className="text-zinc-300">
                      {Math.round(255 / diffGain)}
                    </span>
                  </div>
                </div>
              </>
            )}

            {/* Mode 3: JND Local Variance & Edge Texture Mask */}
            {viewMode === 'mask' && (
              <>
                <canvas ref={maskCanvasRef} className="block h-full w-full object-contain" />
                <div className="pointer-events-none absolute bottom-3 left-3 flex items-center gap-3 rounded bg-zinc-950/85 px-2.5 py-1.5 font-mono text-[11px] text-zinc-200">
                  <span>JND Mask</span>
                  <span className="text-zinc-500">Dark: Bilateral Y</span>
                  <span className="text-cyan-400">Cyan/Amber: Textured σ</span>
                </div>
              </>
            )}

            {/* Mode 4: Full Clean Processed Output */}
            {viewMode === 'processed' && (
              <>
                <img
                  src={processedUrl || originalUrl}
                  alt="Full processed lossless output"
                  referrerPolicy="no-referrer"
                  draggable={false}
                  className="block h-full w-full object-contain"
                />
                <div className="pointer-events-none absolute top-3 right-3 rounded bg-zinc-950/80 px-2 py-1 font-mono text-[11px] text-cyan-300">
                  Clean Re-Encoded Output
                </div>
              </>
            )}

            {/* Live Crosshair Pixel Coordinates HUD */}
            {hoverCoord && (
              <div className="pointer-events-none absolute right-3 bottom-3 rounded bg-zinc-950/85 px-2 py-1 font-mono text-[11px] tabular-nums text-zinc-300">
                X:{hoverCoord.x} · Y:{hoverCoord.y}
              </div>
            )}

            {/* Subtle Processing Veil */}
            {isProcessing && (
              <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center bg-zinc-950/50">
                <div className="rounded border border-zinc-700 bg-zinc-950/95 px-4 py-2 font-mono text-xs text-cyan-300">
                  Executing DSP Worker…
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* 4-Column Quantitative Telemetry Strip */}
      <div className="grid grid-cols-2 divide-x divide-y divide-zinc-800 border-t border-zinc-800 bg-[#0c0c0f] md:grid-cols-4 md:divide-y-0">
        {/* Metric 1: PSNR */}
        <div className="p-4">
          <div className="text-xs text-zinc-400">Peak Signal-to-Noise (PSNR)</div>
          <div className="mt-1 flex items-baseline font-mono tabular-nums">
            <span className="text-2xl font-semibold text-zinc-100">
              {metrics ? metrics.psnr.toFixed(2) : '—'}
            </span>
            <span className="ml-1.5 text-xs text-zinc-500">dB</span>
          </div>
          <div className="mt-1 text-xs text-zinc-500">
            {metrics
              ? `MAE ${metrics.mae.toFixed(2)} · Max Δ ${metrics.maxChannelDiff}`
              : 'Awaiting pipeline run'}
          </div>
        </div>

        {/* Metric 2: Windowed SSIM */}
        <div className="p-4">
          <div className="text-xs text-zinc-400">Structural Similarity (SSIM)</div>
          <div className="mt-1 flex items-baseline font-mono tabular-nums">
            <span className="text-2xl font-semibold text-zinc-100">
              {metrics ? metrics.ssim.toFixed(4) : '—'}
            </span>
            <span className="ml-1.5 text-xs text-zinc-500">/ 1.0</span>
          </div>
          <div className="mt-1 text-xs text-zinc-500">
            {metrics
              ? metrics.ssim >= 0.96
                ? 'Perceptually lossless fidelity'
                : 'High-strength spatial disruption'
              : '8×8 windowed luminance'}
          </div>
        </div>

        {/* Metric 3: Spectral Disruption */}
        <div className="p-4">
          <div className="text-xs text-zinc-400">FFT Carrier Peak Suppression</div>
          <div className="mt-1 flex items-baseline font-mono tabular-nums">
            <span className="text-2xl font-semibold text-cyan-400">
              {spectral
                ? `${spectral.peakSuppressionPct >= 0 ? '-' : '+'}${Math.abs(
                    spectral.peakSuppressionPct,
                  ).toFixed(1)}`
                : '—'}
            </span>
            <span className="ml-1.5 text-xs text-zinc-500">%</span>
          </div>
          <div className="mt-1 text-xs text-zinc-500">
            {spectral
              ? `HF band energy ${spectral.hfEnergyDeltaPct >= 0 ? '+' : ''}${spectral.hfEnergyDeltaPct.toFixed(1)}%`
              : '256×256 2D high-pass FFT'}
          </div>
        </div>

        {/* Metric 4: Metadata Scrubber Verification */}
        <div className="p-4">
          <div className="text-xs text-zinc-400">Metadata &amp; C2PA Scrub</div>
          <div className="mt-1 flex items-baseline font-mono tabular-nums">
            <span
              className={`text-2xl font-semibold ${
                washedForensics && residualCount === 0 ? 'text-emerald-400' : 'text-zinc-100'
              }`}
            >
              {washedForensics ? residualCount : '—'}
            </span>
            <span className="ml-1.5 text-xs text-zinc-500">residual chunks</span>
          </div>
          <div className="mt-1 text-xs text-zinc-500">
            {washedForensics
              ? strippedCount > 0
                ? `${strippedCount} metadata segment${strippedCount === 1 ? '' : 's'} removed · Verified`
                : 'Clean raw RGBA re-encode'
              : 'Pending re-encode'}
          </div>
        </div>
      </div>
    </div>
  );
}
