# DocuMind

DocuMind is an enterprise-grade AI document intelligence platform powered by **PageIndex** — a vectorless, reasoning-based RAG engine. Instead of semantic similarity search, PageIndex builds a hierarchical tree index from uploaded documents and uses LLM reasoning (AWS Bedrock Claude Sonnet 4.5) to navigate to the most relevant sections, returning cited answers with page references and full reasoning traces.

---

## PageIndex vs Traditional RAG

### Traditional RAG (Vector-Based)
Traditional Retrieval-Augmented Generation systems work by:
1. **Chunking**: Breaking documents into fixed-size chunks (e.g., 512 tokens)
2. **Embedding**: Converting each chunk into a vector using embedding models
3. **Storing**: Saving vectors in a vector database (Pinecone, Weaviate, ChromaDB)
4. **Retrieval**: Finding chunks with highest cosine similarity to the query
5. **Generation**: Feeding top-k similar chunks to LLM for answer generation

**Limitations:**
- ❌ **Context fragmentation**: Important information split across chunks
- ❌ **Semantic drift**: Similarity ≠ relevance (e.g., "bank" as financial vs riverbank)
- ❌ **No structure awareness**: Loses document hierarchy, section relationships
- ❌ **Fixed chunk size**: Too small = missing context, too large = noise
- ❌ **Black box retrieval**: No explanation of why chunks were selected
- ❌ **Expensive infrastructure**: Requires vector database, embedding models

### PageIndex (Reasoning-Based)
PageIndex takes a fundamentally different approach:
1. **Tree Building**: LLM analyzes document structure and creates hierarchical tree index
2. **Reasoning Navigation**: LLM reasons about which tree nodes are relevant to the query
3. **Targeted Retrieval**: Fetches only the specific sections identified by reasoning
4. **Contextual Generation**: LLM generates answer with full section context and citations

**Advantages:**
- ✅ **Structure-aware**: Preserves document hierarchy (chapters → sections → subsections)
- ✅ **Reasoning-driven**: LLM explicitly reasons about relevance, not just similarity
- ✅ **Full context**: Retrieves complete sections, not fragmented chunks
- ✅ **Transparent**: Full reasoning trace shows which nodes were visited and why
- ✅ **No vector DB**: Simpler architecture, lower infrastructure costs
- ✅ **Better citations**: Exact page numbers, section titles, node IDs
- ✅ **Multi-document**: Naturally merges trees from multiple documents

### Example Comparison

**Query:** "What is the termination notice period for employees?"

**Traditional RAG:**
```
Retrieved chunks:
1. "...employees must provide notice..."
2. "...termination procedures include..."
3. "...notice period varies by..."

Answer: "Based on the retrieved information, employees must provide notice, 
but the specific period is not clearly stated in these sections."
```

**PageIndex:**
```
Reasoning trace:
1. Navigate to "Employment Policies" (root node)
2. Explore "Termination Procedures" (depth 2)
3. Select "Notice Requirements" (depth 3)

Retrieved section: "Section 4.2 — Notice Requirements
All employees must provide a minimum of 30 days written notice..."

Answer: "According to Section 4.2 (Notice Requirements) on page 12, 
employees must provide a minimum of 30 days written notice before termination."
```

### When to Use PageIndex vs Traditional RAG

**Use PageIndex when:**
- Documents have clear hierarchical structure (contracts, policies, manuals)
- You need precise citations with page numbers and section references
- Transparency and explainability are critical
- You want to minimize infrastructure complexity
- Documents are long-form and well-organized

**Use Traditional RAG when:**
- Documents are unstructured (emails, chat logs, social media)
- You need sub-second latency (vector search is faster than LLM reasoning)
- Documents are very short or lack clear structure
- You're working with massive document collections (millions of docs)
- Semantic similarity is more important than structural reasoning

---

## Prerequisites

