import { useEffect, useRef, useState } from 'react';
import type { QualityMetrics, SpectralAnalysis } from '../types/spectra';

interface SpectralLabProps {
  spectral: SpectralAnalysis | null;
  metrics: QualityMetrics | null;
}

interface FftPanelProps {
  title: string;
  subtitle: string;
  rgba: Uint8ClampedArray | null;
  fftSize: number;
  ratioValue: number | null;
  accentClass: string;
}

function FftSpectrumCanvas({
  title,
  subtitle,
  rgba,
  fftSize,
  ratioValue,
  accentClass,
}: FftPanelProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [freqHover, setFreqHover] = useState<{ fx: number; fy: number; r: number } | null>(null);

  useEffect(() => {
    if (!rgba || !canvasRef.current || fftSize === 0) return;
    const canvas = canvasRef.current;
    canvas.width = fftSize;
    canvas.height = fftSize;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const imgData = new ImageData(new Uint8ClampedArray(rgba), fftSize, fftSize);
    ctx.putImageData(imgData, 0, 0);
  }, [rgba, fftSize]);

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const nx = (e.clientX - rect.left) / rect.width - 0.5;
    const ny = (e.clientY - rect.top) / rect.height - 0.5;
    const r = Math.min(0.5, Math.sqrt(nx * nx + ny * ny));
    setFreqHover({ fx: nx, fy: -ny, r });
  };

  return (
    <div className="flex flex-col border border-zinc-800 bg-[#0d0d10]">
      <div className="flex items-baseline justify-between gap-2 border-b border-zinc-800 px-4 py-3">
        <div>
          <h3 className="text-sm font-semibold text-zinc-100">{title}</h3>
          <p className="text-xs text-zinc-500">{subtitle}</p>
        </div>
        {ratioValue !== null && (
          <div className="text-right font-mono tabular-nums">
            <div className="text-[11px] text-zinc-500">Peak/Floor</div>
            <div className={`text-sm font-semibold ${accentClass}`}>
              {ratioValue.toFixed(2)}×
            </div>
          </div>
        )}
      </div>

      <div
        onMouseMove={handleMouseMove}
        onMouseLeave={() => setFreqHover(null)}
        className="relative aspect-square w-full cursor-crosshair overflow-hidden bg-[#07080c]"
      >
        <canvas
          ref={canvasRef}
          className="h-full w-full"
          style={{ imageRendering: 'pixelated' }}
        />

        {/* Calibrated Radial Frequency Grid Overlay */}
        <svg
          viewBox="0 0 256 256"
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 h-full w-full"
        >
          <line x1="128" y1="0" x2="128" y2="256" stroke="rgba(255,255,255,0.12)" strokeWidth="0.75" />
          <line x1="0" y1="128" x2="256" y2="128" stroke="rgba(255,255,255,0.12)" strokeWidth="0.75" />
          <circle
            cx="128"
            cy="128"
            r="38.4"
            fill="none"
            stroke="rgba(255,255,255,0.14)"
            strokeDasharray="2 3"
            strokeWidth="0.75"
          />
          <circle
            cx="128"
            cy="128"
            r="76.8"
            fill="none"
            stroke="rgba(255,255,255,0.14)"
            strokeDasharray="2 3"
            strokeWidth="0.75"
          />
          <circle
            cx="128"
            cy="128"
            r="115.2"
            fill="none"
            stroke="rgba(255,255,255,0.14)"
            strokeDasharray="2 3"
            strokeWidth="0.75"
          />
        </svg>

        <div className="pointer-events-none absolute top-2.5 left-2.5 rounded bg-zinc-950/80 px-1.5 py-0.5 font-mono text-[10px] text-zinc-400">
          DC Center (0, 0)
        </div>

        {freqHover && (
          <div className="pointer-events-none absolute right-2.5 bottom-2.5 rounded bg-zinc-950/85 px-2 py-1 font-mono text-[10px] tabular-nums text-zinc-200">
            fx:{freqHover.fx >= 0 ? '+' : ''}
            {freqHover.fx.toFixed(2)} · fy:{freqHover.fy >= 0 ? '+' : ''}
            {freqHover.fy.toFixed(2)} · |f|:{freqHover.r.toFixed(2)} cyc/px
          </div>
        )}
      </div>
    </div>
  );
}

