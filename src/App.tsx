import { useCallback, useEffect, useRef, useState } from 'react';
import { ForensicInspector } from './components/ForensicInspector';
import { Header } from './components/Header';
import { ImageStage } from './components/ImageStage';
import { PipelineControls } from './components/PipelineControls';
import { SpectralLab } from './components/SpectralLab';
import {
  SPECIMEN_ASSETS,
  applySyntheticTestCarrier,
  injectSyntheticJpegProvenance,
} from './data/specimens';
import { inspectBinaryMetadata } from './engine/metadataParser';
import {
  PRESETS,
  type ForensicReport,
  type PipelineConfig,
  type PresetKey,
  type QualityMetrics,
  type SpectralAnalysis,
  type WorkerRequest,
  type WorkerResponse,
} from './types/spectra';

interface LoadedImage {
  filename: string;
  width: number;
  height: number;
  rgba: Uint8ClampedArray;
  previewUrl: string;
}

function encodeRgbaToBlob(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  format: 'png' | 'webp',
  quality: number,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      reject(new Error('Could not initialize 2D canvas context for clean re-encoding.'));
      return;
    }
    const imgData = new ImageData(new Uint8ClampedArray(rgba), width, height);
    ctx.putImageData(imgData, 0, 0);
    const mime = format === 'webp' ? 'image/webp' : 'image/png';
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error('Failed to encode clean output image blob.'));
          return;
        }
        resolve(blob);
      },
      mime,
      format === 'webp' ? quality : undefined,
    );
  });
}

async function decodeImageBufferToRgba(
  blob: Blob,
): Promise<{ width: number; height: number; rgba: Uint8ClampedArray }> {
  const bitmap = await createImageBitmap(blob);
  // Cap working dimension at 2400px longest side for responsive in-browser Web Worker execution
  // while preserving native dimensions for typical HD/FHD/2K assets
  const maxDim = 2400;
  let targetW = bitmap.width;
  let targetH = bitmap.height;
  if (Math.max(targetW, targetH) > maxDim) {
    const scale = maxDim / Math.max(targetW, targetH);
    targetW = Math.round(targetW * scale);
    targetH = Math.round(targetH * scale);
  }

  const canvas = document.createElement('canvas');
  canvas.width = targetW;
  canvas.height = targetH;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    bitmap.close();
    throw new Error('Could not acquire 2D context to decode image.');
  }
  ctx.drawImage(bitmap, 0, 0, targetW, targetH);
  bitmap.close();
  const imgData = ctx.getImageData(0, 0, targetW, targetH);
  return {
    width: targetW,
    height: targetH,
    rgba: imgData.data,
  };
}

