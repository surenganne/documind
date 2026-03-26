# DocuMind — AI Document Intelligence Platform
## Development Plan

> **Brand:** DocuMind | **Primary Color:** #1C55BB | **Stack:** FastAPI · React/TypeScript · Shadcn/UI · Tailwind · PostgreSQL · Docker  
> **Core Engine:** PageIndex (Vectorless, Reasoning-based RAG) | **LLM:** AWS Bedrock Claude Sonnet 4.5 | **Evaluation:** DeepEval

---

## Table of Contents

1. [Application Overview](#1-application-overview)
2. [Architecture Summary](#2-architecture-summary)
3. [AWS Bedrock Model Registry](#3-aws-bedrock-model-registry)
4. [Phase 1 — Foundation & Core Infrastructure](#phase-1--foundation--core-infrastructure)
5. [Phase 2 — Document Ingestion Pipeline](#phase-2--document-ingestion-pipeline)
6. [Phase 3 — PageIndex Chat Engine](#phase-3--pageindex-chat-engine)
7. [Phase 4 — Frontend Application](#phase-4--frontend-application)
8. [Phase 5 — Insights & Analytics Layer](#phase-5--insights--analytics-layer)
9. [Phase 6 — Docker & Deployment](#phase-6--docker--deployment)
10. [Phase 7 — Security & Enterprise Hardening](#phase-7--security--enterprise-hardening)
11. [Phase 8 — DeepEval + AWS Bedrock Evaluation Layer](#phase-8--deepeval--aws-bedrock-evaluation-layer)
12. [Folder Structure](#folder-structure)
13. [Phase Summary Table](#phase-summary-table)

---

## 1. Application Overview

**DocuMind** is an enterprise-grade AI document intelligence platform powered by PageIndex — a vectorless, reasoning-based RAG engine. Unlike traditional RAG systems that rely on semantic similarity search, PageIndex builds a hierarchical tree index from documents and uses LLM reasoning to navigate to the most relevant sections — the way a human expert would.

### Key Differentiators

- **No vector DB required** — reasoning over document structure, not embedding similarity
- **Citations with page references** — every answer linked to exact section, page, and node
- **Reasoning trace** — full audit trail of which sections were visited and why
- **Empathetic responses** — low-confidence answers flagged with user-friendly disclaimers
- **DeepEval scoring** — faithfulness, hallucination, and relevancy scored on every response via AWS Bedrock

### Target Document Types (v1)

PDF, DOCX, TXT, Markdown  
*(Phase 2 extension: PPTX, XLSX, HTML)*

### Branding

| Token | Value |
|---|---|
| Primary | `#1C55BB` |
| Primary Light | `#E8F0FC` |
| Primary Dark | `#143D88` |
| Accent | `#F4A027` |
| Surface | `#F8FAFF` |
| Typography | Playfair Display (headings) + DM Sans (body) |

---

## 2. Architecture Summary

```
┌─────────────────────────────────────────────────────────────┐
│  FRONTEND (React + TypeScript + Shadcn/UI + Tailwind)        │
│  Upload UI │ Chat Interface │ Doc Viewer │ Insights Panel    │
└──────────────────────┬──────────────────────────────────────┘
                       │ REST + WebSocket (SSE)
┌──────────────────────▼──────────────────────────────────────┐
│  BACKEND (FastAPI + Python 3.11)                             │
│  Auth Service │ Doc Processor │ Chat Engine │ Analytics API  │
│  Celery Async │ WebSocket SSE │ Pydantic v2                  │
└──────────────────────┬──────────────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────────────┐
│  PAGEINDEX ENGINE                                            │
│  Tree Builder → Tree Navigator → Answer Generator           │
│  Trace Logger                                                │
│  ↕ AWS Bedrock (Claude Sonnet 4.5)                          │
└──────────────────────┬──────────────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────────────┐
│  DEEPEVAL EVALUATION LAYER                                   │
│  Faithfulness │ Answer Relevancy │ Contextual Precision      │
│  Contextual Recall │ Hallucination                           │
│  ↕ AmazonBedrockModel (Claude Sonnet 4.5, temp=0)           │
└──────────────────────┬──────────────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────────────┐
│  STORAGE                                                     │
│  PostgreSQL │ File Storage (S3/local) │ Redis │ Celery Queue │
└─────────────────────────────────────────────────────────────┘

Docker Compose: nginx · backend · celery_worker · eval_worker · postgres · redis · frontend
```

---

## 3. AWS Bedrock Model Registry

All LLM calls route through AWS Bedrock. Single IAM role with `bedrock:InvokeModel` scoped to these model ARNs.

| Service Layer | Model Name | Bedrock Model ID |
|---|---|---|
| PageIndex — Tree Builder | Claude Sonnet 4.5 | `anthropic.claude-sonnet-4-5-20251001` |
| PageIndex — Tree Navigator | Claude Sonnet 4.5 | `anthropic.claude-sonnet-4-5-20251001` |
| PageIndex — Answer Generator | Claude Sonnet 4.5 | `anthropic.claude-sonnet-4-5-20251001` |
| DeepEval Judge (all metrics) | Claude Sonnet 4.5 | `anthropic.claude-sonnet-4-5-20251001` |
| Document Summaries / Tags | Titan Text Express | `amazon.titan-text-express-v1` |
| Embeddings (optional/hybrid) | Titan Embed v2 | `amazon.titan-embed-text-v2:0` |

**Region:** `us-east-1` (model availability) or `ap-south-1` (India latency)  
**Auth:** `AWS_ACCESS_KEY_ID` + `AWS_SECRET_ACCESS_KEY` via Docker environment variables

---

## Phase 1 — Foundation & Core Infrastructure

### 1.1 Project Scaffold

- Monorepo: `/backend`, `/frontend`, `/docker`, `/infra`
- Docker Compose with 7 services: `nginx`, `backend`, `celery_worker`, `eval_worker`, `postgres`, `redis`, `frontend`
- Backend: FastAPI + Python 3.11, Pydantic v2, SQLAlchemy 2.0 async
- Frontend: React 18 + TypeScript + Vite + Shadcn/UI + Tailwind CSS
- Environment config: `.env.local`, `.env.docker`, `.env.prod`

### 1.2 Database Schema (PostgreSQL)

**`users`**
```sql
id UUID PK, name VARCHAR, email VARCHAR UNIQUE, role VARCHAR,
workspace_id UUID FK, created_at TIMESTAMP
```

**`workspaces`**
```sql
id UUID PK, name VARCHAR, owner_id UUID FK, settings JSONB
```

**`documents`**
```sql
id UUID PK, workspace_id UUID FK, filename VARCHAR, file_path VARCHAR,
file_type VARCHAR, size_bytes INT,
status VARCHAR -- ENUM: uploading | processing | ready | failed
uploaded_by UUID FK, created_at TIMESTAMP
```

**`document_trees`**
```sql
id UUID PK, document_id UUID FK, tree_json JSONB,
built_at TIMESTAMP, llm_model_used VARCHAR, token_count INT
```

**`chat_sessions`**
```sql
id UUID PK, workspace_id UUID FK, user_id UUID FK,
title VARCHAR, created_at TIMESTAMP
```

**`chat_messages`**
```sql
id UUID PK, session_id UUID FK, role VARCHAR, -- user | assistant
content TEXT, citations JSONB, reasoning_trace JSONB,
node_ids_visited TEXT[], created_at TIMESTAMP
```

**`document_session_links`** *(M:M)*
```sql
session_id UUID FK, document_id UUID FK
```

**`eval_results`**
```sql
id UUID PK, message_id UUID FK, document_id UUID FK,
faithfulness_score FLOAT, faithfulness_reason TEXT,
answer_relevancy_score FLOAT, contextual_precision_score FLOAT,
contextual_recall_score FLOAT, hallucination_score FLOAT,
overall_pass BOOLEAN, eval_model VARCHAR,
triggered_by VARCHAR, -- online | ci | nightly
evaluated_at TIMESTAMP
```

**`eval_config`**
```sql
id UUID PK, workspace_id UUID FK,
faithfulness_threshold FLOAT DEFAULT 0.85,
answer_relevancy_threshold FLOAT DEFAULT 0.80,
contextual_precision_threshold FLOAT DEFAULT 0.75,
contextual_recall_threshold FLOAT DEFAULT 0.75,
hallucination_threshold FLOAT DEFAULT 0.15
```

**`audit_logs`**
```sql
id UUID PK, user_id UUID FK, action VARCHAR,
resource_type VARCHAR, resource_id UUID,
metadata JSONB, timestamp TIMESTAMP
```

### 1.3 Auth Layer

- JWT-based auth with refresh tokens
- Workspace isolation — all queries scoped to `workspace_id`
- Role-based access: Admin, Editor, Viewer
- Optional: SSO via OAuth2 (Google/Microsoft) for enterprise deployment

---

## Phase 2 — Document Ingestion Pipeline

### 2.1 Upload API

- `POST /api/v1/documents/upload` — multipart form, accepts PDF, DOCX, TXT, MD
- File validation: size limit (configurable, default 50MB), MIME type whitelist, magic bytes check
- Store original file → S3 bucket or local `/data/uploads/`
- Create `documents` record with `status = processing`
- Trigger Celery async task: `build_document_tree.delay(document_id)`

### 2.2 PageIndex Tree Builder (Celery Worker)

**Task flow:**
```
Raw Document → Text Extraction → LLM ToC Generation → Tree JSON Storage → Status Update
```

**Text extraction:**
- `pdfplumber` for PDFs — preserves headers, tables, section breaks
- `python-docx` for DOCX — preserves heading hierarchy
- Plain text for TXT/MD

**LLM ToC generation:**
- Send full document (or chunked if >100K tokens) to Bedrock Claude Sonnet
- PageIndex prompt → returns hierarchical JSON tree
- Persist to `document_trees.tree_json` as JSONB

**Error handling:**
- Retry logic: 3 attempts with exponential backoff
- Dead letter queue for permanent failures
- Status = `failed` with error detail stored in document metadata
- WebSocket event pushed to frontend on completion

### 2.3 Supported Document Types

| Version | Types |
|---|---|
| v1 | PDF, DOCX, TXT, Markdown |
| v2 (extension) | PPTX, XLSX, HTML |

---

## Phase 3 — PageIndex Chat Engine

### 3.1 Chat API Endpoints

```
POST   /api/v1/chat/sessions              — Create session, link documents
POST   /api/v1/chat/sessions/{id}/messages — Send message, stream response (SSE)
GET    /api/v1/chat/sessions/{id}/messages — Fetch history
WS     /ws/chat/{session_id}              — Streaming tokens + reasoning events
```

### 3.2 PageIndex Retrieval Flow

```
User Query
  → Load tree(s) from DB (one or multiple docs)
  → LLM: "Given this ToC tree and query, navigate to relevant nodes"
  → Fetch raw section text for selected node IDs
  → LLM: "Answer query using sections. Cite exact node + page."
  → Stream answer + citations back to client
```

**Key design decisions:**

- **Multi-doc support** — merge trees from all session-linked documents; prefix node IDs with `doc_id`
- **Context-aware** — pass last 5 message turns for multi-turn reasoning
- **Citation format** — `{ doc_name, section_title, page_number, node_id, verbatim_excerpt }`
- **Reasoning trace** — store full node traversal path: nodes visited, why selected, confidence signal
- **Empathetic tone** — system prompt layer: responses acknowledge complexity, avoid clinical coldness

### 3.3 LLM Provider Abstraction

```python
class LLMProvider(Protocol):
    async def complete(self, messages, system_prompt) -> LLMResponse
    async def stream(self, messages, system_prompt) -> AsyncIterator[str]
```

Implementations: `BedrockProvider` (default), `OpenAIProvider`, `AnthropicDirectProvider`  
Config-switchable per workspace via `workspaces.settings` JSONB.

---

## Phase 4 — Frontend Application

### 4.1 Application Structure

```
/src
  /pages
    Upload.tsx          — Document library + drag-drop upload
    Chat.tsx            — 3-panel chat interface
    Library.tsx         — All documents across workspace
    Settings.tsx        — Workspace config, eval thresholds
  /components
    /upload
      DropZone.tsx
      ProgressTracker.tsx
      DocumentCard.tsx
    /chat
      MessageBubble.tsx
      CitationCard.tsx
      ReasoningTrace.tsx
      StreamingIndicator.tsx
    /viewer
      PDFViewer.tsx
      PageHighlight.tsx
      SectionJumper.tsx
    /insights
      TreeExplorer.tsx
      DocumentSummary.tsx
      QualityMonitor.tsx
  /hooks
    useChat.ts
    useDocuments.ts
    useStream.ts
    useEvalResults.ts
  /stores
    chatStore.ts        — Zustand
    documentStore.ts    — Zustand
    uiStore.ts          — Zustand
  /api
    client.ts           — Axios typed client
    chat.ts
    documents.ts
    eval.ts
```

### 4.2 Brand Tokens (Tailwind + CSS Variables)

```css
:root {
  --dm-primary:       #1C55BB;
  --dm-primary-light: #E8F0FC;
  --dm-primary-dark:  #143D88;
  --dm-accent:        #F4A027;
  --dm-surface:       #F8FAFF;
}
```

### 4.3 Key UI Screens

**Upload Page:**
- Drag-drop zone with animated border (Tailwind + Framer Motion)
- Document library grid with status badges: `Processing` | `Ready` | `Failed`
- Real-time progress via WebSocket

**Chat Interface (3-panel layout):**
- **Left panel** — Document library + session navigator
- **Center panel** — Chat thread with streaming, inline citation chips
- **Right panel** — PDF Viewer with highlighted sections + page navigation

**CitationCard Component:**
```tsx
<CitationCard
  docName="Contract_v3.pdf"
  section="Section 4.2 — Termination Clauses"
  page={12}
  excerpt="..."
  faithfulnessScore={0.92}
  onJumpToPage={() => viewer.goTo(12)}
/>
```

**ReasoningTrace Component (collapsible):**
- Shows: nodes visited → why selected → confidence signal
- Visible to all users; collapsed by default
- Admin view: includes DeepEval metric scores inline

### 4.4 Accessibility & UX

- Keyboard navigation throughout
- Loading skeletons during tree build (avg 15–45s depending on doc size)
- Empty states with actionable prompts
- Mobile-responsive (tablet minimum, 768px breakpoint)
- Empathy disclaimer banner on low-faithfulness responses

---

## Phase 5 — Insights & Analytics Layer

### 5.1 Document Insights (Auto-generated on Tree Build)

- **Executive Summary** — 5-bullet LLM summary stored in `document_trees`
- **Key Entities** — people, orgs, dates, amounts extracted (Titan Text Express)
- **Document Tags** — auto-categorized: Legal, Financial, Technical, HR, etc.
- **Complexity Score** — section depth, token count, cross-reference density

### 5.2 Tree Explorer UI

- Interactive tree visualization (React Flow or d3.js)
- Click node → preview section text in side panel
- Breadcrumb nav: `Root > Chapter 3 > Section 3.2 > Subsection 3.2.1`
- Search within tree structure

### 5.3 Chat Analytics (Admin)

- Queries per document (top 10)
- Most-accessed sections (heatmap overlaid on tree)
- Answer confidence distribution
- Unanswered / low-confidence queries flagged for review

### 5.4 Quality Monitor Tab *(feeds from Phase 8)*

- Faithfulness trend line (7-day rolling average)
- Per-document quality heatmap — which docs produce most hallucinations?
- Low-score message list — admin can review and promote to golden dataset
- Metric distribution histograms (all 5 DeepEval metrics)
- Alert banner: *"3 responses today fell below faithfulness threshold"*

---

## Phase 6 — Docker & Deployment

### 6.1 Docker Compose Services

```yaml
services:
  nginx:
    # Reverse proxy, SSL termination, serves React build
    ports: ["80:80", "443:443"]

  backend:
    # FastAPI (uvicorn, 4 workers)
    command: uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers 4

  celery_worker:
    # Tree build + chat async tasks (2 workers)
    command: celery -A app.workers worker -Q default --concurrency=2

  eval_worker:
    # DeepEval evaluation tasks — isolated queue
    command: celery -A app.workers worker -Q eval_queue --concurrency=2
    environment:
      - AWS_ACCESS_KEY_ID=${AWS_ACCESS_KEY_ID}
      - AWS_SECRET_ACCESS_KEY=${AWS_SECRET_ACCESS_KEY}
      - AWS_DEFAULT_REGION=us-east-1

  celery_beat:
    # Scheduled: nightly eval regression, file cleanup

  postgres:
    image: postgres:16
    # pgvector extension enabled (future-proofing)

  redis:
    # Cache + Celery broker + WebSocket session state

  frontend:
    # React build served via nginx
```

### 6.2 Compose Variants

| File | Purpose |
|---|---|
| `docker-compose.yml` | Base config |
| `docker-compose.dev.yml` | Hot reload, debug ports exposed |
| `docker-compose.prod.yml` | Volume mounts, resource limits, no exposed ports |

### 6.3 Production Readiness Checklist

- Health check endpoints: `GET /health`, `GET /health/db`, `GET /health/redis`
- Structured JSON logging with correlation IDs per request
- Rate limiting: per-user on chat API (prevent runaway Bedrock costs)
- File cleanup: Celery beat — purge orphaned files older than 30 days
- DB migrations: Alembic — version-controlled, CI-applied
- All secrets via `.env` — never baked into images

---

## Phase 7 — Security & Enterprise Hardening

- **Document-level ACL** — only workspace members can query documents
- **PII detection warning** on upload (optional flagging layer via Bedrock Guardrails)
- **Audit trail** — every query, citation, and answer logged to `audit_logs`
- **HTTPS enforced** at nginx layer (Let's Encrypt / ACM)
- **Content Security Policy** headers
- **Input sanitization** — magic bytes check on all uploads (not just extension)
- **IAM least-privilege** — `bedrock:InvokeModel` scoped to 3 model ARNs only
- **No secrets in images** — all sensitive config via Docker secrets / AWS SSM

---

## Phase 8 — DeepEval + AWS Bedrock Evaluation Layer

### 8.1 Overview

Every chat response in DocuMind is automatically evaluated post-generation using DeepEval with AWS Bedrock as the judge model. Evaluation runs asynchronously — it never blocks the user-facing response stream. Low-confidence answers trigger an empathy disclaimer visible to the user.

### 8.2 Installation

```bash
pip install deepeval aiobotocore botocore
```

### 8.3 Bedrock Judge Singleton

**`app/services/eval/bedrock_judge.py`**
```python
from deepeval.models import AmazonBedrockModel

bedrock_judge = AmazonBedrockModel(
    model="anthropic.claude-sonnet-4-5-20251001",
    region="us-east-1",
    generation_kwargs={
        "temperature": 0,      # Deterministic evaluation
        "max_tokens": 1000,
    }
)
```

### 8.4 DeepEval Metrics Suite

```python
from deepeval.metrics import (
    FaithfulnessMetric,         # Answer grounded in cited PageIndex nodes?
    AnswerRelevancyMetric,      # Answer relevant to user query?
    ContextualPrecisionMetric,  # Right nodes ranked highest?
    ContextualRecallMetric,     # Context covers expected answer?
    HallucinationMetric,        # Factual deviation from source document
)
```

### 8.5 Metric Thresholds & Actions

| Metric | Default Threshold | Action on Fail |
|---|---|---|
| Faithfulness | ≥ 0.85 | Warn user — empathy disclaimer appended |
| Answer Relevancy | ≥ 0.80 | Flag in Quality Monitor dashboard |
| Contextual Precision | ≥ 0.75 | Flag — review node ranking logic |
| Contextual Recall | ≥ 0.75 | Flag — missing context coverage |
| Hallucination | ≤ 0.15 | Hard block response + alert admin |

> Thresholds are configurable per workspace via `eval_config` table.

### 8.6 LLMTestCase Construction

```python
from deepeval.test_case import LLMTestCase

# Called after every assistant message
test_case = LLMTestCase(
    input=user_query,
    actual_output=llm_answer,
    retrieval_context=[node.text for node in visited_nodes],  # PageIndex nodes
    expected_output=None,  # None in online mode; populated in CI from golden set
)
```

**Mapping from PageIndex to DeepEval:**
- `retrieval_context` ← raw text of all tree nodes visited during reasoning
- `actual_output` ← final streamed answer text (stripped of markdown)
- Citations stored separately in `chat_messages.citations` JSONB

### 8.7 Three Evaluation Trigger Modes

#### Mode 1 — Online Async (production, post every response)

```python
# app/workers/eval_tasks.py
@celery.task(queue="eval_queue")
async def evaluate_response_async(message_id: str):
    msg = await db.get_message(message_id)
    test_case = build_test_case(msg)

    results = evaluate([test_case], metrics=[
        FaithfulnessMetric(model=bedrock_judge, threshold=0.85),
        AnswerRelevancyMetric(model=bedrock_judge, threshold=0.80),
        HallucinationMetric(model=bedrock_judge, threshold=0.15),
    ])

    await db.store_eval_results(message_id, results)

    # Trigger empathy disclaimer if faithfulness fails
    if results.faithfulness_score < 0.85:
        await db.append_disclaimer(message_id, EMPATHY_DISCLAIMER)
```

#### Mode 2 — CI/CD Regression (pytest, runs on every PR)

```python
# tests/eval/test_rag_quality.py
import pytest
from deepeval import assert_test
from deepeval.metrics import FaithfulnessMetric, AnswerRelevancyMetric

@pytest.mark.parametrize("case", load_golden_dataset())
def test_faithfulness(case):
    test_case = LLMTestCase(**case)
    assert_test(test_case, [
        FaithfulnessMetric(model=bedrock_judge, threshold=0.85),
        AnswerRelevancyMetric(model=bedrock_judge, threshold=0.80),
    ])
```

> Golden dataset: 50–100 curated Q&A pairs per document type (financial, legal, HR).  
> Stored in `tests/eval/golden/` as JSONL.

#### Mode 3 — Nightly Batch Regression (Celery Beat)

- Re-evaluate all production messages from past 24h
- Compare against rolling 7-day baseline
- Alert admin if any metric drops > 5% vs baseline
- Results stored in `eval_results` with `triggered_by = 'nightly'`

### 8.8 Empathy Disclaimer (Quality Gate)

```python
EMPATHY_DISCLAIMER = (
    "\n\n---\n"
    "**Transparency note:** Parts of this answer may not be fully grounded "
    "in the document. I recommend verifying the cited sections directly. "
    "If this doesn't look right, please rephrase your question or let me know."
)
```

Appended to assistant message in `chat_messages.content` when:
- `faithfulness_score < threshold`, or
- `hallucination_score > threshold`

### 8.9 Multi-Turn Evaluation (Phase 8 Extension)

```python
from deepeval.metrics import TurnFaithfulness, TurnRelevancy

# Wire in after baseline single-turn eval is stable
turn_faithfulness = TurnFaithfulness(model=bedrock_judge)
turn_relevancy = TurnRelevancy(model=bedrock_judge)
```

---

## Folder Structure

```
documind/
├── backend/
│   ├── app/
│   │   ├── api/
│   │   │   └── routes/
│   │   │       ├── auth.py
│   │   │       ├── documents.py
│   │   │       ├── chat.py
│   │   │       ├── insights.py
│   │   │       └── eval.py
│   │   ├── core/
│   │   │   ├── config.py
│   │   │   ├── security.py
│   │   │   └── database.py
│   │   ├── models/           # SQLAlchemy ORM
│   │   ├── schemas/          # Pydantic request/response
│   │   ├── services/
│   │   │   ├── pageindex/
│   │   │   │   ├── tree_builder.py
│   │   │   │   ├── tree_navigator.py
│   │   │   │   ├── answer_generator.py
│   │   │   │   └── trace_logger.py
│   │   │   ├── llm/
│   │   │   │   ├── provider.py       # Protocol abstraction
│   │   │   │   └── bedrock.py        # BedrockProvider impl
│   │   │   ├── document/
│   │   │   │   ├── extractor.py      # pdfplumber, python-docx
│   │   │   │   └── storage.py        # S3 / local
│   │   │   └── eval/
│   │   │       ├── bedrock_judge.py  # AmazonBedrockModel singleton
│   │   │       ├── metrics.py        # DeepEval metric definitions
│   │   │       ├── test_case.py      # LLMTestCase builder
│   │   │       └── quality_gate.py   # Disclaimer injection
│   │   └── workers/
│   │       ├── tree_tasks.py         # build_document_tree
│   │       ├── eval_tasks.py         # evaluate_response_async
│   │       └── maintenance_tasks.py  # file cleanup, nightly eval
│   ├── alembic/                      # DB migrations
│   ├── tests/
│   │   └── eval/
│   │       ├── golden/               # .jsonl golden datasets
│   │       └── test_rag_quality.py   # pytest deepeval CI tests
│   ├── requirements.txt
│   └── Dockerfile
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   ├── pages/
│   │   ├── hooks/
│   │   ├── stores/
│   │   └── api/
│   ├── tailwind.config.ts
│   ├── package.json
│   └── Dockerfile
├── docker/
│   ├── nginx.conf
│   ├── docker-compose.yml
│   ├── docker-compose.dev.yml
│   └── docker-compose.prod.yml
├── infra/                            # IaC (optional — Terraform/CDK)
├── .env.example
└── README.md
```

---

## Phase Summary Table

| Phase | Deliverable | Priority | Key Dependencies |
|---|---|---|---|
| **1** | Scaffold, DB schema, Docker baseline | P0 | — |
| **2** | Upload API + Celery tree build pipeline | P0 | Bedrock (tree builder) |
| **3** | PageIndex chat engine, citations, SSE streaming | P0 | Bedrock (navigator + answer) |
| **4** | React frontend, 3-panel chat UI, PDF viewer | P0 | Phase 2 + 3 |
| **5** | Insights panel, tree explorer, chat analytics | P1 | Phase 3 |
| **6** | Production Docker hardening, health checks | P1 | All phases |
| **7** | Security hardening, audit trail, enterprise auth | P2 | Phase 1 |
| **8** | DeepEval + Bedrock evaluation, quality gate, dashboard | P1 | Phase 3 + Bedrock |

---

## Quick Start (Development)

```bash
# Clone and configure
git clone https://github.com/minfy/documind
cd documind
cp .env.example .env.local

# Add AWS credentials to .env.local
# AWS_ACCESS_KEY_ID=...
# AWS_SECRET_ACCESS_KEY=...
# AWS_DEFAULT_REGION=us-east-1

# Start all services
docker-compose -f docker/docker-compose.yml \
               -f docker/docker-compose.dev.yml up --build

# Run DB migrations
docker exec documind_backend alembic upgrade head

# Run eval CI tests
docker exec documind_backend pytest tests/eval/ -v
```

---

*DocuMind — built by Minfy AI CoE*  
*Stack: FastAPI · React/TypeScript · Shadcn/UI · Tailwind · PostgreSQL · PageIndex · AWS Bedrock · DeepEval*
