#!/usr/bin/env bash
# reset_dev.sh — Wipe all uploaded documents, KBs, chat sessions, and eval data,
# then restart the backend and Celery worker clean.
#
# Usage:
#   bash scripts/reset_dev.sh          # interactive (asks for confirmation)
#   bash scripts/reset_dev.sh --yes    # non-interactive (skip confirmation)

set -euo pipefail

YELLOW='\033[1;33m'
GREEN='\033[0;32m'
RED='\033[0;31m'
NC='\033[0m'

# ── Confirmation ──────────────────────────────────────────────────────────────
if [[ "${1:-}" != "--yes" ]]; then
  echo -e "${YELLOW}⚠️  This will permanently delete:${NC}"
  echo "   • All documents, document trees, and S3/LocalStack files"
  echo "   • All knowledge bases"
  echo "   • All chat sessions and messages"
  echo "   • All eval results and eval configs"
  echo "   • All audit logs"
  echo ""
  read -r -p "Are you sure? [y/N] " confirm
  if [[ ! "$confirm" =~ ^[Yy]$ ]]; then
    echo "Aborted."
    exit 0
  fi
fi

echo ""
echo -e "${GREEN}▶ Stopping backend and Celery worker...${NC}"
pkill -f "uvicorn app.main" 2>/dev/null && echo "  stopped uvicorn" || echo "  uvicorn not running"
pkill -f "celery -A app.workers" 2>/dev/null && echo "  stopped celery" || echo "  celery not running"
sleep 1

# ── Wipe DB tables ────────────────────────────────────────────────────────────
echo -e "${GREEN}▶ Wiping database tables...${NC}"
docker exec documind-postgres-1 psql -U documind -d documind -c "
  TRUNCATE TABLE
    audit_logs,
    eval_results,
    eval_config,
    chat_messages,
    document_session_links,
    chat_sessions,
    document_trees,
    documents,
    knowledge_bases,
    users,
    workspaces
  RESTART IDENTITY CASCADE;
" 2>&1 | grep -v "^$" || {
  echo -e "${RED}  ✗ DB wipe failed — is documind-postgres-1 running?${NC}"
  echo "  Run: docker compose -f docker/docker-compose.yml -f docker/docker-compose.dev.yml up postgres redis localstack"
  exit 1
}
echo "  ✓ All tables truncated"

# ── Wipe S3 / LocalStack ──────────────────────────────────────────────────────
echo -e "${GREEN}▶ Clearing S3 bucket (LocalStack)...${NC}"
BUCKET="${S3_BUCKET:-documind-local}"
if docker exec documind-localstack-1 awslocal s3 ls "s3://$BUCKET" &>/dev/null; then
  docker exec documind-localstack-1 awslocal s3 rm "s3://$BUCKET" --recursive 2>&1 | tail -1
  echo "  ✓ s3://$BUCKET cleared"
else
  echo "  ⚠ Bucket s3://$BUCKET not found or LocalStack not running — skipping"
fi

# ── Wipe local uploads fallback ───────────────────────────────────────────────
LOCAL_UPLOADS="./data/uploads"
if [[ -d "$LOCAL_UPLOADS" ]]; then
  echo -e "${GREEN}▶ Clearing local uploads at $LOCAL_UPLOADS...${NC}"
  rm -rf "${LOCAL_UPLOADS:?}/workspaces"
  echo "  ✓ Local uploads cleared"
fi

# ── Run database migrations ───────────────────────────────────────────────────
echo -e "${GREEN}▶ Running database migrations...${NC}"
(
  cd backend
  unset REDIS_URL CELERY_BROKER_URL CELERY_RESULT_BACKEND DATABASE_URL
  python3 -m alembic upgrade head 2>&1 | grep -E "(INFO|Running|Will assume)" || true
)
echo "  ✓ Migrations applied"

