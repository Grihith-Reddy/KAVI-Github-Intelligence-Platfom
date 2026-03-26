CREATE TABLE IF NOT EXISTS repository_access (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    repository_id UUID NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
    github_account_id UUID NOT NULL REFERENCES github_accounts(id) ON DELETE CASCADE,
    permission TEXT NOT NULL DEFAULT 'read',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (permission IN ('read', 'admin')),
    UNIQUE (repository_id, github_account_id)
);

INSERT INTO repository_access (id, repository_id, github_account_id, permission)
SELECT gen_random_uuid(), r.id, r.github_account_id, 'read'
FROM repositories r
WHERE r.github_account_id IS NOT NULL
ON CONFLICT (repository_id, github_account_id) DO NOTHING;

CREATE TABLE IF NOT EXISTS sync_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    github_account_id UUID NOT NULL REFERENCES github_accounts(id) ON DELETE CASCADE,
    repo_id UUID REFERENCES repositories(id) ON DELETE SET NULL,
    repo_full_name TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'completed', 'failed')),
    attempt_count INTEGER NOT NULL DEFAULT 0,
    max_attempts INTEGER NOT NULL DEFAULT 4,
    last_error TEXT,
    result_summary JSONB,
    available_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    started_at TIMESTAMPTZ,
    finished_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_repository_access_repository ON repository_access(repository_id);
CREATE INDEX IF NOT EXISTS idx_repository_access_account ON repository_access(github_account_id);
CREATE INDEX IF NOT EXISTS idx_sync_jobs_status_available ON sync_jobs(status, available_at);
CREATE INDEX IF NOT EXISTS idx_sync_jobs_repo_id ON sync_jobs(repo_id);
