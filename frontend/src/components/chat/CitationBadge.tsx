import { FileText } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { Citation } from '../../types';

interface CitationBadgeProps {
  citation: Citation;
  index: number;
  onClick?: () => void;
}

export function CitationBadge({ citation, index, onClick }: CitationBadgeProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Short label: strip extension, truncate
  const shortName = citation.filename.replace(/\.[^.]+$/, '');
  const label = shortName.length > 20 ? shortName.slice(0, 18) + '…' : shortName;

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  return (
    <div ref={ref} className="relative inline-block">
      <button
        onClick={() => { setOpen((v) => !v); onClick?.(); }}
        className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600 hover:bg-[var(--dm-primary-light)] hover:border-[var(--dm-primary)] hover:text-[var(--dm-primary)] transition-colors cursor-pointer"
        aria-label={`Citation ${index + 1}: ${citation.filename}, page ${citation.page_number}`}
      >
        <FileText className="h-3 w-3 shrink-0" />
        <span>{label}</span>
        <span className="text-slate-400">·</span>
        <span>p.{citation.page_number}</span>
      </button>

      {open && (
        <div className="absolute bottom-full left-0 mb-2 z-50 w-72 rounded-xl border border-slate-200 bg-white shadow-lg p-3 text-left">
          {/* Arrow */}
          <div className="absolute -bottom-1.5 left-4 h-3 w-3 rotate-45 border-b border-r border-slate-200 bg-white" />

          <div className="flex items-start gap-2">
            <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-[var(--dm-primary-light)]">
              <FileText className="h-4 w-4 text-[var(--dm-primary)]" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-semibold text-slate-800">{citation.filename}</p>
              <p className="text-xs text-slate-400">Page {citation.page_number}</p>
            </div>
          </div>

          {citation.excerpt && (
            <p className="mt-2 line-clamp-3 text-xs leading-relaxed text-slate-600 italic border-l-2 border-[var(--dm-primary)] pl-2">
              "{citation.excerpt}"
            </p>
          )}

          <button
            onClick={onClick}
            className="mt-2 w-full rounded-lg bg-[var(--dm-primary-light)] py-1.5 text-xs font-medium text-[var(--dm-primary)] hover:bg-[var(--dm-primary)] hover:text-white transition-colors"
          >
            Open in document
          </button>
        </div>
      )}
    </div>
  );
}
