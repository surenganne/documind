import { File, FileText } from 'lucide-react';
import { useEffect, useState } from 'react';
import { cn } from '../../lib/utils';
import type { Document, DocumentStatus } from '../../types';

interface DocumentCardProps {
  document: Document;
  queuePosition?: number; // 1-based position in processing queue (1 = actively processing)
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function useElapsedTime(active: boolean) {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    if (!active) { setSeconds(0); return; }
    const t = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [active]);
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

const statusConfig: Record<DocumentStatus, { label: string; className: string }> = {
  uploading: { label: 'Uploading', className: 'bg-blue-100 text-blue-700' },
  processing: { label: 'Processing', className: 'bg-amber-100 text-amber-700' },
  ready: { label: 'Ready', className: 'bg-green-100 text-green-700' },
  failed: { label: 'Failed', className: 'bg-red-100 text-red-700' },
};

export function DocumentCard({ document, queuePosition }: DocumentCardProps) {
  const ext = document.file_type.toLowerCase().replace('.', '');
  const isTextFile = ['pdf', 'txt', 'md'].includes(ext);
  const Icon = isTextFile ? FileText : File;
  const status = statusConfig[document.status] ?? statusConfig.failed;
  const isProcessing = document.status === 'processing' || document.status === 'uploading';

  // Only count elapsed time when actively processing (position 1 or 2 with concurrency=2)
  const isActive = isProcessing && (queuePosition === undefined || queuePosition <= 2);
  const elapsed = useElapsedTime(isActive);

  return (
    <div className="relative flex flex-col gap-1.5 rounded-lg border border-slate-200 bg-white p-3 overflow-hidden">
      <div className="flex items-center gap-3">
        <Icon className="h-5 w-5 shrink-0 text-[var(--dm-primary)]" />

        <div className="flex-1 min-w-0">
          <p className="truncate text-sm font-medium text-slate-800">{document.filename}</p>
          <p className="text-xs text-slate-400">{formatSize(document.size_bytes)}</p>
        </div>

        {/* Only show status badge for completed/failed documents, not during processing */}
        {!isProcessing && (
          <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-xs font-medium', status.className)}>
            {status.label}
          </span>
        )}
      </div>

      {isProcessing && (
        <>
          {/* Animated progress bar */}
          <div className="h-1 w-full rounded-full bg-slate-100 overflow-hidden">
            {isActive ? (
              <div className="h-full bg-amber-400 rounded-full animate-[progress_2s_ease-in-out_infinite]"
                style={{ width: '60%', animation: 'indeterminate 1.5s ease-in-out infinite' }} />
            ) : (
              <div className="h-full w-full bg-slate-200 rounded-full" />
            )}
          </div>

          <div className="flex items-center justify-between text-xs text-slate-400">
            {isActive ? (
              <span>Processing… {elapsed}</span>
            ) : (
              <span>
                Queued{queuePosition !== undefined ? ` · #${queuePosition} in line` : ''}
              </span>
            )}
            <span className="text-slate-300">~30s avg</span>
          </div>
        </>
      )}
    </div>
  );
}
