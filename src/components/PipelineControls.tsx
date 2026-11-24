import { Download, Play, RotateCcw, Shuffle, Upload } from 'lucide-react';
import { SPECIMEN_ASSETS } from '../data/specimens';
import { PRESETS, type PipelineConfig, type PresetKey } from '../types/spectra';

interface PipelineControlsProps {
  config: PipelineConfig;
  activePreset: PresetKey;
  activeSpecimenId: string | null;
  testCarrierEnabled: boolean;
  isProcessing: boolean;
  progress: { stage: number; label: string; percent: number } | null;
  hasProcessedOutput: boolean;
  onSelectPreset: (preset: Exclude<PresetKey, 'custom'>) => void;
  onUpdateConfig: <K extends keyof PipelineConfig>(key: K, value: PipelineConfig[K]) => void;
  onRunPipeline: () => void;
  onExportImage: () => void;
  onLoadSpecimen: (specimenId: string) => void;
  onToggleTestCarrier: (enabled: boolean) => void;
  onOpenFilePicker: () => void;
  onResetDefaults: () => void;
}

interface SliderRowProps {
  id: string;
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit: string;
  precision?: number;
  disabled?: boolean;
  onChange: (val: number) => void;
}

function SliderRow({
  id,
  label,
  value,
  min,
  max,
  step,
  unit,
  precision = 2,
  disabled = false,
  onChange,
}: SliderRowProps) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-xs">
        <label htmlFor={id} className={disabled ? 'text-zinc-600' : 'text-zinc-300'}>
          {label}
        </label>
        <span
          className={`font-mono tabular-nums ${disabled ? 'text-zinc-600' : 'text-zinc-100'}`}
        >
          {value.toFixed(precision)}
          {unit ? <span className="ml-1 text-zinc-500">{unit}</span> : null}
        </span>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="spectra-slider"
      />
    </div>
  );
}

