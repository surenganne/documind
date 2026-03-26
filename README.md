# DocuMind

AI-powered document intelligence platform for RAG (Retrieval-Augmented Generation) with real-time quality monitoring and evaluation.

## Features

- 📄 Multi-format document processing (PDF, DOCX, TXT, MD)
- 🤖 AI-powered chat with your documents
- 📊 Real-time quality monitoring and analytics
- 🔍 Advanced semantic search
- 👥 Multi-user workspace support
- 🎯 Automated evaluation with AWS Bedrock
- 🔐 Secure authentication and authorization

## Tech Stack

- **Frontend**: React, TypeScript, TailwindCSS, Vite
- **Backend**: Python, FastAPI, PostgreSQL, Redis
- **AI/ML**: AWS Bedrock (Claude), LangChain, DeepEval
- **Storage**: AWS S3
- **Infrastructure**: Docker, Docker Compose

## Quick Start

### Prerequisites

- Docker & Docker Compose
- AWS CLI configured with SSO
- AWS account with S3 and Bedrock access

### One-Command Setup

```bash
./setup.sh
# or
make setup
```

This script will:
1. Check prerequisites (Docker, AWS CLI)
2. Verify AWS credentials (auto-login if needed)
3. Create S3 bucket (`documind-app-storage-2026`)
4. Stop any running local processes
5. Clean up existing Docker containers
6. Build and start all services
7. Verify health and AWS connectivity

### Manual Setup

If you prefer manual setup:

1. **Configure AWS**
   ```bash
   aws configure sso
   aws sso login --profile your-profile
   ```

2. **Create S3 Bucket**
   ```bash
   aws s3 mb s3://documind-app-storage-2026 --region us-east-1
   ```

3. **Update Environment**
   ```bash
   cp .env.example .env
   # Edit .env with your settings
   ```

4. **Start Services**
   ```bash
   docker-compose up -d --build
   ```

## Services

Once running, access:

- **Frontend**: http://localhost:5180
- **Backend API**: http://localhost:8010
- **API Docs**: http://localhost:8010/docs
- **PostgreSQL**: localhost:5440
- **Redis**: localhost:6380

## Default Admin Credentials

```
Email:    admin@documind.ai
Password: Admin123!
```

Change the password after first login in Settings page.

## Usage

### Upload Documents

1. Navigate to Library page
2. Click "Upload Document"
3. Select files (PDF, DOCX, TXT, MD)
4. Documents are processed and stored in S3

### Chat with Documents

1. Go to Chat page
2. Select a Knowledge Base
3. Start asking questions
4. Get AI-powered answers with citations

### Monitor Quality

1. Visit Settings page (Admin only)
2. View Quality Monitor dashboard
3. See evaluation metrics:
   - Answer confidence distribution
   - Quality trends over time
   - Low-confidence queries
   - Performance heatmaps

## Development

### Project Structure

```
documind/
├── backend/              # FastAPI backend
│   ├── app/
│   │   ├── api/         # API routes
│   │   ├── core/        # Config, database
│   │   ├── models/      # SQLAlchemy models
│   │   ├── services/    # Business logic
│   │   └── workers/     # Celery tasks
│   └── alembic/         # Database migrations
├── frontend/            # React frontend
│   └── src/
│       ├── components/  # React components
│       ├── pages/       # Page components
│       └── services/    # API clients
└── docker-compose.yml   # Service orchestration
```

### Useful Commands

```bash
# Quick commands with Make
make setup          # Complete setup (AWS, S3, Docker)
make up             # Start services
make down           # Stop services
make restart        # Restart services
make logs           # View logs
make build          # Rebuild services
make reset          # Clean slate restart
make shell-backend  # Backend shell
make shell-db       # PostgreSQL shell

# Or use docker-compose directly
docker-compose logs -f backend
docker-compose logs -f celery-worker
docker-compose logs -f frontend
docker-compose restart
docker-compose down
docker-compose down -v && docker-compose up -d --build

# Access backend shell
docker-compose exec backend bash

# Run database migrations
docker-compose exec backend alembic upgrade head

# Create new migration
docker-compose exec backend alembic revision --autogenerate -m "description"
```

### Environment Variables

Key variables in `.env`:

```bash
# Database
DATABASE_URL=postgresql+asyncpg://documind:documind@localhost:5440/documind

# Redis
REDIS_URL=redis://localhost:6380/0
CELERY_BROKER_URL=redis://localhost:6380/1
CELERY_RESULT_BACKEND=redis://localhost:6380/2

# AWS
AWS_PROFILE=default
AWS_REGION=us-east-1
S3_BUCKET=documind-app-storage-2026

# Security
SECRET_KEY=your-secret-key-here

# CORS
CORS_ORIGINS=http://localhost:5180,http://localhost:5173
```

## Evaluation System

DocuMind includes automated quality evaluation:

- **Metrics**: Faithfulness, Answer Relevancy, Contextual Precision, Contextual Recall, Hallucination
- **Trigger**: Automatic after each chat message
- **Backend**: AWS Bedrock with Claude Sonnet 4.5 (requires Python 3.10+)
- **Fallback**: Sample scores for Python 3.9

### Python Version Behavior

- **Python 3.9**: Uses sample scores (realistic variation)
- **Python 3.10+**: Uses real AWS Bedrock evaluations

To upgrade for real evaluations:
1. Update Dockerfile to use Python 3.10+
2. Rebuild: `docker-compose up -d --build`
3. Ensure Bedrock access is enabled in AWS

## Architecture

See [ARCHITECTURE.md](ARCHITECTURE.md) for detailed system design.

## Troubleshooting

### AWS Credentials Issues

```bash
# Re-login to AWS SSO
aws sso login --profile your-profile

# Verify credentials
aws sts get-caller-identity --profile your-profile

# Restart containers
docker-compose restart backend celery-worker
```

### S3 Access Denied

```bash
# Check bucket exists
aws s3 ls | grep documind

# Test access
aws s3 ls s3://documind-app-storage-2026

# Verify .env configuration
grep S3_BUCKET .env
```

### Backend Won't Start

```bash
# Check logs
docker-compose logs backend

# Verify database is running
docker-compose ps postgres

# Reset database
docker-compose down -v
docker-compose up -d
```

### Frontend Build Errors

```bash
# Clear node_modules
docker-compose down
docker-compose up -d --build frontend
```

## Production Deployment

For production:

1. Use Python 3.10+ for real Bedrock evaluations
2. Set strong `SECRET_KEY`
3. Use IAM roles instead of SSO profiles
4. Enable HTTPS/TLS
5. Configure proper CORS origins
6. Set up monitoring and logging
7. Use managed PostgreSQL (RDS)
8. Use managed Redis (ElastiCache)
9. Enable S3 versioning and lifecycle policies
10. Set up backup and disaster recovery

## License

MIT License - see LICENSE file for details

## Support

For issues and questions:
- Check [ARCHITECTURE.md](ARCHITECTURE.md) for system design
- Review logs: `docker-compose logs -f`
- Verify AWS access: `aws sts get-caller-identity`
