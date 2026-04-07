import { BookOpen, Brain, Database, Edit2, Plus, Search, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { DocumentCard } from '../components/upload/DocumentCard';
import { DropZone } from '../components/upload/DropZone';
import { ProgressTracker } from '../components/upload/ProgressTracker';
import { useDocuments } from '../hooks/useDocuments';
import type { KBSettings, KnowledgeBase } from '../types';
import { apiClient } from '../api/client';

// ── RAG Mode Badge ─────────────────────────────────────────────────────────────

function RagModeBadge({ ragMode }: { ragMode?: string }) {
  const mode = ragMode || 'pageindex';
  if (mode === 'vector') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 border border-emerald-200 px-2 py-0.5 text-xs font-medium text-emerald-700">
        <Database className="h-3 w-3" />
        Vector RAG
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 border border-blue-200 px-2 py-0.5 text-xs font-medium text-blue-700">
      <Brain className="h-3 w-3" />
      PageIndex
    </span>
  );
}

// ── KB Creation Wizard ─────────────────────────────────────────────────────────

const TOTAL_STEPS_PAGEINDEX = 3; // Basic, RAG Mode, Review
const TOTAL_STEPS_VECTOR = 6;    // Basic, RAG Mode, Index Method, Chunk Settings, Retrieval, Review

interface WizardProps {
  onClose: () => void;
  onCreated: () => void;
  createKb: (name: string, description?: string, settings?: KBSettings) => Promise<void>;
}

