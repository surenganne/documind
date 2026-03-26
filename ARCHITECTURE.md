# DocuMind Architecture

## Overview

DocuMind is an enterprise-grade AI document intelligence platform powered by **PageIndex** — a vectorless, reasoning-based RAG (Retrieval-Augmented Generation) engine. Unlike traditional RAG systems that rely on semantic similarity search with vector databases, PageIndex builds hierarchical tree indexes from documents and uses LLM reasoning to navigate to relevant sections.

## Core Technology Stack

### Backend
- **Framework**: FastAPI (Python 3.11+)
- **Database**: PostgreSQL 16 with pgvector extension
- **Cache/Queue**: Redis 7
- **Task Queue**: Celery with async workers
- **ORM**: SQLAlchemy 2.0 (async)
- **Validation**: Pydantic v2
- **LLM Provider**: AWS Bedrock (Claude Sonnet 4.5)
- **Evaluation**: DeepEval with Bedrock as judge model

### Frontend
- **Framework**: React 18 with TypeScript
- **Build Tool**: Vite
- **UI Components**: Shadcn/UI + Tailwind CSS
- **State Management**: Zustand
- **HTTP Client**: Axios (typed)
- **Animations**: Framer Motion
- **PDF Rendering**: react-pdf

### Infrastructure
- **Containerization**: Docker + Docker Compose
- **Reverse Proxy**: Nginx
- **File Storage**: S3 (production) / LocalStack (development)
- **Deployment**: Docker Compose (dev/prod variants)

