import { Upload } from 'lucide-react';

interface HeaderProps {
  onLoadImageClick: () => void;
}

export function Header({ onLoadImageClick }: HeaderProps) {
  return (
    <header className="sticky top-0 z-30 h-14 border-b border-zinc-800 bg-[#09090b]/95 backdrop-blur-sm">
      <div className="mx-auto flex h-full max-w-[1600px] items-center justify-between gap-8 px-4 sm:px-6">
        {/* Zone 1: Single-line Brand Wordmark */}
        <a
          href="#workspace"
          className="shrink-0 whitespace-nowrap font-mono text-base font-semibold tracking-[0.14em] text-zinc-100 transition-colors hover:text-cyan-400"
        >
          SPECTRA-WASH
        </a>

        {/* Zone 2: Concise single-line navigation links */}
        <nav
          aria-label="Primary navigation"
          className="hidden items-center gap-7 text-sm font-medium text-zinc-400 md:flex"
        >
          <a
            href="#workspace"
            className="shrink-0 whitespace-nowrap transition-colors hover:text-zinc-100"
          >
            Workspace
          </a>
          <a
            href="#spectral-lab"
            className="shrink-0 whitespace-nowrap transition-colors hover:text-zinc-100"
          >
            Spectral Lab
          </a>
          <a
            href="#metadata"
            className="shrink-0 whitespace-nowrap transition-colors hover:text-zinc-100"
          >
            Metadata
          </a>
          <a
            href="https://github.com/keyxerxes"
            target="_blank"
            rel="noopener noreferrer"
            className="shrink-0 whitespace-nowrap transition-colors hover:text-zinc-100"
          >
            GitHub
          </a>
        </nav>

        {/* Zone 3: Single Primary Action */}
        <div className="flex shrink-0 items-center">
          <button
            type="button"
            onClick={onLoadImageClick}
            className="inline-flex h-9 shrink-0 cursor-pointer items-center gap-2 whitespace-nowrap rounded-md bg-cyan-500 px-4 text-xs font-semibold text-zinc-950 transition-colors hover:bg-cyan-400 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-400"
          >
            <Upload className="h-3.5 w-3.5" aria-hidden="true" />
            Load Image
          </button>
        </div>
      </div>
    </header>
  );
}