# ── Seed default admin user ───────────────────────────────────────────────────
echo -e "${GREEN}▶ Seeding default admin user...${NC}"
ADMIN_EMAIL="${ADMIN_EMAIL:-admin@documind.ai}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:-DocuMind@2025}"
HASHED_PW=$(python3 -c "
import warnings; warnings.filterwarnings('ignore')
from passlib.context import CryptContext
print(CryptContext(schemes=['bcrypt'], deprecated='auto').hash('$ADMIN_PASSWORD'))
" 2>/dev/null)

docker exec documind-postgres-1 psql -U documind -d documind -c "
SET session_replication_role = replica;
INSERT INTO workspaces (id, name, owner_id, settings)
VALUES ('00000000-0000-0000-0000-000000000001', 'DocuMind', '00000000-0000-0000-0000-000000000002', '{}')
ON CONFLICT DO NOTHING;
INSERT INTO users (id, name, email, hashed_password, role, workspace_id, created_at)
VALUES ('00000000-0000-0000-0000-000000000002', 'Admin', '$ADMIN_EMAIL', '$HASHED_PW', 'admin', '00000000-0000-0000-0000-000000000001', NOW())
ON CONFLICT DO NOTHING;
SET session_replication_role = DEFAULT;
" 2>&1 | grep -v "^$"
echo "  ✓ Admin user: $ADMIN_EMAIL / $ADMIN_PASSWORD"

# ── Flush Redis queues ────────────────────────────────────────────────────────
echo -e "${GREEN}▶ Flushing Redis task queues...${NC}"
docker exec documind-redis-1 redis-cli -n 1 FLUSHDB 2>&1 | grep -v "^$"
docker exec documind-redis-1 redis-cli -n 2 FLUSHDB 2>&1 | grep -v "^$"
echo "  ✓ Redis queues flushed"

# ── Restart backend ───────────────────────────────────────────────────────────
echo -e "${GREEN}▶ Restarting backend (uvicorn)...${NC}"
(
  cd backend
  # Unset any shell env overrides so .env values are used
  unset REDIS_URL CELERY_BROKER_URL CELERY_RESULT_BACKEND DATABASE_URL
  nohup python3 -m uvicorn app.main:app --host 0.0.0.0 --port 8010 --reload \
    > /tmp/documind-uvicorn.log 2>&1 &
  echo $! > /tmp/documind-uvicorn.pid
)
sleep 3
if curl -sf http://localhost:8010/health > /dev/null; then
  echo "  ✓ Backend running at http://localhost:8010"
else
  echo -e "${RED}  ✗ Backend failed to start — check /tmp/documind-uvicorn.log${NC}"
fi

# ── Restart Celery worker ─────────────────────────────────────────────────────
echo -e "${GREEN}▶ Restarting Celery worker...${NC}"
(
  cd backend
  # Unset any shell env overrides so .env values are used
  unset REDIS_URL CELERY_BROKER_URL CELERY_RESULT_BACKEND DATABASE_URL
  nohup python3 -m celery -A app.workers worker -Q default --concurrency=2 --loglevel=info \
    > /tmp/documind-celery.log 2>&1 &
  echo $! > /tmp/documind-celery.pid
)
sleep 3
if (cd backend && unset REDIS_URL CELERY_BROKER_URL CELERY_RESULT_BACKEND DATABASE_URL && \
    python3 -m celery -A app.workers inspect ping --timeout=8 2>/dev/null | grep -q pong); then
  echo "  ✓ Celery worker running"
else
  echo -e "${RED}  ✗ Celery worker failed to start — check /tmp/documind-celery.log${NC}"
fi

echo ""
echo -e "${GREEN}✅ Reset complete. Fresh start ready.${NC}"
echo ""
echo "  Backend:  http://localhost:8010"
echo "  API docs: http://localhost:8010/docs"
echo "  Frontend: http://localhost:5180  (run 'npm run dev' in frontend/ if not running)"
echo ""
echo "  Logs:"
echo "    tail -f /tmp/documind-uvicorn.log"
echo "    tail -f /tmp/documind-celery.log"