export function SpectralLab({ spectral, metrics }: SpectralLabProps) {
  const [hoverBin, setHoverBin] = useState<number | null>(null);

  const profile = spectral?.radialProfile ?? [];
  const chartW = 560;
  const chartH = 220;
  const padL = 44;
  const padR = 18;
  const padT = 18;
  const padB = 34;
  const plotW = chartW - padL - padR;
  const plotH = chartH - padT - padB;

  let maxY = 1.0;
  for (const pt of profile) {
    if (pt.original > maxY) maxY = pt.original;
    if (pt.processed > maxY) maxY = pt.processed;
  }
  maxY = Math.ceil(maxY * 1.12 * 10) / 10;

  const toX = (freq: number) => padL + (freq / 0.5) * plotW;
  const toY = (val: number) => padT + plotH - (val / Math.max(0.1, maxY)) * plotH;

  const origPath = profile
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${toX(p.freq).toFixed(1)} ${toY(p.original).toFixed(1)}`)
    .join(' ');
  const procPath = profile
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${toX(p.freq).toFixed(1)} ${toY(p.processed).toFixed(1)}`)
    .join(' ');

  const hoveredPoint = hoverBin !== null && profile[hoverBin] ? profile[hoverBin] : null;

  return (
    <section
      id="spectral-lab"
      className="scroll-mt-14 border-t border-zinc-800 bg-[#09090b] px-4 py-10 sm:px-6 lg:px-8"
    >
      <div className="mx-auto max-w-[1560px]">
        <div className="flex flex-wrap items-end justify-between gap-4 border-b border-zinc-800 pb-5">
          <div>
            <h2 className="text-xl font-semibold tracking-tight text-zinc-100">
              2D FFT Spectral Anomaly Lab
            </h2>
            <p className="mt-1 max-w-2xl text-sm text-zinc-400">
              Cooley-Tukey 256×256 high-pass luminance FFT comparing periodic carrier spikes before
              and after spatial phase disruption.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-4 text-xs text-zinc-400">
            <div className="flex items-center gap-2 font-mono">
              <span className="text-zinc-500">Log-Power Scale</span>
              <div
                className="h-2.5 w-28 rounded-xs border border-zinc-800"
                style={{
                  background:
                    'linear-gradient(90deg, #090b10 0%, #082e48 35%, #06b6d4 72%, #f59e0b 90%, #fff8e1 100%)',
                }}
              />
            </div>
            {metrics && (
              <div className="font-mono text-xs tabular-nums text-zinc-400">
                Worker compute: <span className="text-zinc-200">{metrics.processingMs} ms</span>
              </div>
            )}
          </div>
        </div>

        <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-12">
          {/* 2D FFT Canvases (Before / After) */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:col-span-6">
            <FftSpectrumCanvas
              title="Original 2D Spectrum"
              subtitle="Pre-wash high-pass Hann FFT"
              rgba={spectral?.originalSpectrumRgba ?? null}
              fftSize={spectral?.fftSize ?? 256}
              ratioValue={spectral?.originalAnomalyRatio ?? null}
              accentClass="text-cyan-400"
            />
            <FftSpectrumCanvas
              title="Post-Wash 2D Spectrum"
              subtitle="Disrupted phase & JND luminance FFT"
              rgba={spectral?.processedSpectrumRgba ?? null}
              fftSize={spectral?.fftSize ?? 256}
              ratioValue={spectral?.processedAnomalyRatio ?? null}
              accentClass="text-amber-400"
            />
          </div>

          {/* Azimuthal Radial Frequency Decay Profile */}
          <div className="flex flex-col border border-zinc-800 bg-[#0d0d10] lg:col-span-6">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-800 px-4 py-3">
              <div>
                <h3 className="text-sm font-semibold text-zinc-100">
                  Azimuthal Spatial Frequency Profile
                </h3>
                <p className="text-xs text-zinc-500">
                  Radial mean log-magnitude from DC (0.00) to Nyquist (0.50 cyc/px)
                </p>
              </div>
              <div className="flex items-center gap-4 text-xs">
                <span className="inline-flex items-center gap-1.5 text-zinc-300">
                  <span className="inline-block h-0.5 w-4 bg-cyan-400" />
                  Original
                </span>
                <span className="inline-flex items-center gap-1.5 text-zinc-300">
                  <span className="inline-block h-0.5 w-4 border-t-2 border-dashed border-amber-400" />
                  Post-Wash
                </span>
              </div>
            </div>

            <div className="relative flex flex-1 flex-col justify-between p-4">
              {profile.length === 0 ? (
                <div className="flex h-56 items-center justify-center text-xs text-zinc-500">
                  Run pipeline to compute 2D FFT radial profile
                </div>
              ) : (
                <svg
                  viewBox={`0 0 ${chartW} ${chartH}`}
                  className="h-auto w-full cursor-crosshair overflow-visible"
                  onMouseMove={(e) => {
                    const rect = e.currentTarget.getBoundingClientRect();
                    const relX = ((e.clientX - rect.left) / rect.width) * chartW;
                    const norm = Math.max(0, Math.min(1, (relX - padL) / plotW));
                    const idx = Math.min(
                      profile.length - 1,
                      Math.max(0, Math.round(norm * (profile.length - 1))),
                    );
                    setHoverBin(idx);
                  }}
                  onMouseLeave={() => setHoverBin(null)}
                >
                  {/* Watermark high-frequency band shading (0.14 - 0.46 cyc/px) */}
                  <rect
                    x={toX(0.14)}
                    y={padT}
                    width={toX(0.46) - toX(0.14)}
                    height={plotH}
                    fill="rgba(6, 182, 212, 0.05)"
                  />

                  {/* Horizontal gridlines */}
                  {[0, 0.25, 0.5, 0.75, 1].map((frac) => {
                    const y = padT + plotH * (1 - frac);
                    const val = maxY * frac;
                    return (
                      <g key={frac}>
                        <line
                          x1={padL}
                          y1={y}
                          x2={chartW - padR}
                          y2={y}
                          stroke="#27272a"
                          strokeWidth="1"
                        />
                        <text
                          x={padL - 8}
                          y={y + 3}
                          textAnchor="end"
                          className="fill-zinc-500 font-mono text-[10px]"
                        >
                          {val.toFixed(1)}
                        </text>
                      </g>
                    );
                  })}

                  {/* Vertical frequency ticks */}
                  {[0, 0.1, 0.2, 0.3, 0.4, 0.5].map((f) => {
                    const x = toX(f);
                    return (
                      <g key={f}>
                        <line
                          x1={x}
                          y1={padT}
                          x2={x}
                          y2={padT + plotH}
                          stroke="#1f1f23"
                          strokeWidth="1"
                        />
                        <text
                          x={x}
                          y={chartH - 10}
                          textAnchor="middle"
                          className="fill-zinc-500 font-mono text-[10px]"
                        >
                          {f.toFixed(1)}
                        </text>
                      </g>
                    );
                  })}

                  <text
                    x={toX(0.3)}
                    y={padT + 12}
                    textAnchor="middle"
                    className="fill-cyan-500/70 font-mono text-[9px]"
                  >
                    High-Frequency Carrier Band (0.14–0.46 cyc/px)
                  </text>

                  {/* Original Solid Cyan Curve */}
                  <path
                    d={origPath}
                    fill="none"
                    stroke="#06b6d4"
                    strokeWidth="2"
                    strokeLinejoin="round"
                  />

                  {/* Processed Dashed Amber Curve */}
                  <path
                    d={procPath}
                    fill="none"
                    stroke="#f59e0b"
                    strokeWidth="2"
                    strokeDasharray="5 3"
                    strokeLinejoin="round"
                  />

                  {/* Interactive Hover Crosshair */}
                  {hoveredPoint && (
                    <g>
                      <line
                        x1={toX(hoveredPoint.freq)}
                        y1={padT}
                        x2={toX(hoveredPoint.freq)}
                        y2={padT + plotH}
                        stroke="#71717a"
                        strokeDasharray="2 2"
                        strokeWidth="1"
                      />
                      <circle
                        cx={toX(hoveredPoint.freq)}
                        cy={toY(hoveredPoint.original)}
                        r="3.5"
                        fill="#06b6d4"
                        stroke="#09090b"
                        strokeWidth="1.5"
                      />
                      <circle
                        cx={toX(hoveredPoint.freq)}
                        cy={toY(hoveredPoint.processed)}
                        r="3.5"
                        fill="#f59e0b"
                        stroke="#09090b"
                        strokeWidth="1.5"
                      />
                    </g>
                  )}
                </svg>
              )}

              {/* Bottom Telemetry Readout Bar */}
              <div className="mt-3 grid grid-cols-3 divide-x divide-zinc-800 border-t border-zinc-800 pt-3 font-mono text-xs tabular-nums">
                <div className="pr-3">
                  <div className="text-[11px] text-zinc-500">
                    {hoveredPoint ? `Bin ${hoveredPoint.freq.toFixed(3)} cyc/px` : 'Peak Ratio (Pre)'}
                  </div>
                  <div className="mt-0.5 text-sm font-semibold text-cyan-400">
                    {hoveredPoint
                      ? hoveredPoint.original.toFixed(3)
                      : spectral
                        ? `${spectral.originalAnomalyRatio.toFixed(2)}×`
                        : '—'}
                  </div>
                </div>
                <div className="px-3">
                  <div className="text-[11px] text-zinc-500">
                    {hoveredPoint ? 'Post-Wash Mag' : 'Peak Ratio (Post)'}
                  </div>
                  <div className="mt-0.5 text-sm font-semibold text-amber-400">
                    {hoveredPoint
                      ? hoveredPoint.processed.toFixed(3)
                      : spectral
                        ? `${spectral.processedAnomalyRatio.toFixed(2)}×`
                        : '—'}
                  </div>
                </div>
                <div className="pl-3">
                  <div className="text-[11px] text-zinc-500">
                    {hoveredPoint ? 'Bin Delta' : 'JND Textured Area'}
                  </div>
                  <div className="mt-0.5 text-sm font-semibold text-zinc-100">
                    {hoveredPoint
                      ? `${(hoveredPoint.processed - hoveredPoint.original) >= 0 ? '+' : ''}${(
                          hoveredPoint.processed - hoveredPoint.original
                        ).toFixed(3)}`
                      : metrics
                        ? `${metrics.texturedRegionPct.toFixed(1)}%`
                        : '—'}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
