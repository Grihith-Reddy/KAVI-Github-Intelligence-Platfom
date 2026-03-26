# KAVI

**Tagline:** KAVI remembers why your code exists.

KAVI is a Developer Experience platform that ingests GitHub pull requests, extracts engineering intent, and serves it back as a searchable knowledge base with a chat interface.

## Monorepo Structure
```
kavi/
├── frontend/
├── backend/
├── database/
├── docs/
└── README.md
```

## Prerequisites
- Node.js 18+
- Python 3.11+
- PostgreSQL 14+

## Setup
### 1) Database
- Create a database named `kavi`.
- Apply schema and post-initial hardening migration:
```sql
\i database/schema.sql
\i database/migrations/002_access_control_and_sync_jobs.sql
```

### 2) Backend
```bash
cd backend
python -m venv .venv
. .venv/bin/activate
pip install -r requirements.txt
```
Create a `.env` file using `backend/.env.example` as a template.

Generate a Fernet key for `TOKEN_ENCRYPTION_KEY`:
```bash
python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
```

Run the API:
```bash
uvicorn app.main:app --reload --port 8000
```

Run the durable ingestion worker in a separate process:
```bash
python -m app.workers.ingestion_worker
```

### 3) Frontend
```bash
cd frontend
npm install
npm run dev
```
Create a `.env` file using `frontend/.env.example` as a template.

## Key Principles
- Pull Requests are the primary unit of intent.
- AI summarization happens only during ingestion.
- Chat queries are deterministic and always database-backed.
- Knowledge is repo-scoped and access-controlled per connected GitHub account.
- Repository sync jobs are durable and worker-driven when queued asynchronously.

## Docs
- `docs/architecture.md`
- `docs/api-contracts.md`
- `docs/workflows.md`
- `docs/public-launch.md`
