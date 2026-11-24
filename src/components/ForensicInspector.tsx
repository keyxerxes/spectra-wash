import { AlertTriangle, CheckCircle2, FileSearch, ShieldCheck } from 'lucide-react';
import { formatBytes } from '../engine/heatmapLut';
import type { ForensicReport } from '../types/spectra';

interface ForensicInspectorProps {
  originalForensics: ForensicReport | null;
  washedForensics: ForensicReport | null;
}

function StatusLabel({ status }: { status: ForensicReport['status'] }) {
  if (status === 'ai-signatures-detected') {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-400">
        <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
        AI / C2PA signatures detected
      </span>
    );
  }
  if (status === 'metadata-present') {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-cyan-400">
        <FileSearch className="h-3.5 w-3.5" aria-hidden="true" />
        Non-critical metadata present
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-400">
      <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
      Verified clean container
    </span>
  );
}

function ChunkTable({
  title,
  report,
  mode,
}: {
  title: string;
  report: ForensicReport | null;
  mode: 'input' | 'output';
}) {
  return (
    <div className="flex flex-col border border-zinc-800 bg-[#0d0d10]">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-800 px-4 py-3">
        <div>
          <h3 className="text-sm font-semibold text-zinc-100">{title}</h3>
          {report ? (
            <div className="mt-0.5 flex flex-wrap items-center gap-2 font-mono text-xs text-zinc-500">
              <span>{report.containerFormat}</span>
              <span aria-hidden="true">·</span>
              <span className="tabular-nums">{formatBytes(report.fileSizeBytes)}</span>
              <span aria-hidden="true">·</span>
              <span className="tabular-nums">{report.totalChunks} segments</span>
            </div>
          ) : (
            <p className="mt-0.5 text-xs text-zinc-500">Waiting for binary buffer…</p>
          )}
        </div>
        {report && <StatusLabel status={report.status} />}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-left text-xs">
          <thead>
            <tr className="border-b border-zinc-800 bg-zinc-950/60 font-mono text-[11px] text-zinc-500">
              <th className="px-4 py-2.5 font-medium">Segment</th>
              <th className="px-4 py-2.5 font-medium">Offset</th>
              <th className="px-4 py-2.5 font-medium">Size</th>
              <th className="px-4 py-2.5 font-medium">Classification</th>
              <th className="px-4 py-2.5 text-right font-medium">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-800/70">
            {!report || report.chunks.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-zinc-500">
                  No binary chunks parsed yet.
                </td>
              </tr>
            ) : (
              report.chunks.map((chunk) => (
                <tr
                  key={chunk.id}
                  className={
                    chunk.flagged ? 'bg-amber-500/[0.04]' : 'hover:bg-zinc-900/40'
                  }
                >
                  <td className="px-4 py-2.5 font-mono font-medium text-zinc-200">
                    {chunk.type}
                  </td>
                  <td className="px-4 py-2.5 font-mono tabular-nums text-zinc-500">
                    0x{chunk.offset.toString(16).padStart(6, '0')}
                  </td>
                  <td className="px-4 py-2.5 font-mono tabular-nums text-zinc-400">
                    {formatBytes(chunk.size)}
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="text-zinc-300">{chunk.summary}</div>
                    {chunk.rawSnippet && (
                      <div className="mt-1 max-w-md truncate font-mono text-[11px] text-zinc-500">
                        {chunk.rawSnippet}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono text-[11px] whitespace-nowrap">
                    {mode === 'input' ? (
                      chunk.flagged ? (
                        <span className="text-amber-400">Stripped</span>
                      ) : chunk.category === 'color' || chunk.category === 'ancillary' ? (
                        <span className="text-zinc-400">Scrubbed</span>
                      ) : (
                        <span className="text-zinc-500">Pixel Data</span>
                      )
                    ) : (
                      <span className="text-emerald-400">Clean</span>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function ForensicInspector({
  originalForensics,
  washedForensics,
}: ForensicInspectorProps) {
  const signatures = originalForensics?.signatures ?? [];

  return (
    <section
      id="metadata"
      className="scroll-mt-14 border-t border-zinc-800 bg-[#09090b] px-4 py-10 sm:px-6 lg:px-8"
    >
      <div className="mx-auto max-w-[1560px]">
        <div className="flex flex-wrap items-end justify-between gap-4 border-b border-zinc-800 pb-5">
          <div>
            <h2 className="text-xl font-semibold tracking-tight text-zinc-100">
              Forensic Binary &amp; C2PA Inspector
            </h2>
            <p className="mt-1 max-w-2xl text-sm text-zinc-400">
              Direct byte-stream inspection of JPEG APP segments, PNG ancillary chunks, and WebP
              RIFF blocks comparing source metadata against the scrubbed raw re-encode.
            </p>
          </div>

          {originalForensics && (
            <div className="flex flex-wrap items-center gap-3 font-mono text-xs text-zinc-400">
              <span>
                C2PA:{' '}
                <strong className={originalForensics.hasC2PA ? 'text-amber-400' : 'text-zinc-300'}>
                  {originalForensics.hasC2PA ? 'Present' : 'None'}
                </strong>
              </span>
              <span aria-hidden="true">·</span>
              <span>
                EXIF:{' '}
                <strong className={originalForensics.hasExif ? 'text-amber-400' : 'text-zinc-300'}>
                  {originalForensics.hasExif ? 'Present' : 'None'}
                </strong>
              </span>
              <span aria-hidden="true">·</span>
              <span>
                XMP:{' '}
                <strong className={originalForensics.hasXmp ? 'text-amber-400' : 'text-zinc-300'}>
                  {originalForensics.hasXmp ? 'Present' : 'None'}
                </strong>
              </span>
              <span aria-hidden="true">·</span>
              <span>
                IPTC:{' '}
                <strong className={originalForensics.hasIptc ? 'text-amber-400' : 'text-zinc-300'}>
                  {originalForensics.hasIptc ? 'Present' : 'None'}
                </strong>
              </span>
            </div>
          )}
        </div>

        {/* Detected Provenance Signatures Panel */}
        <div className="mt-6 border border-zinc-800 bg-[#0d0d10] p-4 sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-zinc-100">
              Detected AI &amp; Provenance Signatures (Source Input)
            </h3>
            <span className="font-mono text-xs text-zinc-500">
              {signatures.length} signature{signatures.length === 1 ? '' : 's'} matched
            </span>
          </div>

          {signatures.length === 0 ? (
            <div className="mt-3 flex items-center gap-2.5 text-xs text-zinc-400">
              <ShieldCheck className="h-4 w-4 text-emerald-400" aria-hidden="true" />
              <span>
                No C2PA, Google AI / SynthID, OpenAI, Adobe Firefly, or Stable Diffusion metadata
                tags were found in the input container bytes.
              </span>
            </div>
          ) : (
            <div className="mt-4 divide-y divide-zinc-800 border-t border-zinc-800">
              {signatures.map((sig, i) => (
                <div
                  key={`${sig.vendor}-${sig.tag}-${i}`}
                  className="grid grid-cols-1 gap-2 py-3 sm:grid-cols-12 sm:items-center"
                >
                  <div className="sm:col-span-3">
                    <div className="text-xs font-semibold text-zinc-100">{sig.tag}</div>
                    <div className="mt-0.5 text-[11px] text-zinc-500">
                      {sig.vendor} · {sig.category}
                    </div>
                  </div>
                  <div className="sm:col-span-7">
                    <code className="block truncate rounded bg-zinc-950 px-2.5 py-1.5 font-mono text-[11px] text-zinc-300">
                      {sig.evidence}
                    </code>
                  </div>
                  <div className="text-left font-mono text-[11px] sm:col-span-2 sm:text-right">
                    {washedForensics && washedForensics.signatures.length === 0 ? (
                      <span className="text-emerald-400">Scrubbed in output</span>
                    ) : (
                      <span className="text-amber-400">Detected in input</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Before vs After Binary Container Chunk Audit */}
        <div className="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-2">
          <ChunkTable
            title="Source Binary Segments (Before Wash)"
            report={originalForensics}
            mode="input"
          />
          <ChunkTable
            title="Re-Encoded Output Segments (After Wash)"
            report={washedForensics}
            mode="output"
          />
        </div>
      </div>
    </section>
  );
}
