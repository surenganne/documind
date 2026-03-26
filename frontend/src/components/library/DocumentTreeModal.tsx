import { AnimatePresence, motion } from 'framer-motion';
import { X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { fetchDocumentInsights } from '../../api/insights';
import type { Document } from '../../types';
import { TreeExplorer, type TreeJson, type TreeNode } from '../insights/TreeExplorer';

interface DocumentTreeModalProps {
  document: Document | null;
  onClose: () => void;
}

function SkeletonLoader() {
  return (
    <div className="flex flex-col gap-3 p-4 animate-pulse">
      <div className="h-4 bg-slate-200 rounded w-3/4" />
      <div className="h-4 bg-slate-200 rounded w-1/2" />
      <div className="h-4 bg-slate-200 rounded w-2/3" />
      <div className="h-4 bg-slate-200 rounded w-1/3" />
      <div className="h-4 bg-slate-200 rounded w-3/5" />
    </div>
  );
}

function ErrorState({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-3 p-8 text-center">
      <p className="text-sm text-slate-500">{message}</p>
    </div>
  );
}

export function DocumentTreeModal({ document, onClose }: DocumentTreeModalProps) {
  const [treeJson, setTreeJson] = useState<TreeJson | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!document) return;

    if (document.status !== 'ready') {
      setError('This document has not been indexed yet. Tree view is only available for ready documents.');
      return;
    }

    setLoading(true);
    setError(null);
    setTreeJson(null);

    fetchDocumentInsights(document.id)
      .then((insights) => {
        // tree_json may be null, an empty object, or a valid tree
        const raw = insights.tree_json as Record<string, unknown> | null | undefined;
        
        // Check if it's already in the expected format with nodes array
        if (raw && typeof raw === 'object' && Array.isArray(raw.nodes)) {
          setTreeJson(raw as unknown as TreeJson);
        } 
        // Check if it's a single root node with children (backend format)
        else if (raw && typeof raw === 'object' && 'children' in raw && Array.isArray(raw.children)) {
          // Transform backend format to frontend format
          const rootNode = raw as unknown as TreeNode;
          setTreeJson({
            doc_id: document.id,
            title: document.filename,
            nodes: rootNode.children || []
          });
        }
        else if (raw && typeof raw === 'object' && Object.keys(raw).length === 0) {
          setError('This document has not been indexed yet. Try again after processing completes.');
        } else {
          // tree_json exists but has unexpected shape — still try to render
          setTreeJson((raw ?? { doc_id: document.id, title: document.filename, nodes: [] }) as unknown as TreeJson);
        }
      })
      .catch((err) => {
        const status = err?.response?.status;
        if (status === 404) {
          setError('No index found for this document. It may still be processing.');
        } else {
          setError('Failed to load document tree. Please try again.');
        }
      })
      .finally(() => setLoading(false));
  }, [document]);

  // Reset state when modal closes
  useEffect(() => {
    if (!document) {
      setTreeJson(null);
      setError(null);
      setLoading(false);
    }
  }, [document]);

  return (
    <AnimatePresence>
      {document && (
        <>
          {/* Backdrop */}
          <motion.div
            key="backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 bg-black/40 z-40"
            onClick={onClose}
            aria-hidden="true"
          />

          {/* Slide-over panel */}
          <motion.div
            key="panel"
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', damping: 30, stiffness: 300 }}
            className="fixed right-0 top-0 h-full w-full max-w-3xl z-50 flex flex-col bg-white shadow-2xl"
            role="dialog"
            aria-modal="true"
            aria-label={`Document tree: ${document.filename}`}
          >
            {/* Header */}
            <div
              className="flex items-center justify-between px-5 py-4 border-b border-slate-200 shrink-0"
              style={{ background: 'var(--dm-surface)' }}
            >
              <div className="flex flex-col min-w-0">
                <h2
                  className="font-semibold text-slate-800 truncate text-base"
                  style={{ fontFamily: "'Playfair Display', serif" }}
                >
                  {document.filename}
                </h2>
                <p className="text-xs text-slate-400 mt-0.5">PageIndex Tree View</p>
              </div>
              <button
                onClick={onClose}
                className="ml-4 shrink-0 p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--dm-primary)]"
                aria-label="Close tree viewer"
              >
                <X size={18} />
              </button>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-hidden">
              {loading && <SkeletonLoader />}
              {error && <ErrorState message={error} />}
              {!loading && !error && treeJson && (
                <TreeExplorer treeJson={treeJson} docTitle={document.filename} />
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
