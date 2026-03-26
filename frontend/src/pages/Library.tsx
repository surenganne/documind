import { BookOpen } from 'lucide-react';
import { useEffect, useState } from 'react';
import { DocumentTreeModal } from '../components/library/DocumentTreeModal';
import { DocumentCard } from '../components/upload/DocumentCard';
import { useDocuments } from '../hooks/useDocuments';
import type { Document } from '../types';

export function Library() {
  const { knowledgeBases, documents, loadKnowledgeBases, loadDocuments } = useDocuments();
  const [selectedDoc, setSelectedDoc] = useState<Document | null>(null);

  useEffect(() => {
    loadKnowledgeBases();
    loadDocuments();
  }, []);

  return (
    <div className="p-6 flex flex-col gap-8">
      <h2 className="font-heading text-2xl font-semibold text-slate-800">Document Library</h2>

      {knowledgeBases.length === 0 && (
        <p className="text-sm text-slate-400">No knowledge bases found. Create one to get started.</p>
      )}

      {knowledgeBases.map((kb) => {
        const kbDocs = documents.filter((d) => d.kb_id === kb.id);
        return (
          <section key={kb.id}>
            <div className="flex items-center gap-2 mb-3">
              <BookOpen className="h-4 w-4 text-[var(--dm-primary)]" />
              <h3 className="font-heading text-lg font-semibold text-slate-700">{kb.name}</h3>
              <span className="text-xs text-slate-400">({kbDocs.length} doc{kbDocs.length !== 1 ? 's' : ''})</span>
            </div>

            {kbDocs.length === 0 ? (
              <p className="text-sm text-slate-400 pl-6">No documents in this knowledge base.</p>
            ) : (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {kbDocs.map((doc) => (
                  <button
                    key={doc.id}
                    onClick={() => setSelectedDoc(doc)}
                    className="text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--dm-primary)] rounded-lg"
                    aria-label={`View tree for ${doc.filename}`}
                  >
                    <DocumentCard document={doc} />
                  </button>
                ))}
              </div>
            )}
          </section>
        );
      })}

      <DocumentTreeModal
        document={selectedDoc}
        onClose={() => setSelectedDoc(null)}
      />
    </div>
  );
}