export function PipelineControls({
  config,
  activePreset,
  activeSpecimenId,
  testCarrierEnabled,
  isProcessing,
  progress,
  hasProcessedOutput,
  onSelectPreset,
  onUpdateConfig,
  onRunPipeline,
  onExportImage,
  onLoadSpecimen,
  onToggleTestCarrier,
  onOpenFilePicker,
  onResetDefaults,
}: PipelineControlsProps) {
  const presetKeys: Array<Exclude<PresetKey, 'custom'>> = ['stealth', 'balanced', 'maximum'];

  return (
    <aside className="flex w-full flex-col border-b border-zinc-800 bg-[#0d0d10] lg:w-[356px] lg:shrink-0 lg:border-r lg:border-b-0">
      {/* Source & Specimen Selector */}
      <div className="border-b border-zinc-800 p-4 sm:p-5">
        <div className="flex items-center justify-between">
          <h2 className="text-xs font-semibold tracking-wider text-zinc-400">Input Source</h2>
          <button
            type="button"
            onClick={onOpenFilePicker}
            className="inline-flex cursor-pointer items-center gap-1.5 text-xs font-medium text-cyan-400 transition-colors hover:text-cyan-300"
          >
            <Upload className="h-3.5 w-3.5" aria-hidden="true" />
            Upload File
          </button>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2">
          {SPECIMEN_ASSETS.map((spec) => {
            const active = activeSpecimenId === spec.id;
            return (
              <button
                key={spec.id}
                type="button"
                onClick={() => onLoadSpecimen(spec.id)}
                className={`cursor-pointer truncate rounded-md border px-2.5 py-2 text-left text-xs font-medium transition-colors ${
                  active
                    ? 'border-cyan-500/60 bg-cyan-500/10 text-cyan-200'
                    : 'border-zinc-800 bg-zinc-900/60 text-zinc-400 hover:border-zinc-700 hover:text-zinc-200'
                }`}
              >
                {spec.name}
              </button>
            );
          })}
        </div>

        {activeSpecimenId !== null && (
          <div className="mt-3 flex items-center justify-between gap-3 pt-1">
            <div className="min-w-0">
              <p className="text-xs font-medium text-zinc-300">Synthetic Test Carrier + C2PA</p>
              <p className="text-[11px] text-zinc-500">
                Embeds a demo frequency carrier &amp; metadata tag to verify disruption
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={testCarrierEnabled}
              aria-label="Toggle synthetic test carrier and C2PA metadata"
              onClick={() => onToggleTestCarrier(!testCarrierEnabled)}
              className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border transition-colors ${
                testCarrierEnabled
                  ? 'border-cyan-400 bg-cyan-500'
                  : 'border-zinc-700 bg-zinc-800'
              }`}
            >
              <span
                className={`inline-block h-3.5 w-3.5 rounded-full bg-zinc-950 transition-transform ${
                  testCarrierEnabled ? 'translate-x-4' : 'translate-x-0.5'
                }`}
              />
            </button>
          </div>
        )}
      </div>

      {/* Presets Segmented Bar */}
      <div className="border-b border-zinc-800 p-4 sm:p-5">
        <div className="flex items-center justify-between">
          <h2 className="text-xs font-semibold tracking-wider text-zinc-400">
            Disruption Profile
          </h2>
          <button
            type="button"
            onClick={onResetDefaults}
            className="inline-flex cursor-pointer items-center gap-1 text-xs text-zinc-500 transition-colors hover:text-zinc-200"
            title="Reset to Balanced preset"
          >
            <RotateCcw className="h-3 w-3" aria-hidden="true" />
            Reset
          </button>
        </div>

        <div className="mt-3 grid grid-cols-3 gap-1 rounded-md border border-zinc-800 bg-zinc-950 p-1">
          {presetKeys.map((key) => {
            const isSelected = activePreset === key;
            return (
              <button
                key={key}
                type="button"
                onClick={() => onSelectPreset(key)}
                className={`cursor-pointer whitespace-nowrap rounded px-2 py-1.5 text-xs font-medium transition-colors ${
                  isSelected
                    ? 'bg-zinc-800 text-cyan-300'
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                {PRESETS[key].label}
              </button>
            );
          })}
        </div>

        <p className="mt-2.5 text-xs leading-relaxed text-zinc-500">
          {activePreset === 'custom'
            ? 'Custom calibration active. Adjust parameters below and re-run wash.'
            : PRESETS[activePreset].summary}
        </p>
      </div>

      {/* Scrollable 4-Stage Parameters */}
      <div className="flex-1 divide-y divide-zinc-800/80 overflow-y-auto">
        {/* Stage 01: Sub-Pixel Non-Linear Mesh Warping */}
        <section className="space-y-3.5 p-4 sm:p-5">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-semibold text-zinc-200">
              01. Sub-Pixel Mesh Warping
            </h3>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() =>
                  onUpdateConfig('meshSeed', Math.floor(1000 + Math.random() * 8999))
                }
                disabled={!config.meshEnabled}
                title="Randomize spatial phase seed"
                className="inline-flex h-6 cursor-pointer items-center gap-1 rounded border border-zinc-800 bg-zinc-900 px-1.5 font-mono text-[11px] text-zinc-400 transition-colors hover:border-zinc-700 hover:text-zinc-200 disabled:opacity-40"
              >
                <Shuffle className="h-2.5 w-2.5" aria-hidden="true" />
                {config.meshSeed}
              </button>
              <input
                type="checkbox"
                aria-label="Enable sub-pixel mesh warping"
                checked={config.meshEnabled}
                onChange={(e) => onUpdateConfig('meshEnabled', e.target.checked)}
                className="h-4 w-4 cursor-pointer accent-cyan-500"
              />
            </div>
          </div>

          <SliderRow
            id="mesh-amplitude"
            label="Displacement Amplitude"
            value={config.meshAmplitude}
            min={0.2}
            max={2.0}
            step={0.05}
            unit="px"
            disabled={!config.meshEnabled}
            onChange={(v) => onUpdateConfig('meshAmplitude', v)}
          />
          <SliderRow
            id="mesh-wavelength"
            label="Sinusoidal Wavelength"
            value={config.meshWavelength}
            min={150}
            max={380}
            step={5}
            unit="px"
            precision={0}
            disabled={!config.meshEnabled}
            onChange={(v) => onUpdateConfig('meshWavelength', v)}
          />
          <p className="text-[11px] text-zinc-500">
            Dual-axis phase field · 4×4 Keys Bicubic kernel
          </p>
        </section>

        {/* Stage 02: Texture-Adaptive JND Luminance */}
        <section className="space-y-3.5 p-4 sm:p-5">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-semibold text-zinc-200">
              02. Texture-Adaptive JND Luminance
            </h3>
            <input
              type="checkbox"
              aria-label="Enable JND luminance processing"
              checked={config.jndEnabled}
              onChange={(e) => onUpdateConfig('jndEnabled', e.target.checked)}
              className="h-4 w-4 cursor-pointer accent-cyan-500"
            />
          </div>

          <SliderRow
            id="jnd-bilateral"
            label="Flat-Region Bilateral Y"
            value={config.bilateralStrength}
            min={0}
            max={1}
            step={0.05}
            unit=""
            disabled={!config.jndEnabled}
            onChange={(v) => onUpdateConfig('bilateralStrength', v)}
          />
          <SliderRow
            id="jnd-sigma"
            label="Textured Perturbation (σ)"
            value={config.textureSigma}
            min={0}
            max={2.2}
            step={0.05}
            unit="Y"
            disabled={!config.jndEnabled}
            onChange={(v) => onUpdateConfig('textureSigma', v)}
          />
          <SliderRow
            id="jnd-threshold"
            label="Variance / Edge Mask Cutoff"
            value={config.edgeThreshold}
            min={8}
            max={40}
            step={1}
            unit=""
            precision={0}
            disabled={!config.jndEnabled}
            onChange={(v) => onUpdateConfig('edgeThreshold', v)}
          />
          <p className="text-[11px] text-zinc-500">
            BT.709 YCbCr · Chroma channels (Cb/Cr) strictly untouched
          </p>
        </section>

        {/* Stage 03: Fractional Affine & Micro-Contrast */}
        <section className="space-y-3.5 p-4 sm:p-5">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-semibold text-zinc-200">
              03. Fractional Affine &amp; Recovery
            </h3>
            <input
              type="checkbox"
              aria-label="Enable fractional affine rotation"
              checked={config.affineEnabled}
              onChange={(e) => onUpdateConfig('affineEnabled', e.target.checked)}
              className="h-4 w-4 cursor-pointer accent-cyan-500"
            />
          </div>

          <SliderRow
            id="affine-rotation"
            label="Fractional Rotation"
            value={config.rotationDeg}
            min={0.0}
            max={0.8}
            step={0.05}
            unit="deg"
            disabled={!config.affineEnabled}
            onChange={(v) => onUpdateConfig('rotationDeg', v)}
          />

          <div className="flex items-center justify-between gap-2 text-xs">
            <span className={config.affineEnabled ? 'text-zinc-300' : 'text-zinc-600'}>
              Resampling Kernel
            </span>
            <div className="inline-flex rounded border border-zinc-800 bg-zinc-950 p-0.5">
              {(['lanczos3', 'bicubic'] as const).map((kernel) => (
                <button
                  key={kernel}
                  type="button"
                  disabled={!config.affineEnabled}
                  onClick={() => onUpdateConfig('resampler', kernel)}
                  className={`cursor-pointer rounded px-2 py-0.5 font-mono text-[11px] transition-colors disabled:opacity-40 ${
                    config.resampler === kernel
                      ? 'bg-zinc-800 text-cyan-300'
                      : 'text-zinc-500 hover:text-zinc-300'
                  }`}
                >
                  {kernel === 'lanczos3' ? 'Lanczos-3' : 'Bicubic'}
                </button>
              ))}
            </div>
          </div>

          <SliderRow
            id="unsharp-radius"
            label="Unsharp Mask Radius"
            value={config.unsharpRadius}
            min={0.4}
            max={1.5}
            step={0.1}
            unit="px"
            precision={1}
            onChange={(v) => onUpdateConfig('unsharpRadius', v)}
          />
          <SliderRow
            id="unsharp-amount"
            label="Micro-Contrast Recovery"
            value={config.unsharpAmount}
            min={0.0}
            max={0.55}
            step={0.05}
            unit=""
            onChange={(v) => onUpdateConfig('unsharpAmount', v)}
          />
        </section>

        {/* Stage 04: Metadata Scrubbing & Output Container */}
        <section className="space-y-3 p-4 sm:p-5">
          <h3 className="text-xs font-semibold text-zinc-200">
            04. Metadata &amp; C2PA Scrubber
          </h3>

          <div className="grid grid-cols-2 gap-1 rounded-md border border-zinc-800 bg-zinc-950 p-1">
            <button
              type="button"
              onClick={() => onUpdateConfig('outputFormat', 'png')}
              className={`cursor-pointer whitespace-nowrap rounded px-2 py-1.5 text-xs font-medium transition-colors ${
                config.outputFormat === 'png'
                  ? 'bg-zinc-800 text-cyan-300'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              PNG Lossless
            </button>
            <button
              type="button"
              onClick={() => onUpdateConfig('outputFormat', 'webp')}
              className={`cursor-pointer whitespace-nowrap rounded px-2 py-1.5 text-xs font-medium transition-colors ${
                config.outputFormat === 'webp'
                  ? 'bg-zinc-800 text-cyan-300'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              WebP Clean
            </button>
          </div>
          <p className="text-[11px] leading-relaxed text-zinc-500">
            Raw RGBA re-encode strips EXIF, XMP, IPTC, ICC, and C2PA / JUMBF chunks completely.
          </p>
        </section>
      </div>

      {/* Anchored Execution Footer */}
      <div className="space-y-2.5 border-t border-zinc-800 bg-[#09090b] p-4 sm:p-5">
        {isProcessing && progress && (
          <div className="space-y-1.5 pb-1">
            <div className="flex items-center justify-between text-[11px]">
              <span className="truncate text-zinc-300">{progress.label}</span>
              <span className="shrink-0 font-mono tabular-nums text-cyan-400">
                {progress.percent}%
              </span>
            </div>
            <div className="h-1 w-full overflow-hidden rounded-full bg-zinc-800">
              <div
                className="h-full bg-cyan-500 transition-all duration-150"
                style={{ width: `${progress.percent}%` }}
              />
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-1">
          <button
            type="button"
            disabled={isProcessing}
            onClick={onRunPipeline}
            className="inline-flex h-10 w-full cursor-pointer items-center justify-center gap-2 whitespace-nowrap rounded-md bg-cyan-500 px-4 text-xs font-semibold text-zinc-950 transition-colors hover:bg-cyan-400 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Play className="h-3.5 w-3.5 fill-current" aria-hidden="true" />
            {isProcessing ? 'Processing in Worker…' : 'Run Wash Pipeline'}
          </button>

          <button
            type="button"
            disabled={isProcessing || !hasProcessedOutput}
            onClick={onExportImage}
            className="inline-flex h-10 w-full cursor-pointer items-center justify-center gap-2 whitespace-nowrap rounded-md border border-zinc-700 bg-zinc-900 px-4 text-xs font-semibold text-zinc-100 transition-colors hover:border-zinc-600 hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Download className="h-3.5 w-3.5" aria-hidden="true" />
            {`Export Clean ${config.outputFormat.toUpperCase()}`}
          </button>
        </div>
      </div>
    </aside>
  );
}
