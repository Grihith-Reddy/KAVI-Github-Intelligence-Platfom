# Public Launch Runbook

## Deployment topology
- Run the FastAPI API service and the ingestion worker as separate processes.
- Keep PostgreSQL on managed storage with automated backups enabled.
- Terminate TLS at the edge and expose only the frontend origin configured in `FRONTEND_URL`.

## Required launch gates
- Apply `database/schema.sql` and `database/migrations/002_access_control_and_sync_jobs.sql`.
- Set real values for `GITHUB_STATE_SECRET` and `TOKEN_ENCRYPTION_KEY`.
- Confirm `GET /health/live` and `GET /health/ready` both return success in the deployed environment.
- Run backend unit tests and frontend production build in CI on every push.
- Run the load test in `docs/load-test.js` against staging before each public release.

## Auth and data isolation
- Repository access is enforced through `repository_access`, not just user existence.
- Knowledge, chat, and repository status endpoints reject repo IDs that are not mapped to the caller's connected GitHub account.
- Sync operations grant access explicitly during repository ingestion instead of mutating shared repo ownership.

## SLOs
- Auth verification success rate: `>= 99.9%` over 30 days.
- Repository listing p95 latency: `< 800 ms` excluding GitHub outages.
- Knowledge endpoints p95 latency: `< 350 ms`.
- Chat endpoint p95 latency: `< 5 s` with indexed context available.
- Sync queue pickup delay p95: `< 30 s`.

## Load test pass criteria
- Sustain at least `50` concurrent read users for 15 minutes with no 5xx burst above `0.5%`.
- Keep chat p95 below `5 s`.
- Keep knowledge list p95 below `350 ms`.
- Keep CPU below `70%` and database connections below `80%` of pool capacity.

## Alerts and observability
- Alert on any 5-minute window with `5xx > 1%`.
- Alert on repeated `429` spikes from the app or GitHub upstream.
- Alert when sync jobs remain queued for more than 5 minutes.
- Store JSON audit logs for auth verification, GitHub connection, repo sync, repo status, knowledge access, and chat queries.

## Backup and recovery
- Enable daily PostgreSQL backups with point-in-time recovery.
- Test restore to staging at least once per month.
- Keep rollback instructions for both API and frontend releases.

## Privacy and retention
- GitHub integration is read-only.
- Access tokens are encrypted at rest with Fernet.
- Define and publish user-facing docs for:
- Terms of Service
- Privacy Policy
- Data retention window for indexed PR content
- Account and repository disconnect/deletion flow
- These documents still require legal review before public launch.

## Release procedure
- Deploy to staging first.
- Run backend tests, frontend build, and staging load test.
- Start the API, then the ingestion worker, then promote frontend.
- Watch `/health/ready`, error rate, queue depth, and auth failures for the first 30 minutes.
- Roll back immediately on auth leakage, queue stalls, or sustained 5xx errors.
