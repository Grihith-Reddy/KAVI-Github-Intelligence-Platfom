# KAVI API Contracts

Base URL: `/api`

## Auth
### GET `/auth/verify`
Validates Firebase ID token and upserts user.
- Auth: `Authorization: Bearer <token>`
- Response:
```json
{ "status": "ok", "user": { "id": "uuid", "auth0_sub": "firebase-uid", "email": "..." } }
```

### GET `/auth/me`
Returns the current user.
- Auth: Required

## GitHub OAuth
### GET `/github/status`
Returns whether the authenticated user has connected GitHub.
- Auth: Required
- Response:
```json
{ "connected": true, "account": { "id": "uuid", "username": "octocat", "updated_at": "..." } }
```
or
```json
{ "connected": false, "account": null }
```

### GET `/github/connect-url`
Returns GitHub OAuth URL.
- Auth: Required
- Response:
```json
{ "url": "https://github.com/login/oauth/authorize?..." }
```

### GET `/github/callback`
GitHub OAuth callback handler.
- Query: `code`, `state`, `redirect` (optional, default true)
- Response: Redirects to frontend `/repositories` when `redirect=true`.
- JSON Response (when `redirect=false`):
```json
{ "status": "connected", "github_account_id": "uuid" }
```

### GET `/github/repositories`
Lists accessible repositories with sync status.
- Auth: Required
- Response:
```json
{ "repositories": [ { "id": 1, "full_name": "org/repo", "synced_at": "..." } ] }
```

## Ingestion
### POST `/ingestion/repositories/sync`
Triggers repository ingestion.
- Auth: Required
- Query: `wait=true|false`
- Body:
```json
{ "repo_full_name": "org/repo" }
```
- Response (wait=true):
```json
{ "status": "completed", "repo_id": "uuid", "synced_prs": 12, "errors": [] }
```

### GET `/ingestion/repositories/{repo_id}/status`
Returns sync metadata for a repository.

## Knowledge
### GET `/knowledge/repositories/{repo_id}/entries`
Lists knowledge entries for a repository.

### GET `/knowledge/entries/{entry_id}`
Returns a single knowledge entry and file mappings.

### GET `/knowledge/repositories/{repo_id}/timeline`
Returns PR timeline data.

### GET `/knowledge/repositories/{repo_id}/files`
Lists distinct files tracked in knowledge entries.

### GET `/knowledge/files`
Query params: `repo_id`, `path`.
Returns file detail and related PRs.

## Chat
### POST `/chat/query`
Searches knowledge entries and returns grounded response.
- Body:
```json
{ "repo_id": "uuid", "query": "Why does auth middleware exist?", "limit": 5 }
```
- Response:
```json
{ "answer": "...", "sources": [ { "entry_id": "...", "files": [] } ] }
```
