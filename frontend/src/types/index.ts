// Document status
export type DocumentStatus = 'uploading' | 'processing' | 'ready' | 'failed';

// Chat types
export interface Citation {
  document_id: string;
  filename: string;
  page_number: number;
  node_id: string;
  excerpt: string;
}

export interface ReasoningTrace {
  step: number;
  node_id: string;
  reasoning: string;
  confidence: number;
}

export interface ChatMessage {
  id: string;
  session_id: string;
  role: 'user' | 'assistant';
  content: string;
  citations?: Citation[];
  reasoning_trace?: ReasoningTrace[];
  created_at: string;
}

export interface ChatSession {
  id: string;
  kb_id: string;
  title: string;
  created_at: string;
}

// Document types
export interface Document {
  id: string;
  kb_id: string;
  filename: string;
  file_type: string;
  size_bytes: number;
  status: DocumentStatus;
  created_at: string;
}

export interface KnowledgeBase {
  id: string;
  name: string;
  description?: string;
  document_count: number;
  created_at: string;
}

export interface UploadItem {
  file: File;
  kb_id: string;
  progress: number;
  status: 'pending' | 'uploading' | 'done' | 'error';
}

// Eval types
export interface EvalResult {
  id: string;
  message_id: string;
  document_id: string;
  faithfulness_score: number;
  faithfulness_reason: string;
  answer_relevancy_score: number;
  contextual_precision_score: number;
  contextual_recall_score: number;
  hallucination_score: number;
  overall_pass: boolean;
  eval_model: string;
  triggered_by: string;
  evaluated_at: string;
}

export interface EvalConfig {
  id?: string;
  workspace_id?: string;
  faithfulness_threshold: number;
  answer_relevancy_threshold: number;
  contextual_precision_threshold: number;
  contextual_recall_threshold: number;
  hallucination_threshold: number;
  multi_turn_enabled: boolean;
}
