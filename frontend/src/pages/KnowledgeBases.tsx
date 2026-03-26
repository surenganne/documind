import { BookOpen, Edit2, Plus, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { DocumentCard } from '../components/upload/DocumentCard';
import { DropZone } from '../components/upload/DropZone';
import { ProgressTracker } from '../components/upload/ProgressTracker';
import { useDocuments } from '../hooks/useDocuments';
import type { KnowledgeBase } from '../types';

export function KnowledgeBases() {
  const { knowledgeBases, documents, loadKnowledgeBases, loadDocuments, createKb, updateKb, deleteKb } = useDocuments();
  const [selectedKb, setSelectedKb] = useState<KnowledgeBase | null>(null);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [editingKb, setEditingKb] = useState<KnowledgeBase | null>(null);
  const [newKbName, setNewKbName] = useState('');
  const [newKbDesc, setNewKbDesc] = useState('');
  const [creating, setCreating] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);

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

  const handleEdit = (kb: KnowledgeBase, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingKb(kb);
    setNewKbName(kb.name);
    setNewKbDesc(kb.description || '');
  };

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingKb || !newKbName.trim()) return;
    setUpdating(true);
    try {
      await updateKb(editingKb.id, newKbName.trim(), newKbDesc.trim() || undefined);
      setEditingKb(null);
      setNewKbName('');
      setNewKbDesc('');
    } finally {
      setUpdating(false);
    }
  };

  const handleDelete = async (kb: KnowledgeBase, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm(`Delete "${kb.name}"? This will permanently delete all documents and files from S3.`)) return;
    setDeleting(kb.id);
    try {
      console.log('Deleting KB:', kb.id);
      await deleteKb(kb.id);
      console.log('KB deleted successfully:', kb.id);
      if (selectedKb?.id === kb.id) setSelectedKb(null);
    } catch (error) {
      console.error('Failed to delete KB:', error);
      alert(`Failed to delete knowledge base: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setDeleting(null);
    }
  };

  return (
    <div className="flex min-h-full gap-6 p-6">
      {/* KB list */}
      <aside className="w-72 shrink-0 flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-slate-900">Knowledge Bases</h2>
          <button
            onClick={() => setShowCreateForm((v) => !v)}
            className="flex items-center gap-1.5 rounded-lg bg-[var(--dm-primary)] px-3 py-2 text-sm font-medium text-white hover:bg-[var(--dm-primary-dark)] transition-colors shadow-sm"
            aria-label="Create knowledge base"
          >
            <Plus className="h-4 w-4" />
            New KB
          </button>
        </div>

        {showCreateForm && (
          <form onSubmit={handleCreate} className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <input
              required
              placeholder="Name *"
              value={newKbName}
              onChange={(e) => setNewKbName(e.target.value)}
              className="rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-[var(--dm-primary)] focus:ring-2 focus:ring-blue-100 transition-all"
            />
            <input
              placeholder="Description (optional)"
              value={newKbDesc}
              onChange={(e) => setNewKbDesc(e.target.value)}
              className="rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-[var(--dm-primary)] focus:ring-2 focus:ring-blue-100 transition-all"
            />
            <div className="flex gap-2">
              <button
                type="submit"
                disabled={creating}
                className="flex-1 rounded-lg bg-[var(--dm-primary)] py-2 text-sm font-medium text-white hover:bg-[var(--dm-primary-dark)] disabled:opacity-50 transition-colors shadow-sm"
              >
                {creating ? 'Creating…' : 'Create'}
              </button>
              <button
                type="button"
                onClick={() => setShowCreateForm(false)}
                className="flex-1 rounded-lg border border-slate-200 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors"
              >
                Cancel
              </button>
            </div>
          </form>
        )}

        <div className="flex flex-col gap-2">
          {knowledgeBases.length === 0 && (
            <p className="text-sm text-slate-500 text-center py-8">No knowledge bases yet. Create one to get started.</p>
          )}
          {knowledgeBases.map((kb) => (
            editingKb?.id === kb.id ? (
              <form key={kb.id} onSubmit={handleUpdate} className="flex flex-col gap-3 rounded-xl border border-[var(--dm-primary)] bg-white p-4 shadow-md">
                <input
                  required
                  placeholder="Name *"
                  value={newKbName}
                  onChange={(e) => setNewKbName(e.target.value)}
                  className="rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-[var(--dm-primary)] focus:ring-2 focus:ring-blue-100 transition-all"
                />
                <input
                  placeholder="Description (optional)"
                  value={newKbDesc}
                  onChange={(e) => setNewKbDesc(e.target.value)}
                  className="rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-[var(--dm-primary)] focus:ring-2 focus:ring-blue-100 transition-all"
                />
                <div className="flex gap-2">
                  <button
                    type="submit"
                    disabled={updating}
                    className="flex-1 rounded-lg bg-[var(--dm-primary)] py-2 text-sm font-medium text-white hover:bg-[var(--dm-primary-dark)] disabled:opacity-50 transition-colors shadow-sm"
                  >
                    {updating ? 'Saving…' : 'Save'}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setEditingKb(null);
                      setNewKbName('');
                      setNewKbDesc('');
                    }}
                    className="flex-1 rounded-lg border border-slate-200 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            ) : (
              <div
                key={kb.id}
                className={`flex items-start gap-3 rounded-xl border p-4 transition-all shadow-sm hover:shadow-md ${
                  selectedKb?.id === kb.id
                    ? 'border-[var(--dm-primary)] bg-[var(--dm-primary-light)] shadow-md'
                    : 'border-slate-200 bg-white hover:border-slate-300'
                }`}
              >
                <button
                  onClick={() => setSelectedKb(kb)}
                  className="flex items-start gap-3 flex-1 min-w-0 text-left"
                >
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-blue-50">
                    <BookOpen className="h-5 w-5 text-[var(--dm-primary)]" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-slate-900">{kb.name}</p>
                    {kb.description && (
                      <p className="truncate text-xs text-slate-600 mt-0.5">{kb.description}</p>
                    )}
                    <p className="text-xs text-slate-500 mt-1.5">
                      {kb.document_count} doc{kb.document_count !== 1 ? 's' : ''} ·{' '}
                      {new Date(kb.created_at).toLocaleDateString()}
                    </p>
                  </div>
                </button>
                <div className="flex gap-1 shrink-0">
                  <button
                    onClick={(e) => handleEdit(kb, e)}
                    className="p-2 rounded-lg hover:bg-slate-100 text-slate-600 hover:text-[var(--dm-primary)] transition-colors"
                    aria-label="Edit knowledge base"
                    title="Edit"
                  >
                    <Edit2 className="h-4 w-4" />
                  </button>
                  <button
                    onClick={(e) => handleDelete(kb, e)}
                    disabled={deleting === kb.id}
                    className="p-2 rounded-lg hover:bg-red-50 text-slate-600 hover:text-red-600 transition-colors disabled:opacity-50"
                    aria-label="Delete knowledge base"
                    title="Delete"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            )
          ))}
        </div>
      </aside>

      {/* KB detail */}
      <main className="flex-1 flex flex-col gap-6 min-w-0">
        {!selectedKb ? (
          <div className="flex flex-1 items-center justify-center text-slate-500">
            <p>Select a knowledge base to view documents</p>
          </div>
        ) : (
          <>
            <div>
              <h3 className="text-xl font-semibold text-slate-900">{selectedKb.name}</h3>
              {selectedKb.description && (
                <p className="text-sm text-slate-600 mt-1">{selectedKb.description}</p>
              )}
            </div>

            <DropZone kb_id={selectedKb.id} onUpload={() => loadDocuments(selectedKb.id)} />

            <ProgressTracker kb_id={selectedKb.id} documents={kbDocuments} />

            {completedDocuments.length === 0 && kbDocuments.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-slate-300 bg-slate-50 py-16 text-center">
                <BookOpen className="h-12 w-12 text-slate-400" />
                <p className="text-sm font-medium text-slate-600">No documents yet</p>
                <p className="text-xs text-slate-500">Upload your first document using the drop zone above</p>
              </div>
            ) : completedDocuments.length > 0 ? (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
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