function KbCreationWizard({ onClose, onCreated, createKb }: WizardProps) {
  const [step, setStep] = useState(1);
  const [creating, setCreating] = useState(false);

  // Step 1: Basic Info
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');

  // Step 2: RAG Mode
  const [ragMode, setRagMode] = useState<'pageindex' | 'vector'>('pageindex');

  // Step 3 (Vector only): Index Method
  const [indexMethod, setIndexMethod] = useState<'high_quality' | 'economical' | 'hybrid'>('high_quality');
  const [embeddingProvider, setEmbeddingProvider] = useState<'bedrock' | 'openai'>('bedrock');
  const [embeddingModel, setEmbeddingModel] = useState('amazon.titan-embed-text-v2:0');

  // Step 4 (Vector only): Chunk Settings
  const [chunkStrategy, setChunkStrategy] = useState<'recursive' | 'parent_child'>('recursive');
  const [chunkSize, setChunkSize] = useState(1000);
  const [chunkOverlap, setChunkOverlap] = useState(200);

  // Step 5 (Vector only): Retrieval Settings
  const [retrievalMode, setRetrievalMode] = useState<'vector' | 'fulltext' | 'hybrid'>('vector');
  const [topK, setTopK] = useState(5);
  const [scoreThresholdEnabled, setScoreThresholdEnabled] = useState(false);
  const [scoreThreshold, setScoreThreshold] = useState(0.5);
  const [semanticWeight, setSemanticWeight] = useState(0.7);

  const isVector = ragMode === 'vector';
  const totalSteps = isVector ? TOTAL_STEPS_VECTOR : TOTAL_STEPS_PAGEINDEX;

  // When embedding provider changes, update model
  const handleProviderChange = (provider: 'bedrock' | 'openai') => {
    setEmbeddingProvider(provider);
    setEmbeddingModel(
      provider === 'bedrock' ? 'amazon.titan-embed-text-v2:0' : 'text-embedding-3-small'
    );
  };

  // Step labels for vector mode
  const stepLabels = isVector
    ? ['Basic Info', 'RAG Mode', 'Index Method', 'Chunking', 'Retrieval', 'Review']
    : ['Basic Info', 'RAG Mode', 'Review'];

  const handleCreate = async () => {
    setCreating(true);
    try {
      const settings: KBSettings = ragMode === 'vector'
        ? {
            rag_mode: 'vector',
            index_method: indexMethod,
            chunk_strategy: chunkStrategy,
            chunk_size: chunkSize,
            chunk_overlap: chunkOverlap,
            retrieval_mode: indexMethod === 'economical' ? 'fulltext' : retrievalMode,
            top_k: topK,
            score_threshold: scoreThresholdEnabled ? scoreThreshold : null,
            rerank_enabled: false,
            hybrid_semantic_weight: semanticWeight,
            embedding_provider: embeddingProvider,
            embedding_model: embeddingModel,
          }
        : { rag_mode: 'pageindex' };

      await createKb(name.trim(), description.trim() || undefined, settings);
      onCreated();
    } finally {
      setCreating(false);
    }
  };

  // Determine actual step number in vector flow (to map step 1-6 to content)
  // Steps: 1=Basic, 2=RAGMode, 3=IndexMethod(v), 4=Chunk(v), 5=Retrieval(v), 6=Review
  // For pageindex: 1=Basic, 2=RAGMode, 3=Review
  const lastStep = totalSteps;

  const canGoNext = () => {
    if (step === 1) return name.trim().length > 0;
    return true;
  };

  // Render step content
  const renderStep = () => {
    // Map step number to content
    if (step === 1) return renderBasicInfo();
    if (step === 2) return renderRagModeSelection();
    if (!isVector) {
      // PageIndex: step 3 = Review
      if (step === 3) return renderReview();
    } else {
      // Vector: step 3=IndexMethod, 4=Chunk, 5=Retrieval, 6=Review
      if (step === 3) return renderIndexMethod();
      if (step === 4) return renderChunkSettings();
      if (step === 5) return renderRetrievalSettings();
      if (step === 6) return renderReview();
    }
    return null;
  };

  const renderBasicInfo = () => (
    <div className="flex flex-col gap-4">
      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1.5">Name <span className="text-red-500">*</span></label>
        <input
          autoFocus
          required
          placeholder="e.g. Product Documentation"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-[var(--dm-primary)] focus:ring-2 focus:ring-blue-100 transition-all"
        />
      </div>
      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1.5">Description <span className="text-slate-400">(optional)</span></label>
        <textarea
          placeholder="Describe what documents this KB will contain..."
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={3}
          className="w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-[var(--dm-primary)] focus:ring-2 focus:ring-blue-100 transition-all resize-none"
        />
      </div>
    </div>
  );

  const renderRagModeSelection = () => (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-slate-600">Choose the retrieval method. This cannot be changed after creation.</p>
      <div className="grid grid-cols-2 gap-4">
        {/* PageIndex Card */}
        <button
          type="button"
          onClick={() => setRagMode('pageindex')}
          className={`relative flex flex-col gap-3 rounded-xl border-2 p-4 text-left transition-all ${
            ragMode === 'pageindex'
              ? 'border-[var(--dm-primary)] bg-blue-50 shadow-md'
              : 'border-slate-200 bg-white hover:border-slate-300'
          }`}
        >
          {ragMode === 'pageindex' && (
            <div className="absolute top-3 right-3 flex h-5 w-5 items-center justify-center rounded-full bg-[var(--dm-primary)]">
              <svg className="h-3 w-3 text-white" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
              </svg>
            </div>
          )}
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-100">
            <Brain className="h-5 w-5 text-blue-600" />
          </div>
          <div>
            <p className="text-sm font-semibold text-slate-900">PageIndex</p>
            <p className="text-xs text-slate-500 mt-0.5">Reasoning Mode</p>
          </div>
          <p className="text-xs text-slate-600 leading-relaxed">
            LLM builds a hierarchical tree from your document. Best for structured docs like reports and contracts.
          </p>
          <span className="inline-flex items-center rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700">
            No API cost
          </span>
        </button>

        {/* Vector RAG Card */}
        <button
          type="button"
          onClick={() => setRagMode('vector')}
          className={`relative flex flex-col gap-3 rounded-xl border-2 p-4 text-left transition-all ${
            ragMode === 'vector'
              ? 'border-emerald-500 bg-emerald-50 shadow-md'
              : 'border-slate-200 bg-white hover:border-slate-300'
          }`}
        >
          {ragMode === 'vector' && (
            <div className="absolute top-3 right-3 flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500">
              <svg className="h-3 w-3 text-white" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
              </svg>
            </div>
          )}
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-100">
            <Database className="h-5 w-5 text-emerald-600" />
          </div>
          <div>
            <p className="text-sm font-semibold text-slate-900">Vector RAG</p>
            <p className="text-xs text-slate-500 mt-0.5">Semantic Mode</p>
          </div>
          <p className="text-xs text-slate-600 leading-relaxed">
            Documents split into chunks and embedded. Best for large collections and concept search across many files.
          </p>
          <span className="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">
            Embedding required
          </span>
        </button>
      </div>
    </div>
  );

  const renderIndexMethod = () => (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-slate-600">How should documents be indexed?</p>
      <div className="flex flex-col gap-3">
        {[
          { value: 'high_quality', label: 'High Quality', desc: 'Semantic vector search using embedding model. Best accuracy.' },
          { value: 'economical', label: 'Economical', desc: 'Full-text keyword search only. No embedding cost.' },
          { value: 'hybrid', label: 'Hybrid', desc: 'Combines vector + keyword search with RRF merge. Best of both.' },
        ].map(({ value, label, desc }) => (
          <label
            key={value}
            className={`flex items-start gap-3 rounded-xl border-2 p-4 cursor-pointer transition-all ${
              indexMethod === value ? 'border-[var(--dm-primary)] bg-blue-50' : 'border-slate-200 bg-white hover:border-slate-300'
            }`}
          >
            <input
              type="radio"
              name="indexMethod"
              value={value}
              checked={indexMethod === value}
              onChange={() => setIndexMethod(value as typeof indexMethod)}
              className="mt-0.5 accent-[var(--dm-primary)]"
            />
            <div>
              <p className="text-sm font-medium text-slate-900">{label}</p>
              <p className="text-xs text-slate-500 mt-0.5">{desc}</p>
            </div>
          </label>
        ))}
      </div>

      {indexMethod !== 'economical' && (
        <div className="flex flex-col gap-3 mt-2 rounded-xl border border-slate-200 bg-slate-50 p-4">
          <p className="text-xs font-semibold text-slate-700 uppercase tracking-wide">Embedding Configuration</p>
          <div className="flex flex-col gap-2">
            <label className="text-sm font-medium text-slate-700">Embedding Provider</label>
            <select
              value={embeddingProvider}
              onChange={(e) => handleProviderChange(e.target.value as 'bedrock' | 'openai')}
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-[var(--dm-primary)] focus:ring-2 focus:ring-blue-100"
            >
              <option value="bedrock">Amazon Bedrock (Titan Embed v2)</option>
              <option value="openai">OpenAI (text-embedding-3-small)</option>
            </select>
          </div>
          <div className="flex flex-col gap-2">
            <label className="text-sm font-medium text-slate-700">Model</label>
            <input
              value={embeddingModel}
              readOnly
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-500 outline-none"
            />
          </div>
        </div>
      )}
    </div>
  );

  const renderChunkSettings = () => (
    <div className="flex flex-col gap-5">
      <div>
        <label className="block text-sm font-medium text-slate-700 mb-2">Chunk Strategy</label>
        <div className="flex flex-col gap-2">
          {[
            { value: 'recursive', label: 'Recursive (recommended)', desc: 'Splits text hierarchically on paragraph, line, sentence boundaries.' },
            { value: 'parent_child', label: 'Parent-Child (hierarchical)', desc: 'Creates large parent chunks with smaller child chunks for better context.' },
          ].map(({ value, label, desc }) => (
            <label
              key={value}
              className={`flex items-start gap-3 rounded-xl border-2 p-3 cursor-pointer transition-all ${
                chunkStrategy === value ? 'border-[var(--dm-primary)] bg-blue-50' : 'border-slate-200 bg-white hover:border-slate-300'
              }`}
            >
              <input
                type="radio"
                name="chunkStrategy"
                value={value}
                checked={chunkStrategy === value}
                onChange={() => setChunkStrategy(value as typeof chunkStrategy)}
                className="mt-0.5 accent-[var(--dm-primary)]"
              />
              <div>
                <p className="text-sm font-medium text-slate-900">{label}</p>
                <p className="text-xs text-slate-500">{desc}</p>
              </div>
            </label>
          ))}
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between mb-2">
          <label className="text-sm font-medium text-slate-700">Chunk Size</label>
          <span className="text-sm font-mono text-slate-600 bg-slate-100 px-2 py-0.5 rounded">{chunkSize}</span>
        </div>
        <input
          type="range"
          min={200}
          max={4000}
          step={100}
          value={chunkSize}
          onChange={(e) => setChunkSize(Number(e.target.value))}
          className="w-full accent-[var(--dm-primary)]"
        />
        <div className="flex justify-between text-xs text-slate-400 mt-1">
          <span>200</span><span>4000</span>
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between mb-2">
          <label className="text-sm font-medium text-slate-700">Chunk Overlap</label>
          <span className="text-sm font-mono text-slate-600 bg-slate-100 px-2 py-0.5 rounded">{chunkOverlap}</span>
        </div>
        <input
          type="range"
          min={0}
          max={500}
          step={25}
          value={chunkOverlap}
          onChange={(e) => setChunkOverlap(Number(e.target.value))}
          className="w-full accent-[var(--dm-primary)]"
        />
        <div className="flex justify-between text-xs text-slate-400 mt-1">
          <span>0</span><span>500</span>
        </div>
      </div>
    </div>
  );

  const renderRetrievalSettings = () => (
    <div className="flex flex-col gap-5">
      {indexMethod !== 'economical' && (
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-2">Retrieval Mode</label>
          <div className="flex flex-col gap-2">
            {[
              { value: 'vector', label: 'Vector', desc: 'Pure semantic similarity search.' },
              { value: 'fulltext', label: 'Full-text', desc: 'Keyword-based BM25-style search.' },
              { value: 'hybrid', label: 'Hybrid', desc: 'Combines vector + keyword with RRF.' },
            ].filter(({ value }) => {
              if (indexMethod === 'high_quality') return value !== 'fulltext';
              return true;
            }).map(({ value, label, desc }) => (
              <label
                key={value}
                className={`flex items-start gap-3 rounded-xl border-2 p-3 cursor-pointer transition-all ${
                  retrievalMode === value ? 'border-[var(--dm-primary)] bg-blue-50' : 'border-slate-200 bg-white hover:border-slate-300'
                }`}
              >
                <input
                  type="radio"
                  name="retrievalMode"
                  value={value}
                  checked={retrievalMode === value}
                  onChange={() => setRetrievalMode(value as typeof retrievalMode)}
                  className="mt-0.5 accent-[var(--dm-primary)]"
                />
                <div>
                  <p className="text-sm font-medium text-slate-900">{label}</p>
                  <p className="text-xs text-slate-500">{desc}</p>
                </div>
              </label>
            ))}
          </div>
        </div>
      )}

      <div className="flex items-center justify-between">
        <div>
          <label className="text-sm font-medium text-slate-700">Top-K Results</label>
          <p className="text-xs text-slate-500">Number of chunks to retrieve</p>
        </div>
        <input
          type="number"
          min={1}
          max={20}
          value={topK}
          onChange={(e) => setTopK(Math.max(1, Math.min(20, Number(e.target.value))))}
          className="w-20 rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-right outline-none focus:ring-2 focus:ring-[var(--dm-primary)]"
        />
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            id="scoreThresholdEnabled"
            checked={scoreThresholdEnabled}
            onChange={(e) => setScoreThresholdEnabled(e.target.checked)}
            className="rounded border-slate-300 accent-[var(--dm-primary)]"
          />
          <label htmlFor="scoreThresholdEnabled" className="text-sm font-medium text-slate-700 cursor-pointer">
            Enable Score Threshold
          </label>
        </div>
        {scoreThresholdEnabled && (
          <input
            type="number"
            min={0}
            max={1}
            step={0.05}
            value={scoreThreshold}
            onChange={(e) => setScoreThreshold(parseFloat(e.target.value))}
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[var(--dm-primary)]"
            placeholder="0.0 – 1.0"
          />
        )}
      </div>

      {retrievalMode === 'hybrid' && (
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="text-sm font-medium text-slate-700">Semantic Weight</label>
            <span className="text-sm font-mono text-slate-600 bg-slate-100 px-2 py-0.5 rounded">{semanticWeight.toFixed(2)}</span>
          </div>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={semanticWeight}
            onChange={(e) => setSemanticWeight(parseFloat(e.target.value))}
            className="w-full accent-[var(--dm-primary)]"
          />
          <div className="flex justify-between text-xs text-slate-400 mt-1">
            <span>← Keyword</span>
            <span>Semantic →</span>
          </div>
        </div>
      )}
    </div>
  );

  const renderReview = () => (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-slate-600">Review your configuration before creating.</p>
      <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 flex flex-col gap-3">
        <div className="flex justify-between items-center">
          <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Name</span>
          <span className="text-sm font-medium text-slate-900">{name}</span>
        </div>
        {description && (
          <div className="flex justify-between items-start gap-4">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide shrink-0">Description</span>
            <span className="text-sm text-slate-600 text-right">{description}</span>
          </div>
        )}
        <div className="flex justify-between items-center">
          <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">RAG Mode</span>
          <RagModeBadge ragMode={ragMode} />
        </div>
        {isVector && (
          <>
            <div className="flex justify-between items-center">
              <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Index Method</span>
              <span className="text-sm text-slate-700 capitalize">{indexMethod.replace('_', ' ')}</span>
            </div>
            {indexMethod !== 'economical' && (
              <div className="flex justify-between items-center">
                <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Embedding</span>
                <span className="text-sm text-slate-700">{embeddingModel}</span>
              </div>
            )}
            <div className="flex justify-between items-center">
              <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Chunk Strategy</span>
              <span className="text-sm text-slate-700 capitalize">{chunkStrategy.replace('_', '-')}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Chunk Size / Overlap</span>
              <span className="text-sm text-slate-700">{chunkSize} / {chunkOverlap}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Retrieval Mode</span>
              <span className="text-sm text-slate-700 capitalize">{indexMethod === 'economical' ? 'fulltext' : retrievalMode}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Top-K</span>
              <span className="text-sm text-slate-700">{topK}</span>
            </div>
          </>
        )}
      </div>
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="relative w-full max-w-lg rounded-2xl bg-white shadow-2xl flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-6 pb-4 border-b border-slate-100">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Create Knowledge Base</h2>
            <p className="text-xs text-slate-500 mt-0.5">{stepLabels[step - 1]}</p>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors"
          >
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Step indicators */}
        <div className="flex items-center gap-1.5 px-6 py-3">
          {stepLabels.map((label, idx) => (
            <div
              key={idx}
              className={`flex-1 h-1.5 rounded-full transition-colors ${
                idx + 1 < step ? 'bg-[var(--dm-primary)]' :
                idx + 1 === step ? 'bg-[var(--dm-primary)] opacity-70' :
                'bg-slate-200'
              }`}
            />
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {renderStep()}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-slate-100 bg-slate-50 rounded-b-2xl">
          <button
            type="button"
            onClick={() => step > 1 ? setStep(s => s - 1) : onClose()}
            className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-white transition-colors"
          >
            {step > 1 ? 'Back' : 'Cancel'}
          </button>

          {step < totalSteps ? (
            <button
              type="button"
              disabled={!canGoNext()}
              onClick={() => setStep(s => s + 1)}
              className="rounded-lg bg-[var(--dm-primary)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--dm-primary-dark)] disabled:opacity-50 transition-colors shadow-sm"
            >
              Next
            </button>
          ) : (
            <button
              type="button"
              disabled={creating}
              onClick={handleCreate}
              className="rounded-lg bg-[var(--dm-primary)] px-5 py-2 text-sm font-medium text-white hover:bg-[var(--dm-primary-dark)] disabled:opacity-50 transition-colors shadow-sm"
            >
              {creating ? 'Creating…' : 'Create'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Retrieval Hit Testing Panel ────────────────────────────────────────────────

interface RetrievalChunk {
  chunk_id: string;
  document_id: string;
  doc_filename: string;
  text: string;
  score: number;
  page_number: number;
  chunk_index: number;
}

function HitTestingPanel({ kb }: { kb: KnowledgeBase }) {
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<RetrievalChunk[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  const handleSearch = async () => {
    if (!query.trim()) return;
    setSearching(true);
    setError(null);
    try {
      const { data } = await apiClient.post<{ chunks: RetrievalChunk[]; retrieval_mode: string }>('/retrieval/test', {
        kb_id: kb.id,
        query: query.trim(),
      });
      setResults(data.chunks);
    } catch (err: unknown) {
      const e = err as { response?: { data?: { detail?: string } } };
      setError(e?.response?.data?.detail || 'Retrieval test failed');
    } finally {
      setSearching(false);
    }
  };

  return (
    <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
      <button
        type="button"
        onClick={() => setExpanded(v => !v)}
        className="flex w-full items-center justify-between px-4 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 rounded-xl transition-colors"
      >
        <div className="flex items-center gap-2">
          <Search className="h-4 w-4 text-emerald-600" />
          Test Retrieval
        </div>
        <svg
          className={`h-4 w-4 text-slate-400 transition-transform ${expanded ? 'rotate-180' : ''}`}
          fill="none" stroke="currentColor" viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {expanded && (
        <div className="px-4 pb-4 flex flex-col gap-4">
          <div className="flex gap-2">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
              placeholder="Enter a test query..."
              className="flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100 transition-all"
            />
            <button
              onClick={handleSearch}
              disabled={searching || !query.trim()}
              className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50 transition-colors"
            >
              {searching ? '…' : 'Search'}
            </button>
          </div>

          {error && (
            <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>
          )}

          {results && results.length === 0 && (
            <p className="text-sm text-slate-500 text-center py-4">No matching chunks found.</p>
          )}

          {results && results.length > 0 && (
            <div className="flex flex-col gap-3">
              {results.map((chunk) => (
                <div key={chunk.chunk_id} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div className="flex items-center gap-2 flex-1 min-w-0">
                      <span className="text-xs font-medium text-slate-700 truncate">{chunk.doc_filename}</span>
                      <span className="text-xs text-slate-400 shrink-0">p.{chunk.page_number} · chunk {chunk.chunk_index + 1}</span>
                    </div>
                    <span className={`shrink-0 text-xs font-bold px-2 py-0.5 rounded-full ${
                      chunk.score > 0.7 ? 'bg-emerald-100 text-emerald-700' :
                      chunk.score > 0.4 ? 'bg-amber-100 text-amber-700' :
                      'bg-slate-100 text-slate-600'
                    }`}>
                      {(chunk.score * 100).toFixed(0)}%
                    </span>
                  </div>
                  <p className="text-xs text-slate-600 leading-relaxed line-clamp-3">{chunk.text}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────────────

export function KnowledgeBases() {
  const { knowledgeBases, documents, loadKnowledgeBases, loadDocuments, createKb, updateKb, deleteKb } = useDocuments();
  const [selectedKb, setSelectedKb] = useState<KnowledgeBase | null>(null);
  const [showWizard, setShowWizard] = useState(false);
  const [editingKb, setEditingKb] = useState<KnowledgeBase | null>(null);
  const [newKbName, setNewKbName] = useState('');
  const [newKbDesc, setNewKbDesc] = useState('');
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

  const completedDocuments = kbDocuments.filter(
    (d) => d.status !== 'processing' && d.status !== 'uploading'
  );

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
      await deleteKb(kb.id);
      if (selectedKb?.id === kb.id) setSelectedKb(null);
    } catch (error) {
      alert(`Failed to delete knowledge base: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setDeleting(null);
    }
  };

  const isVectorKb = selectedKb && (selectedKb.settings?.rag_mode === 'vector' || selectedKb.rag_mode === 'vector');
  const hasReadyDocs = completedDocuments.some(d => d.status === 'ready');

  return (
    <>
      {showWizard && (
        <KbCreationWizard
          onClose={() => setShowWizard(false)}
          onCreated={() => {
            setShowWizard(false);
            loadKnowledgeBases();
          }}
          createKb={createKb}
        />
      )}

      <div className="flex min-h-full gap-6 p-6">
        {/* KB list */}
        <aside className="w-72 shrink-0 flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-slate-900">Knowledge Bases</h2>
            <button
              onClick={() => setShowWizard(true)}
              className="flex items-center gap-1.5 rounded-lg bg-[var(--dm-primary)] px-3 py-2 text-sm font-medium text-white hover:bg-[var(--dm-primary-dark)] transition-colors shadow-sm"
              aria-label="Create knowledge base"
            >
              <Plus className="h-4 w-4" />
              New KB
            </button>
          </div>

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
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="truncate text-sm font-semibold text-slate-900">{kb.name}</p>
                        <RagModeBadge ragMode={kb.settings?.rag_mode || kb.rag_mode} />
                      </div>
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
                <div className="flex items-center gap-3">
                  <h3 className="text-xl font-semibold text-slate-900">{selectedKb.name}</h3>
                  <RagModeBadge ragMode={selectedKb.settings?.rag_mode || selectedKb.rag_mode} />
                </div>
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

              {/* Hit Testing Panel — only for Vector RAG KBs with ready docs */}
              {isVectorKb && hasReadyDocs && (
                <HitTestingPanel kb={selectedKb} />
              )}
            </>
          )}
        </main>
      </div>
    </>
  );
}
