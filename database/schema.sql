CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    auth0_sub TEXT NOT NULL UNIQUE,
    email TEXT,
    name TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS github_accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    github_user_id BIGINT NOT NULL UNIQUE,
    username TEXT NOT NULL,
    access_token_encrypted TEXT NOT NULL,
    token_scopes TEXT,
    token_expires_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (user_id)
);

CREATE TABLE IF NOT EXISTS repositories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    github_repo_id BIGINT NOT NULL UNIQUE,
    github_account_id UUID REFERENCES github_accounts(id) ON DELETE SET NULL,
    owner TEXT NOT NULL,
    name TEXT NOT NULL,
    full_name TEXT NOT NULL UNIQUE,
    is_private BOOLEAN NOT NULL DEFAULT FALSE,
    default_branch TEXT,
    synced_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

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

CREATE TABLE IF NOT EXISTS pull_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    repo_id UUID NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
    github_pr_id BIGINT NOT NULL,
    github_pr_number INTEGER NOT NULL,
    title TEXT,
    body TEXT,
    state TEXT,
    merged_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ,
    author_login TEXT,
    url TEXT,
    base_branch TEXT,
    head_branch TEXT,
    UNIQUE (repo_id, github_pr_number)
);

CREATE TABLE IF NOT EXISTS commits (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    repo_id UUID NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
    pr_id UUID REFERENCES pull_requests(id) ON DELETE SET NULL,
    github_sha TEXT NOT NULL,
    message TEXT,
    author_name TEXT,
    author_email TEXT,
    committed_at TIMESTAMPTZ,
    url TEXT,
    UNIQUE (repo_id, github_sha)
);

CREATE TABLE IF NOT EXISTS knowledge_entries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    repo_id UUID NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
    pr_id UUID UNIQUE REFERENCES pull_requests(id) ON DELETE SET NULL,
    summary TEXT,
    intent TEXT,
    decisions JSONB,
    risks JSONB,
    tags TEXT[],
    ai_model TEXT,
    source_data_hash TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    search_document tsvector GENERATED ALWAYS AS (
        to_tsvector('english', coalesce(summary, '') || ' ' || coalesce(intent, ''))
    ) STORED
);

CREATE TABLE IF NOT EXISTS file_mappings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    repo_id UUID NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
    knowledge_entry_id UUID NOT NULL REFERENCES knowledge_entries(id) ON DELETE CASCADE,
    file_path TEXT NOT NULL,
    start_line INTEGER,
    end_line INTEGER,
    confidence NUMERIC(4, 3),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (knowledge_entry_id, file_path, start_line, end_line)
);

CREATE INDEX IF NOT EXISTS idx_github_accounts_user_id ON github_accounts(user_id);
CREATE INDEX IF NOT EXISTS idx_repositories_full_name ON repositories(full_name);
CREATE INDEX IF NOT EXISTS idx_repository_access_repository ON repository_access(repository_id);
CREATE INDEX IF NOT EXISTS idx_repository_access_account ON repository_access(github_account_id);
CREATE INDEX IF NOT EXISTS idx_pull_requests_repo_id ON pull_requests(repo_id);
CREATE INDEX IF NOT EXISTS idx_commits_repo_pr ON commits(repo_id, pr_id);
CREATE INDEX IF NOT EXISTS idx_knowledge_entries_repo_id ON knowledge_entries(repo_id);
CREATE INDEX IF NOT EXISTS idx_knowledge_entries_search ON knowledge_entries USING GIN (search_document);
CREATE INDEX IF NOT EXISTS idx_file_mappings_repo_path ON file_mappings(repo_id, file_path);
CREATE INDEX IF NOT EXISTS idx_file_mappings_entry ON file_mappings(knowledge_entry_id);
CREATE INDEX IF NOT EXISTS idx_sync_jobs_status_available ON sync_jobs(status, available_at);
CREATE INDEX IF NOT EXISTS idx_sync_jobs_repo_id ON sync_jobs(repo_id);