## System Architecture

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
```

## Docker Services

The application runs as a multi-container Docker Compose setup:

| Service | Purpose | Port |
|---------|---------|------|
| `nginx` | Reverse proxy, SSL termination, static file serving | 8080 |
| `backend` | FastAPI REST API, WebSocket, SSE streaming | 8010 |
| `celery_worker` | Document tree building (default queue) | - |
| `eval_worker` | DeepEval quality evaluation (eval_queue) | - |
| `celery_beat` | Scheduled tasks (nightly eval, cleanup) | - |
| `postgres` | PostgreSQL 16 database | 5440 |
| `redis` | Cache, Celery broker, WebSocket state | 6380 |
| `localstack` | S3 emulation for local development | 4566 |
| `frontend` | React dev server (dev only) | 5180 |

## Data Flow

### Document Upload & Processing

```
1. User uploads PDF/DOCX → Frontend
2. POST /api/v1/documents/upload → Backend
3. File stored in S3/LocalStack
4. Document record created (status: processing)
5. Celery task: build_document_tree.delay(doc_id)
6. Text extraction (pdfplumber/python-docx)
7. LLM generates hierarchical tree via Bedrock
8. Tree stored as JSONB in document_trees table
9. Status updated to 'ready'
10. WebSocket event notifies frontend
```

### Chat Query & Response

```
1. User sends query → Frontend
2. POST /api/v1/chat/sessions/{id}/messages → Backend
3. Load document tree(s) from database
4. PageIndex Navigator: LLM selects relevant nodes
5. Fetch raw text for selected nodes
6. PageIndex Answer Generator: LLM generates answer with citations
7. Stream response via SSE to frontend
8. Async: Celery task evaluates response with DeepEval
9. If low confidence: append empathy disclaimer
10. Store eval results in eval_results table
```

## Database Schema

### Core Tables

- **workspaces**: Multi-tenant workspace isolation
- **users**: User accounts with role-based access
- **documents**: Uploaded files with processing status
- **document_trees**: Hierarchical tree indexes (JSONB)
- **knowledge_bases**: Document collections
- **chat_sessions**: Conversation threads
- **chat_messages**: Messages with citations and reasoning traces
- **document_session_links**: M:N relationship between docs and sessions

### Evaluation Tables

- **eval_results**: DeepEval metric scores per message
- **eval_config**: Per-workspace quality thresholds
- **audit_logs**: Full audit trail of all operations

## PageIndex Engine

### Three-Stage Pipeline

1. **Tree Builder**
   - Extracts text from documents
   - Sends to Bedrock Claude with specialized prompt
   - Receives hierarchical JSON tree structure
   - Stores in `document_trees.tree_json`

2. **Tree Navigator**
   - Takes user query + tree structure
   - LLM reasons about which nodes are relevant
   - Returns list of node IDs to fetch

3. **Answer Generator**
   - Fetches raw text for selected nodes
   - LLM generates answer with inline citations
   - Includes page numbers, section titles, node IDs
   - Streams response token-by-token

### Key Features

- **No vector database**: Pure reasoning over document structure
- **Multi-document support**: Merges trees from multiple docs
- **Context-aware**: Passes last 5 message turns for multi-turn conversations
- **Citation format**: `{ doc_name, section_title, page_number, node_id, excerpt }`
- **Reasoning trace**: Full audit trail of nodes visited and why

## DeepEval Quality Assurance

### Metrics Evaluated

1. **Faithfulness** (≥0.85): Answer grounded in cited sections
2. **Answer Relevancy** (≥0.80): Answer relevant to query
3. **Contextual Precision** (≥0.75): Right nodes ranked highest
4. **Contextual Recall** (≥0.75): Context covers expected answer
5. **Hallucination** (≤0.15): No factual deviation from source

### Evaluation Modes

- **Online Async**: Every response evaluated post-generation
- **CI/CD Regression**: Golden dataset tests on every PR
- **Nightly Batch**: Re-evaluate past 24h messages, alert on degradation

### Quality Gate

Low-confidence responses trigger an empathy disclaimer:
> "Parts of this answer may not be fully grounded in the document. I recommend verifying the cited sections directly."

## Security & Compliance

- **Workspace Isolation**: All queries scoped to `workspace_id`
- **Role-Based Access**: Admin, Editor, Viewer roles
- **JWT Authentication**: Access + refresh token flow
- **Audit Trail**: Every operation logged to `audit_logs`
- **IAM Least Privilege**: Bedrock access scoped to specific model ARNs
- **Input Validation**: Magic bytes check, MIME type whitelist
- **HTTPS Enforced**: SSL termination at nginx layer

## Development vs Production

### Development Setup
- Postgres, Redis, LocalStack in Docker
- Backend, Celery, Frontend run locally for hot reload
- LocalStack S3 for file storage
- AWS SSO profile for Bedrock access

### Production Setup
- All services in Docker containers
- Real S3 for file storage
- EC2 instance role for Bedrock access (IMDS)
- Resource limits and health checks
- Structured JSON logging with correlation IDs

## Infra Folder

The `infra/` folder is currently a placeholder (contains only `.gitkeep`). It's intended for Infrastructure as Code (IaC) when deploying to cloud providers:

- **Terraform**: AWS infrastructure definitions
- **CDK**: AWS Cloud Development Kit stacks
- **Kubernetes**: Helm charts or manifests
- **CI/CD**: GitHub Actions, GitLab CI, or Jenkins pipelines

For now, deployment uses Docker Compose with environment-specific overrides (`docker-compose.dev.yml`, `docker-compose.prod.yml`).

## Key Design Decisions

1. **Vectorless RAG**: PageIndex uses LLM reasoning over document structure instead of semantic similarity search
2. **Async Everything**: Celery for long-running tasks, SSE for streaming responses
3. **Quality-First**: Every response evaluated with DeepEval, low-confidence answers flagged
4. **Multi-Tenant**: Workspace isolation at database level
5. **AWS Bedrock**: Single LLM provider for consistency, cost control, and enterprise compliance
6. **Monorepo**: Backend and frontend in same repo for easier development
7. **Docker-First**: All services containerized for consistent environments

## Monitoring & Observability

- **Health Checks**: `/health`, `/health/db`, `/health/redis`
- **Structured Logging**: JSON logs with correlation IDs
- **Metrics**: DeepEval scores tracked per message
- **Quality Dashboard**: Faithfulness trends, low-score alerts
- **Audit Trail**: Full history of queries, citations, evaluations

## Future Enhancements

- **Multi-Turn Evaluation**: DeepEval turn-level metrics
- **Hybrid Search**: Optional vector embeddings for semantic fallback
- **More Document Types**: PPTX, XLSX, HTML support
- **SSO Integration**: Google/Microsoft OAuth for enterprise
- **Advanced Analytics**: Query patterns, document heatmaps
- **PII Detection**: Bedrock Guardrails integration
- **Kubernetes Deployment**: Helm charts for cloud-native scaling

---

*Last Updated: March 2026*
