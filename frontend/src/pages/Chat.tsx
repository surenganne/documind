import { AnimatePresence, motion } from 'framer-motion';
import { BookOpen, FileText, Plus, Send, Trash2, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { MessageBubble } from '../components/chat/MessageBubble';
import { StreamingIndicator } from '../components/chat/StreamingIndicator';
import { PDFViewer } from '../components/viewer/PDFViewer';
import { SectionJumper } from '../components/viewer/SectionJumper';
import { useChat } from '../hooks/useChat';
import { useDocuments } from '../hooks/useDocuments';
import { useUIStore } from '../stores/uiStore';

export function Chat() {
  const { sessions, activeSessionId, messages, isStreaming, streamingContent, loadSessions, createSession, sendMessage, setActiveSession, deleteSession } = useChat();
  const { knowledgeBases, documents, loadKnowledgeBases, loadDocuments } = useDocuments();
  const { pdfViewerDocId, pdfViewerPage, pdfViewerHighlight, setPdfDoc, setPdfPage, setPdfHighlight } = useUIStore();

  const [input, setInput] = useState('');
  const [jumpDoc, setJumpDoc] = useState<string | null>(null);
  const [jumpPage, setJumpPage] = useState<number | null>(null);
  const [pdfDrawerOpen, setPdfDrawerOpen] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    loadSessions();
    loadKnowledgeBases();
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isStreaming]);

  const activeSession = sessions.find((s) => s.id === activeSessionId);
  const kbDocuments = activeSession
    ? documents.filter((d) => d.kb_id === activeSession.kb_id)
    : [];

  const handleNewSession = async (kb_id: string) => {
    await createSession(kb_id);
    loadDocuments(kb_id);
  };

  const handleSend = async () => {
    const text = input.trim();
    if (!text || isStreaming || !activeSessionId) return;
    setInput('');
    await sendMessage(text);
  };

  const handleCitationClick = (docId: string, page: number, excerpt?: string) => {
    setJumpDoc(docId);
    setJumpPage(page);
    setPdfDoc(docId);
    setPdfPage(page);
    setPdfHighlight(excerpt ?? null);
    setPdfDrawerOpen(true);
  };

  // Build PDF URL from doc ID
  const pdfUrl = pdfViewerDocId
    ? `/api/v1/documents/${pdfViewerDocId}/file`
    : null;

  return (
    <div className="flex h-full overflow-hidden">
      <SectionJumper docId={jumpDoc} page={jumpPage} />

      {/* Left panel — 280px */}
      <aside className="w-[280px] shrink-0 flex flex-col border-r border-slate-200 bg-[var(--dm-surface)]">
        {/* KB selector */}
        <div className="border-b border-slate-200 p-3">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">Knowledge Base</p>
          <div className="flex flex-col gap-1">
            {knowledgeBases.map((kb) => (
              <button
                key={kb.id}
                onClick={() => handleNewSession(kb.id)}
                className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm text-slate-700 hover:bg-[var(--dm-primary-light)] transition-colors"
              >
                <BookOpen className="h-3.5 w-3.5 text-[var(--dm-primary)]" />
                {kb.name}
              </button>
            ))}
            {knowledgeBases.length === 0 && (
              <p className="text-xs text-slate-400 px-2">No knowledge bases. Create one first.</p>
            )}
          </div>
        </div>

        {/* Document library for active KB */}
        {activeSession && (
          <div className="border-b border-slate-200 p-3 flex-1 overflow-y-auto">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">Documents</p>
            <div className="flex flex-col gap-1">
              {kbDocuments.map((doc) => (
                <button
                  key={doc.id}
                  onClick={() => handleCitationClick(doc.id, 1)}
                  className="flex items-center gap-1.5 truncate rounded px-2 py-1 text-left text-xs text-slate-600 hover:bg-[var(--dm-primary-light)] transition-colors"
                >
                  <FileText className="h-3 w-3 shrink-0 text-[var(--dm-primary)]" />
                  <span className="truncate">{doc.filename}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Session navigator */}
        <div className="p-3 overflow-y-auto">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">Sessions</p>
          <div className="flex flex-col gap-1">
            {sessions.map((s) => (
              <div
                key={s.id}
                className={`group flex items-center gap-1 rounded-lg transition-colors ${
                  s.id === activeSessionId
                    ? 'bg-[var(--dm-primary-light)]'
                    : 'hover:bg-slate-100'
                }`}
              >
                <button
                  onClick={() => setActiveSession(s.id)}
                  className={`flex-1 truncate px-2 py-1.5 text-left text-xs transition-colors ${
                    s.id === activeSessionId
                      ? 'text-[var(--dm-primary)] font-medium'
                      : 'text-slate-600'
                  }`}
                >
                  {s.title || 'Untitled session'}
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); deleteSession(s.id); }}
                  className="mr-1 rounded p-1 text-slate-300 opacity-0 group-hover:opacity-100 hover:text-red-500 hover:bg-red-50 transition-all"
                  aria-label="Delete session"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
        </div>
      </aside>

      {/* Center panel — flex */}
      <main className="flex flex-1 flex-col min-w-0">
        {!activeSessionId ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-4 text-slate-400">
            <Plus className="h-10 w-10" />
            <p className="text-sm">Select a knowledge base on the left to start a new session</p>
          </div>
        ) : (
          <>
            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4">
              {messages.map((msg) => (
                <MessageBubble
                  key={msg.id}
                  message={msg}
                  onCitationClick={handleCitationClick}
                />
              ))}

              {isStreaming && (
                <div className="flex flex-col gap-2 items-start">
                  {streamingContent ? (
                    <div className="max-w-[80%] rounded-2xl rounded-bl-sm border border-slate-200 bg-white px-4 py-3 text-sm text-slate-800">
                      {streamingContent}
                    </div>
                  ) : (
                    <StreamingIndicator />
                  )}
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>

            {/* Input */}
            <div className="border-t border-slate-200 p-4">
              <div className="flex items-end gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 focus-within:ring-2 focus-within:ring-[var(--dm-primary)]">
                <textarea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      handleSend();
                    }
                  }}
                  placeholder="Ask a question about your documents…"
                  rows={1}
                  className="flex-1 resize-none bg-transparent text-sm text-slate-800 outline-none placeholder:text-slate-400"
                  aria-label="Chat input"
                />
                <button
                  onClick={handleSend}
                  disabled={!input.trim() || isStreaming}
                  className="rounded-lg bg-[var(--dm-primary)] p-1.5 text-white hover:bg-[var(--dm-primary-dark)] disabled:opacity-40 transition-colors"
                  aria-label="Send message"
                >
                  <Send className="h-4 w-4" />
                </button>
              </div>
            </div>
          </>
        )}
      </main>

      {/* Right panel — PDF drawer */}
      <AnimatePresence>
        {pdfDrawerOpen && (
          <>
            {/* Backdrop */}
            <motion.div
              key="pdf-backdrop"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="fixed inset-0 bg-black/30 z-40"
              onClick={() => setPdfDrawerOpen(false)}
              aria-hidden="true"
            />

            {/* Drawer */}
            <motion.aside
              key="pdf-drawer"
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ type: 'spring', damping: 30, stiffness: 300 }}
              className="fixed right-0 top-0 h-full w-full max-w-[800px] z-50 flex flex-col bg-white shadow-2xl border-l border-slate-200"
              role="dialog"
              aria-modal="true"
              aria-label="PDF viewer"
            >
              {/* Drawer header */}
              <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 shrink-0 bg-[var(--dm-surface)]">
                <span
                  className="text-sm font-semibold text-slate-700"
                  style={{ fontFamily: "'Playfair Display', serif" }}
                >
                  Document Viewer
                </span>
                <button
                  onClick={() => setPdfDrawerOpen(false)}
                  className="rounded-lg p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--dm-primary)]"
                  aria-label="Close PDF viewer"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              {/* PDF viewer fills remaining height */}
              <div className="flex-1 overflow-hidden">
                <PDFViewer
                  url={pdfUrl}
                  currentPage={pdfViewerPage}
                  highlight={pdfViewerHighlight ?? undefined}
                  onPageChange={setPdfPage}
                />
              </div>
            </motion.aside>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
