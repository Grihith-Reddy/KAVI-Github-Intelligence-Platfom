# KAVI Workflows

## 1) User Authentication
1. User clicks "Login" and authenticates via Firebase.
2. Firebase returns an ID token to the frontend.
3. Frontend includes the token on all API calls.
4. Backend validates the token using Firebase Admin SDK and upserts the user.

## 2) GitHub Connection
1. After Firebase login, frontend checks `/github/status`.
2. If not connected, user is redirected to GitHub Connect page.
3. Frontend requests `/github/connect-url` and redirects the user.
4. GitHub redirects back to `/github/callback` with `code` and `state`.
5. Backend exchanges code for an access token and stores it encrypted.

## 3) Repository Sync
1. User chooses a repository to sync.
2. Frontend posts to `/ingestion/repositories/sync`.
3. Backend fetches PRs, commits, comments, and reviews.
4. AI summary is generated once per PR and stored in `knowledge_entries`.
5. File mappings are created for approximate line ranges.

## 4) Chat Query
1. User submits a chat question in the dashboard.
2. Backend searches `knowledge_entries` using full-text search.
3. Results are returned with PR context and file references.
4. Frontend renders the response with sources, file paths, and line ranges.

## 5) File Detail
1. User selects a file from the dashboard.
2. Frontend calls `/knowledge/files` with repo and path.
3. Backend returns related PRs, summaries, and line ranges.