- [Docker](https://docs.docker.com/get-docker/) ≥ 24 with Docker Compose v2
- Python 3.11+ (for running backend/worker locally outside Docker)
- Node.js 20+ (for running frontend locally)
- AWS SSO configured in `~/.aws/config` with a named profile (local dev only)

---

## Dev Setup (Local — no Docker for backend/frontend)

This is the recommended flow for active development. Postgres, Redis, and LocalStack run in Docker; the backend, Celery worker, and frontend run directly on your machine for fast reloads.

### 1. Clone and configure environment

```bash
git clone <repo-url> documind
cd documind
cp .env.example .env
# Edit .env:
#   AWS_PROFILE=<your-sso-profile>   # for Bedrock calls
#   All other defaults work out of the box
```

### 2. Start infrastructure (Postgres, Redis, LocalStack S3)

```bash
docker compose -f docker/docker-compose.yml -f docker/docker-compose.dev.yml up postgres redis localstack
```

Wait for LocalStack to show `(healthy)` — it auto-creates the `documind-local` S3 bucket.

### 3. Install backend dependencies

```bash
cd backend
pip install -r requirements.txt -r requirements-dev.txt
```

### 4. Run database migrations

```bash
cd backend
alembic upgrade head
```

### 5. Start the FastAPI backend

```bash
cd backend
python3 -m uvicorn app.main:app --host 0.0.0.0 --port 8010 --reload
```

API available at: `http://localhost:8010`  
Interactive docs: `http://localhost:8010/docs`

### 6. Start the Celery worker (document processing)

Open a new terminal:

```bash
cd backend
python3 -m celery -A app.workers worker -Q default --concurrency=2 --loglevel=info
```

### 7. Start the frontend

Open a new terminal:

```bash
cd frontend
npm install
npm run dev
```

Frontend available at: `http://localhost:5180`

---

## Dev Setup (Full Docker)

Runs everything in containers. Slower iteration but closer to production.

```bash
cp .env.example .env
# Edit .env — set AWS_PROFILE
docker compose -f docker/docker-compose.yml -f docker/docker-compose.dev.yml up
```

Services:
- Frontend: `http://localhost:5180`
- Backend API: `http://localhost:8010`
- Nginx proxy: `http://localhost:8080`
- Postgres: `localhost:5440`
- Redis: `localhost:6380`
- LocalStack S3: `http://localhost:4566`

---

## Production

```bash
docker compose -f docker/docker-compose.yml -f docker/docker-compose.prod.yml up -d
```

Production containers authenticate to AWS via the EC2 instance role (IMDS) — no AWS credential variables are injected.

---

## Useful Commands

### Backend

```bash
# Run all property-based tests
cd backend && python3 -m pytest tests/ --ignore=tests/eval -q

# Run golden dataset integrity tests
cd backend && python3 -m pytest tests/eval/test_rag_quality.py::TestGoldenDatasetIntegrity -v

# Run DeepEval regression tests (requires AWS Bedrock)
cd backend && SKIP_DEEPEVAL_TESTS=false python3 -m pytest tests/eval/test_rag_quality.py::TestRAGQuality -v

# Create a new Alembic migration
cd backend && alembic revision --autogenerate -m "description"

# Apply migrations
cd backend && alembic upgrade head

# Rollback one migration
cd backend && alembic downgrade -1

# Inspect Celery queues
cd backend && python3 -m celery -A app.workers inspect active
cd backend && python3 -m celery -A app.workers inspect reserved
```

### LocalStack S3

```bash
# List buckets
docker exec documind-localstack-1 awslocal s3 ls

# List uploaded files
docker exec documind-localstack-1 awslocal s3 ls s3://documind-local --recursive

# Delete all uploaded files
docker exec documind-localstack-1 awslocal s3 rm s3://documind-local --recursive
```

### Database

```bash
# Connect to Postgres
docker exec -it documind-postgres-1 psql -U documind -d documind

# Reset everything (documents, KBs, sessions) — see scripts/reset_dev.sh
bash scripts/reset_dev.sh
```

---

## Reset / Clean Slate

`scripts/reset_dev.sh` wipes all data and restarts the backend and Celery worker fresh. Use it whenever you want a clean environment.

```bash
# Interactive (asks for confirmation)
bash scripts/reset_dev.sh

# Non-interactive (CI / automation)
bash scripts/reset_dev.sh --yes
```

What it does:
1. Stops uvicorn and the Celery worker
2. Truncates all DB tables (documents, KBs, chat sessions, eval results, audit logs, users, workspaces)
3. Clears the LocalStack S3 bucket
4. Flushes Redis task queues
5. Re-seeds the default admin user
6. Restarts the backend and Celery worker

After reset, log in with:
- **Email:** `admin@documind.ai`
- **Password:** `DocuMind@2025`

Override credentials via env vars:
```bash
ADMIN_EMAIL=you@example.com ADMIN_PASSWORD=MyPass123 bash scripts/reset_dev.sh --yes
```

Logs after restart:
```bash
tail -f /tmp/documind-uvicorn.log
tail -f /tmp/documind-celery.log
```

---

## Services

| Service | Port | Description |
|---|---|---|
| `nginx` | 8080 | Reverse proxy — HTTPS termination, CSP headers |
| `backend` | 8010 | FastAPI — REST API, SSE streaming, WebSocket |
| `celery_worker` | — | Document tree building (`default` queue, concurrency=2) |
| `eval_worker` | — | DeepEval quality evaluation (`eval_queue`, concurrency=2) |
| `celery_beat` | — | Nightly evaluation and file cleanup scheduler |
| `postgres` | 5440 | PostgreSQL 16 + pgvector |
| `redis` | 6380 | Celery broker + result backend + WebSocket state |
| `localstack` | 4566 | LocalStack S3 (dev only) |
| `frontend` | 5180 | React 18 + Vite dev server |

---

## Repository Layout

```
documind/
├── backend/
│   ├── app/
│   │   ├── api/routes/       # FastAPI routers
│   │   ├── core/             # config, security, database
│   │   ├── models/           # SQLAlchemy ORM models
│   │   ├── schemas/          # Pydantic request/response schemas
│   │   ├── services/         # pageindex, llm, document, eval
│   │   └── workers/          # Celery tasks
│   ├── alembic/              # DB migrations
│   └── tests/                # Property-based tests + eval suite
├── frontend/
│   └── src/
│       ├── pages/            # KnowledgeBases, Chat, Library, Settings
│       ├── components/       # UI components
│       ├── hooks/            # useChat, useDocuments, useStream
│       ├── stores/           # Zustand stores
│       └── api/              # Typed Axios client
├── docker/
│   ├── docker-compose.yml        # Base services
│   ├── docker-compose.dev.yml    # Dev overrides (hot reload, LocalStack)
│   └── docker-compose.prod.yml   # Prod overrides (resource limits, IMDS)
├── scripts/
│   └── reset_dev.sh          # Wipe all data and restart clean
├── .env.example              # Environment variable template
└── README.md
```

---

## Environment Variables

See `.env.example` for the full list. Key variables:

| Variable | Description |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string |
| `REDIS_URL` | Redis connection string |
| `SECRET_KEY` | JWT signing secret — change in production |
| `AWS_PROFILE` | AWS SSO profile name (local dev only) |
| `AWS_REGION` | AWS region for Bedrock calls (default: `us-east-1`) |
| `AWS_ENDPOINT_URL` | Override S3 endpoint — set to `http://localhost:4566` for LocalStack |
| `S3_BUCKET` | S3 bucket name for document storage |
| `CELERY_BROKER_URL` | Redis URL for Celery broker |
