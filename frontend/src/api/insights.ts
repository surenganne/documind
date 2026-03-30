import { apiClient } from './client';

export interface KeyEntities {
  people?: string[];
  organizations?: string[];
  dates?: string[];
  amounts?: string[];
}

export interface DocumentInsights {
  doc_id: string;
  executive_summary: string | null;
  key_entities: KeyEntities | null;
  document_tags: string[] | null;
  complexity_score: number | null;
  tree_json: object;
}

export async function fetchDocumentInsights(docId: string): Promise<DocumentInsights> {
  const { data } = await apiClient.get<DocumentInsights>(`/insights/${docId}`);
  return data;
}
