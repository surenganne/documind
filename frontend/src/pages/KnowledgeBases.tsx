import { BookOpen, Plus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { DocumentCard } from '../components/upload/DocumentCard';
import { DropZone } from '../components/upload/DropZone';
import { ProgressTracker } from '../components/upload/ProgressTracker';
import { useDocuments } from '../hooks/useDocuments';
import type { KnowledgeBase } from '../types';

export function KnowledgeBases() {
  const { knowledgeBases, documents, loadKnowledgeBases, loadDocuments, createKb } = useDocuments();
  const [selectedKb, setSelectedKb] = useState<KnowledgeBase | null>(null);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newKbName, setNewKbName] = useState('');
  const [newKbDesc, setNewKbDesc] = useState('');
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    loadKnowledgeBases();
  }, []);

  useEffect(() => {
    if (selectedKb) loadDocuments(selectedKb.id);
  }, [selectedKb]);

  const kbDocuments = selectedKb
    ? documents.filter((d) => d.kb_id === selectedKb.id)
    : [];

  // Docs shown in ProgressTracker — exclude from the main grid to avoid duplicates
  const completedDocuments = kbDocuments.filter(
    (d) => d.status !== 'processing' && d.status !== 'uploading'
  );

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newKbName.trim()) return;
    setCreating(true);
    try {
      await createKb(newKbName.trim(), newKbDesc.trim() || undefined);
      setNewKbName('');
      setNewKbDesc('');
      setShowCreateForm(false);
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="flex min-h-full gap-6 p-6">
      {/* KB list */}
      <aside className="w-72 shrink-0 flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <h2 className="font-heading text-lg font-semibold text-slate-800">Knowledge Bases</h2>
          <button
            onClick={() => setShowCreateForm((v) => !v)}
            className="flex items-center gap-1 rounded-lg bg-[var(--dm-primary)] px-3 py-1.5 text-xs font-medium text-white hover:bg-[var(--dm-primary-dark)] transition-colors"
            aria-label="Create knowledge base"
          >
            <Plus className="h-3.5 w-3.5" />
            New KB
          </button>
        </div>

        {showCreateForm && (
          <form onSubmit={handleCreate} className="flex flex-col gap-2 rounded-xl border border-slate-200 bg-white p-4">
            <input
              required
              placeholder="Name *"
              value={newKbName}
              onChange={(e) => setNewKbName(e.target.value)}
              className="rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[var(--dm-primary)]"
            />
            <input
              placeholder="Description (optional)"
              value={newKbDesc}
              onChange={(e) => setNewKbDesc(e.target.value)}
              className="rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[var(--dm-primary)]"
            />
            <div className="flex gap-2">
              <button
                type="submit"
                disabled={creating}
                className="flex-1 rounded-lg bg-[var(--dm-primary)] py-1.5 text-xs font-medium text-white hover:bg-[var(--dm-primary-dark)] disabled:opacity-50 transition-colors"
              >
                {creating ? 'Creating…' : 'Create'}
              </button>
              <button
                type="button"
                onClick={() => setShowCreateForm(false)}
                className="flex-1 rounded-lg border border-slate-200 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 transition-colors"
              >
                Cancel
              </button>
            </div>
          </form>
        )}

        <div className="flex flex-col gap-2">
          {knowledgeBases.length === 0 && (
            <p className="text-sm text-slate-400 text-center py-8">No knowledge bases yet. Create one to get started.</p>
          )}
          {knowledgeBases.map((kb) => (
            <button
              key={kb.id}
              onClick={() => setSelectedKb(kb)}
              className={`flex items-start gap-3 rounded-xl border p-3 text-left transition-colors ${
                selectedKb?.id === kb.id
                  ? 'border-[var(--dm-primary)] bg-[var(--dm-primary-light)]'
                  : 'border-slate-200 bg-white hover:bg-slate-50'
              }`}
            >
              <BookOpen className="mt-0.5 h-4 w-4 shrink-0 text-[var(--dm-primary)]" />
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-slate-800">{kb.name}</p>
                {kb.description && (
                  <p className="truncate text-xs text-slate-400">{kb.description}</p>
                )}
                <p className="text-xs text-slate-400 mt-0.5">
                  {kb.document_count} doc{kb.document_count !== 1 ? 's' : ''} ·{' '}
                  {new Date(kb.created_at).toLocaleDateString()}
                </p>
              </div>
            </button>
          ))}
        </div>
      </aside>

      {/* KB detail */}
      <main className="flex-1 flex flex-col gap-6 min-w-0">
        {!selectedKb ? (
          <div className="flex flex-1 items-center justify-center text-slate-400">
            <p>Select a knowledge base to view documents</p>
          </div>
        ) : (
          <>
            <div>
              <h3 className="font-heading text-xl font-semibold text-slate-800">{selectedKb.name}</h3>
              {selectedKb.description && (
                <p className="text-sm text-slate-500 mt-1">{selectedKb.description}</p>
              )}
            </div>

            <DropZone kb_id={selectedKb.id} onUpload={() => loadDocuments(selectedKb.id)} />

            <ProgressTracker kb_id={selectedKb.id} documents={kbDocuments} />

            {completedDocuments.length === 0 && kbDocuments.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-slate-200 py-16 text-center">
                <BookOpen className="h-10 w-10 text-slate-300" />
                <p className="text-sm font-medium text-slate-500">No documents yet</p>
                <p className="text-xs text-slate-400">Upload your first document using the drop zone above</p>
              </div>
            ) : completedDocuments.length > 0 ? (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {completedDocuments.map((doc) => (
                  <DocumentCard key={doc.id} document={doc} />
                ))}
              </div>
            ) : null}
          </>
        )}
      </main>
    </div>
  );
}
