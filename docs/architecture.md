# KAVI Architecture

## Overview
KAVI is a production-grade Developer Experience platform that captures the intent behind code changes. It ingests pull requests from GitHub, distills the WHY into structured knowledge entries, and serves deterministic answers from a persistent database.

## System Components
- Frontend (React + Vite + Tailwind): GitHub-inspired UI with repository management, chat, file detail views, and timelines.
- Backend (FastAPI): JWT-protected REST APIs for auth verification, GitHub OAuth, ingestion, knowledge queries, and chat.
- Database (PostgreSQL): Relational store for users, GitHub accounts, repositories, pull requests, commits, knowledge entries, and file mappings.
- AI Summarization (Gemini): Used only during ingestion to summarize PR intent. Chat queries read from the database only.

## Data Flow
1. User authenticates via Firebase Authentication and receives an ID token.
2. Frontend sends the Firebase token on every API request.
3. User connects GitHub with OAuth (read-only). Token is encrypted and stored.
4. Repository sync ingests PRs, commits, and discussions.
5. AI summarizes each PR once and stores the structured output.
6. Chat queries perform database search and return grounded answers with references.

## Ingestion Pipeline
- Pull Requests are the primary unit of intent.
- Commits, comments, and reviews are grouped under each PR.
- For each PR, KAVI:
  - Fetches metadata and discussions.
  - Generates a summary using Gemini (single call per PR).
  - Stores knowledge entries and file mappings.
- File mappings store approximate line ranges derived from diff hunks (no full code).

## Security Model
- Token validation uses Firebase Admin SDK.
- GitHub tokens are encrypted at rest using Fernet.
- Knowledge is repo-scoped, not user-scoped.
- AI is never invoked in the real-time chat path.

## Scalability & Extensibility
- Modular services allow expansion to IDE plugins, private repos, and knowledge graphs.
- Ingestion can be moved to background workers without changing API contracts.
- Full-text search can evolve into vector search or hybrid retrieval.
