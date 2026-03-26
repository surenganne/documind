import {
    createKnowledgeBase,
    deleteKnowledgeBase,
    getDocument,
    getDocuments,
    getKnowledgeBases,
    uploadDocument,
} from '../api/documents';
import { useDocumentStore } from '../stores/documentStore';

export function useDocuments() {
  const store = useDocumentStore();

  const loadKnowledgeBases = async () => {
    const kbs = await getKnowledgeBases();
    store.setKnowledgeBases(kbs);
  };

  const loadDocuments = async (kb_id?: string) => {
    const docs = await getDocuments(kb_id);
    store.setDocuments(docs);
  };

  const uploadFile = async (file: File, kb_id: string) => {
    store.addToUploadQueue({ file, kb_id, progress: 0, status: 'uploading' });

    try {
      await uploadDocument(file, kb_id, (pct) => {
        store.updateUploadProgress(file.name, pct, 'uploading');
      });
      store.updateUploadProgress(file.name, 100, 'done');
      await loadDocuments(kb_id);
    } catch {
      store.updateUploadProgress(file.name, 0, 'error');
    }
  };

  const deleteKb = async (kb_id: string) => {
    await deleteKnowledgeBase(kb_id);
    await loadKnowledgeBases();
  };

  const createKb = async (name: string, description?: string) => {
    await createKnowledgeBase(name, description);
    await loadKnowledgeBases();
  };

  const pollDocumentStatus = (doc_id: string, interval = 3000) => {
    const timer = setInterval(async () => {
      try {
        const doc = await getDocument(doc_id);
        
        // Update the document in the store (adds if not exists)
        store.updateDocument(doc);
        
        // Stop polling when processing is complete
        if (doc.status === 'ready' || doc.status === 'failed') {
          clearInterval(timer);
        }
      } catch {
        clearInterval(timer);
      }
    }, interval);

    return () => clearInterval(timer);
  };

  return {
    documents: store.documents,
    knowledgeBases: store.knowledgeBases,
    activeKbId: store.activeKbId,
    uploadQueue: store.uploadQueue,
    loadKnowledgeBases,
    loadDocuments,
    uploadFile,
    deleteKb,
    createKb,
    pollDocumentStatus,
  };
}