export default function App() {
  const [activePreset, setActivePreset] = useState<PresetKey>('balanced');
  const [config, setConfig] = useState<PipelineConfig>({ ...PRESETS.balanced.config });

  const [activeSpecimenId, setActiveSpecimenId] = useState<string | null>(SPECIMEN_ASSETS[0].id);
  const [testCarrierEnabled, setTestCarrierEnabled] = useState<boolean>(true);

  const [sourceImage, setSourceImage] = useState<LoadedImage | null>(null);
  const [processedUrl, setProcessedUrl] = useState<string | null>(null);
  const [processedBlob, setProcessedBlob] = useState<Blob | null>(null);
  const [diffMagnitude, setDiffMagnitude] = useState<Uint8Array | null>(null);
  const [maskRgba, setMaskRgba] = useState<Uint8ClampedArray | null>(null);
  const [metrics, setMetrics] = useState<QualityMetrics | null>(null);
  const [spectral, setSpectral] = useState<SpectralAnalysis | null>(null);

  const [originalForensics, setOriginalForensics] = useState<ForensicReport | null>(null);
  const [washedForensics, setWashedForensics] = useState<ForensicReport | null>(null);

  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [progress, setProgress] = useState<{
    stage: number;
    label: string;
    percent: number;
  } | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const activeJobIdRef = useRef<number>(0);
  const configRef = useRef<PipelineConfig>(config);
  const prevSourceUrlRef = useRef<string | null>(null);
  const prevProcessedUrlRef = useRef<string | null>(null);

  configRef.current = config;

  // Manage URL cleanup on unmount
  useEffect(() => {
    return () => {
      if (prevSourceUrlRef.current) URL.revokeObjectURL(prevSourceUrlRef.current);
      if (prevProcessedUrlRef.current) URL.revokeObjectURL(prevProcessedUrlRef.current);
      workerRef.current?.terminate();
    };
  }, []);

  // Run DSP pipeline in dedicated Web Worker
  const executePipeline = useCallback(
    (img: LoadedImage, pipelineCfg: PipelineConfig) => {
      setErrorMessage(null);
      setIsProcessing(true);
      setProgress({ stage: 1, label: 'Initializing DSP Web Worker…', percent: 5 });

      if (!workerRef.current) {
        workerRef.current = new Worker(new URL('./engine/dspWorker.ts', import.meta.url), {
          type: 'module',
        });
      }

      const jobId = ++activeJobIdRef.current;
      const worker = workerRef.current;

      worker.onmessage = async (event: MessageEvent<WorkerResponse>) => {
        const msg = event.data;
        if (msg.jobId !== activeJobIdRef.current) return;

        if (msg.type === 'progress') {
          setProgress({ stage: msg.stage, label: msg.label, percent: msg.percent });
          return;
        }

        if (msg.type === 'error') {
          setErrorMessage(msg.message);
          setIsProcessing(false);
          setProgress(null);
          return;
        }

        if (msg.type === 'result') {
          try {
            const procRgba = new Uint8ClampedArray(msg.processedRgba);
            const diffArr = new Uint8Array(msg.diffMagnitude);
            const maskArr = new Uint8ClampedArray(msg.maskRgba);

            // Re-encode clean raw pixel buffer into lossless PNG or WebP (Stage 4 scrubber)
            const blob = await encodeRgbaToBlob(
              procRgba,
              msg.width,
              msg.height,
              pipelineCfg.outputFormat,
              pipelineCfg.webpQuality,
            );

            if (msg.jobId !== activeJobIdRef.current) return;

            const outBuffer = await blob.arrayBuffer();
            const postForensics = inspectBinaryMetadata(outBuffer);

            const nextUrl = URL.createObjectURL(blob);
            if (prevProcessedUrlRef.current) {
              URL.revokeObjectURL(prevProcessedUrlRef.current);
            }
            prevProcessedUrlRef.current = nextUrl;

            setProcessedBlob(blob);
            setProcessedUrl(nextUrl);
            setDiffMagnitude(diffArr);
            setMaskRgba(maskArr);
            setMetrics(msg.metrics);
            setSpectral({
              fftSize: msg.spectral.fftSize,
              originalSpectrumRgba: new Uint8ClampedArray(msg.spectral.originalSpectrumRgba),
              processedSpectrumRgba: new Uint8ClampedArray(msg.spectral.processedSpectrumRgba),
              radialProfile: msg.spectral.radialProfile,
              originalAnomalyRatio: msg.spectral.originalAnomalyRatio,
              processedAnomalyRatio: msg.spectral.processedAnomalyRatio,
              hfEnergyDeltaPct: msg.spectral.hfEnergyDeltaPct,
              peakSuppressionPct: msg.spectral.peakSuppressionPct,
            });
            setWashedForensics(postForensics);
          } catch (err) {
            setErrorMessage(
              err instanceof Error ? err.message : 'Failed to encode scrubbed output image.',
            );
          } finally {
            if (msg.jobId === activeJobIdRef.current) {
              setIsProcessing(false);
              setProgress(null);
            }
          }
        }
      };

      worker.onerror = (err) => {
        setErrorMessage(err.message || 'Web Worker encountered a fatal error.');
        setIsProcessing(false);
        setProgress(null);
      };

      // Copy buffer for zero-copy transfer to worker
      const transferCopy = new Uint8ClampedArray(img.rgba);
      const req: WorkerRequest = {
        type: 'process',
        jobId,
        width: img.width,
        height: img.height,
        rgbaBuffer: transferCopy.buffer,
        config: pipelineCfg,
      };
      worker.postMessage(req, [req.rgbaBuffer]);
    },
    [],
  );

  // Load a user-provided File object (raw bytes, zero synthetic injection)
  const handleLoadUserFile = useCallback(
    async (file: File) => {
      setErrorMessage(null);
      setActiveSpecimenId(null);

      try {
        const rawBuf = await file.arrayBuffer();
        const forensics = inspectBinaryMetadata(rawBuf);
        const decoded = await decodeImageBufferToRgba(file);

        const previewBlob = await encodeRgbaToBlob(
          decoded.rgba,
          decoded.width,
          decoded.height,
          'png',
          1,
        );
        const previewUrl = URL.createObjectURL(previewBlob);
        if (prevSourceUrlRef.current) URL.revokeObjectURL(prevSourceUrlRef.current);
        prevSourceUrlRef.current = previewUrl;

        const loaded: LoadedImage = {
          filename: file.name,
          width: decoded.width,
          height: decoded.height,
          rgba: decoded.rgba,
          previewUrl,
        };

        setSourceImage(loaded);
        setOriginalForensics(forensics);
        setWashedForensics(null);
        executePipeline(loaded, configRef.current);
      } catch (err) {
        setErrorMessage(err instanceof Error ? err.message : 'Unable to decode uploaded image.');
      }
    },
    [executePipeline],
  );

  // Load a built-in lab specimen (with optional synthetic carrier + C2PA demonstration toggle)
  const loadSpecimen = useCallback(
    async (specimenId: string, withCarrier: boolean) => {
      const specimen = SPECIMEN_ASSETS.find((s) => s.id === specimenId) ?? SPECIMEN_ASSETS[0];
      setErrorMessage(null);
      setActiveSpecimenId(specimen.id);

      try {
        const response = await fetch(specimen.url);
        if (!response.ok) {
          throw new Error('Could not load bundled specimen image.');
        }
        const rawBuf = await response.arrayBuffer();
        const inspectedBytes = withCarrier
          ? injectSyntheticJpegProvenance(new Uint8Array(rawBuf))
          : new Uint8Array(rawBuf);

        const forensics = inspectBinaryMetadata(inspectedBytes.buffer as ArrayBuffer);
        const decoded = await decodeImageBufferToRgba(new Blob([rawBuf], { type: 'image/jpeg' }));

        const finalRgba = withCarrier
          ? applySyntheticTestCarrier(decoded.rgba, decoded.width, decoded.height)
          : decoded.rgba;

        const previewBlob = await encodeRgbaToBlob(
          finalRgba,
          decoded.width,
          decoded.height,
          'png',
          1,
        );
        const previewUrl = URL.createObjectURL(previewBlob);
        if (prevSourceUrlRef.current) URL.revokeObjectURL(prevSourceUrlRef.current);
        prevSourceUrlRef.current = previewUrl;

        const loaded: LoadedImage = {
          filename: specimen.filename,
          width: decoded.width,
          height: decoded.height,
          rgba: finalRgba,
          previewUrl,
        };

        setSourceImage(loaded);
        setOriginalForensics(forensics);
        setWashedForensics(null);
        executePipeline(loaded, configRef.current);
      } catch (err) {
        setErrorMessage(err instanceof Error ? err.message : 'Failed to initialize specimen.');
      }
    },
    [executePipeline],
  );

  // Initial specimen load on mount
  useEffect(() => {
    void loadSpecimen(SPECIMEN_ASSETS[0].id, true);
  }, [loadSpecimen]);

  // Global clipboard paste support for rapid forensic triage
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of items) {
        if (item.type.startsWith('image/')) {
          const file = item.getAsFile();
          if (file) {
            void handleLoadUserFile(file);
            break;
          }
        }
      }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [handleLoadUserFile]);

  const handleSelectPreset = (preset: Exclude<PresetKey, 'custom'>) => {
    const nextConfig: PipelineConfig = {
      ...PRESETS[preset].config,
      outputFormat: config.outputFormat,
    };
    setActivePreset(preset);
    setConfig(nextConfig);
    if (sourceImage) {
      executePipeline(sourceImage, nextConfig);
    }
  };

  const handleUpdateConfig = <K extends keyof PipelineConfig>(
    key: K,
    value: PipelineConfig[K],
  ) => {
    setConfig((prev) => ({ ...prev, [key]: value }));
    if (key !== 'outputFormat') {
      setActivePreset('custom');
    }
  };

  const handleRunPipeline = () => {
    if (!sourceImage) return;
    executePipeline(sourceImage, config);
  };

  const handleExportImage = () => {
    if (!processedBlob || !sourceImage) return;
    const baseName = sourceImage.filename.replace(/\.[^.]+$/, '');
    const ext = config.outputFormat === 'webp' ? 'webp' : 'png';
    const url = URL.createObjectURL(processedBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${baseName}_spectra_wash.${ext}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const handleToggleTestCarrier = (enabled: boolean) => {
    setTestCarrierEnabled(enabled);
    if (activeSpecimenId) {
      void loadSpecimen(activeSpecimenId, enabled);
    }
  };

  const handleResetDefaults = () => {
    const balanced = { ...PRESETS.balanced.config };
    setActivePreset('balanced');
    setConfig(balanced);
    if (sourceImage) {
      executePipeline(sourceImage, balanced);
    }
  };

  return (
    <div className="flex min-h-screen flex-col bg-[#09090b] text-zinc-100">
      {/* Hidden native file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/avif"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void handleLoadUserFile(file);
          e.target.value = '';
        }}
      />

      <Header onLoadImageClick={() => fileInputRef.current?.click()} />

      {errorMessage && (
        <div
          role="alert"
          className="border-b border-rose-500/40 bg-rose-950/40 px-6 py-2.5 text-xs text-rose-200"
        >
          {errorMessage}
        </div>
      )}

      {/* Primary Asymmetric Split Console Workspace */}
      <main id="workspace" className="flex flex-1 flex-col">
        <div className="mx-auto flex w-full max-w-[1600px] flex-1 flex-col lg:flex-row">
          <PipelineControls
            config={config}
            activePreset={activePreset}
            activeSpecimenId={activeSpecimenId}
            testCarrierEnabled={testCarrierEnabled}
            isProcessing={isProcessing}
            progress={progress}
            hasProcessedOutput={processedBlob !== null}
            onSelectPreset={handleSelectPreset}
            onUpdateConfig={handleUpdateConfig}
            onRunPipeline={handleRunPipeline}
            onExportImage={handleExportImage}
            onLoadSpecimen={(id) => void loadSpecimen(id, testCarrierEnabled)}
            onToggleTestCarrier={handleToggleTestCarrier}
            onOpenFilePicker={() => fileInputRef.current?.click()}
            onResetDefaults={handleResetDefaults}
          />

          <ImageStage
            filename={sourceImage?.filename ?? 'specimen.jpg'}
            width={sourceImage?.width ?? 0}
            height={sourceImage?.height ?? 0}
            originalUrl={sourceImage?.previewUrl ?? null}
            processedUrl={processedUrl}
            diffMagnitude={diffMagnitude}
            maskRgba={maskRgba}
            metrics={metrics}
            spectral={spectral}
            originalForensics={originalForensics}
            washedForensics={washedForensics}
            isProcessing={isProcessing}
            onFileDrop={(file) => void handleLoadUserFile(file)}
          />
        </div>

        {/* 2D FFT Spectral Anomaly Lab */}
        <SpectralLab spectral={spectral} metrics={metrics} />

        {/* Forensic C2PA / EXIF / XMP / IPTC Inspector */}
        <ForensicInspector
          originalForensics={originalForensics}
          washedForensics={washedForensics}
        />
      </main>

      {/* Quiet Minimal Footer */}
      <footer className="border-t border-zinc-800 bg-[#09090b] px-4 py-6 sm:px-6">
        <div className="mx-auto flex max-w-[1560px] flex-col items-start justify-between gap-3 text-xs text-zinc-500 sm:flex-row sm:items-center">
          <p>
            SPECTRA-WASH · 100% local browser processing · Zero external APIs or uploads
          </p>
          <div className="flex items-center gap-4">
            <a
              href="https://github.com/keyxerxes"
              target="_blank"
              rel="noopener noreferrer"
              className="text-zinc-400 transition-colors hover:text-cyan-400"
            >
              github.com/keyxerxes
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
