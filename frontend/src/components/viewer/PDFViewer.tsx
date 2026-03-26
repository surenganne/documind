import { ChevronLeft, ChevronRight, ZoomIn, ZoomOut } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';

// Use CDN worker to avoid bundling issues
pdfjs.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.js`;

const ZOOM_STEP = 0.25;
const ZOOM_MIN = 0.5;
const ZOOM_MAX = 3.0;
const ZOOM_DEFAULT = 1.0;
// Base page width at 100% zoom
const BASE_WIDTH = 750;

interface PDFViewerProps {
  url: string | null;
  currentPage?: number;
  highlight?: string; // text excerpt to highlight
  onPageChange?: (page: number) => void;
}

/** Normalize text for fuzzy matching — collapse whitespace, lowercase */
function normalize(s: string) {
  return s.replace(/\s+/g, ' ').trim().toLowerCase();
}

/** Find and highlight spans in the text layer that match the excerpt */
function highlightExcerpt(container: HTMLElement, excerpt: string) {
  container.querySelectorAll('.pdf-highlight').forEach((el) => {
    const span = el as HTMLElement;
    span.style.background = '';
    span.style.borderRadius = '';
    span.classList.remove('pdf-highlight');
  });

  if (!excerpt) return;

  const target = normalize(excerpt).slice(0, 120);
  const spans = Array.from(container.querySelectorAll('span')) as HTMLElement[];

  let accumulated = '';
  const matchSpans: HTMLElement[] = [];
  let matched = false;

  for (const span of spans) {
    const text = normalize(span.textContent ?? '');
    if (!text) continue;
    accumulated += ' ' + text;
    accumulated = accumulated.trim();

    if (!matched && accumulated.includes(target.slice(0, 40))) {
      matchSpans.push(span);
      if (accumulated.includes(target)) {
        matched = true;
        break;
      }
    } else if (matchSpans.length > 0 && !matched) {
      matchSpans.push(span);
      if (accumulated.includes(target)) {
        matched = true;
        break;
      }
    }
  }

  const firstWords = target.split(' ').slice(0, 6).join(' ');
  const toHighlight = matched && matchSpans.length > 0
    ? matchSpans
    : spans.filter((s) => normalize(s.textContent ?? '').includes(firstWords));

  toHighlight.forEach((span) => {
    span.style.background = 'rgba(251, 191, 36, 0.5)';
    span.style.borderRadius = '2px';
    span.classList.add('pdf-highlight');
  });

  if (toHighlight[0]) {
    toHighlight[0].scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
}

export function PDFViewer({ url, currentPage = 1, highlight, onPageChange }: PDFViewerProps) {
  const [numPages, setNumPages] = useState<number>(0);
  const [page, setPage] = useState(currentPage);
  const [zoom, setZoom] = useState(ZOOM_DEFAULT);
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Fetch PDF as blob with Authorization header to avoid 401
  useEffect(() => {
    if (!url) { setBlobUrl(null); return; }
    let objectUrl: string | null = null;
    const token = localStorage.getItem('access_token') ?? '';
    fetch(url, { headers: { Authorization: `Bearer ${token}` } })
      .then((res) => {
        if (!res.ok) throw new Error(`PDF fetch failed: ${res.status}`);
        return res.blob();
      })
      .then((blob) => {
        objectUrl = URL.createObjectURL(blob);
        setBlobUrl(objectUrl);
      })
      .catch(() => setBlobUrl(null));
    return () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [url]);

  useEffect(() => {
    setPage(currentPage);
  }, [currentPage, url]);

  const goTo = (p: number) => {
    const clamped = Math.max(1, Math.min(p, numPages));
    setPage(clamped);
    onPageChange?.(clamped);
  };

  const zoomIn = () => setZoom((z) => Math.min(+(z + ZOOM_STEP).toFixed(2), ZOOM_MAX));
  const zoomOut = () => setZoom((z) => Math.max(+(z - ZOOM_STEP).toFixed(2), ZOOM_MIN));
  const resetZoom = () => setZoom(ZOOM_DEFAULT);

  const handleTextLayerRendered = () => {
    if (highlight && containerRef.current) {
      setTimeout(() => {
        if (containerRef.current) highlightExcerpt(containerRef.current, highlight);
      }, 100);
    }
  };

  if (!url) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-slate-400">
        Click a citation to open the document
      </div>
    );
  }

  if (!blobUrl) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-slate-400">
        <div className="animate-pulse">Loading document…</div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Toolbar */}
      <div className="flex items-center justify-between border-b border-slate-200 px-3 py-2 text-xs text-slate-600 gap-2 shrink-0">
        {/* Page navigation */}
        <div className="flex items-center gap-1">
          <button
            onClick={() => goTo(page - 1)}
            disabled={page <= 1}
            className="rounded p-1 hover:bg-slate-100 disabled:opacity-30 transition-colors"
            aria-label="Previous page"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="tabular-nums min-w-[80px] text-center">
            {page} / {numPages || '—'}
          </span>
          <button
            onClick={() => goTo(page + 1)}
            disabled={page >= numPages}
            className="rounded p-1 hover:bg-slate-100 disabled:opacity-30 transition-colors"
            aria-label="Next page"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>

        {/* Zoom controls */}
        <div className="flex items-center gap-1">
          <button
            onClick={zoomOut}
            disabled={zoom <= ZOOM_MIN}
            className="rounded p-1 hover:bg-slate-100 disabled:opacity-30 transition-colors"
            aria-label="Zoom out"
          >
            <ZoomOut className="h-4 w-4" />
          </button>
          <button
            onClick={resetZoom}
            className="rounded px-2 py-0.5 text-xs font-mono hover:bg-slate-100 transition-colors min-w-[48px] text-center"
            aria-label="Reset zoom"
            title="Click to reset zoom"
          >
            {Math.round(zoom * 100)}%
          </button>
          <button
            onClick={zoomIn}
            disabled={zoom >= ZOOM_MAX}
            className="rounded p-1 hover:bg-slate-100 disabled:opacity-30 transition-colors"
            aria-label="Zoom in"
          >
            <ZoomIn className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* PDF canvas */}
      <div ref={containerRef} className="flex-1 overflow-auto flex justify-center bg-slate-100 p-4">
        <Document
          file={blobUrl}
          onLoadSuccess={({ numPages: n }) => setNumPages(n)}
          loading={<div className="animate-pulse rounded bg-slate-200 h-64 w-full" />}
        >
          <Page
            pageNumber={page}
            width={Math.round(BASE_WIDTH * zoom)}
            renderTextLayer
            renderAnnotationLayer
            onRenderTextLayerSuccess={handleTextLayerRendered}
          />
        </Document>
      </div>
    </div>
  );
}
