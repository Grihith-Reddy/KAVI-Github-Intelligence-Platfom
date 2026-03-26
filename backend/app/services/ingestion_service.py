import hashlib
import json
import logging
import re
from typing import Any

from fastapi import HTTPException
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.access import grant_repository_access
from app.core.audit import audit_log
from app.core.settings import settings
from app.services.ai_service import AIService
from app.services.github_service import GitHubService


logger = logging.getLogger(__name__)
PR_SUMMARY_SCHEMA_VERSION = 2
MAX_SUMMARY_FILE_CONTEXT = 120
MAX_SUMMARY_PATCH_CHARS = 800
MAX_SUMMARY_TEXT_ITEMS = 200
MAX_SUMMARY_TEXT_CHARS = 1000


def _hash_payload(payload: dict[str, Any]) -> str:
    digest = hashlib.sha256(json.dumps(payload, sort_keys=True).encode()).hexdigest()
    return digest


def _parse_patch_ranges(patch: str | None) -> tuple[int | None, int | None]:
    if not patch:
        return None, None

    ranges = []
    for match in re.finditer(r"@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@", patch):
        start = int(match.group(1))
        length = int(match.group(2) or 1)
        ranges.append((start, start + max(length - 1, 0)))

    if not ranges:
        return None, None

    start_line = min(r[0] for r in ranges)
    end_line = max(r[1] for r in ranges)
    return start_line, end_line


def _normalize_text(value: Any, max_length: int = MAX_SUMMARY_TEXT_CHARS) -> str:
    if value is None:
        return ""
    text_value = str(value).strip()
    if not text_value:
        return ""
    return text_value[:max_length]


def _compact_pr_file(file_info: dict[str, Any]) -> dict[str, Any]:
    patch = _normalize_text(file_info.get("patch"), max_length=MAX_SUMMARY_PATCH_CHARS)
    return {
        "filename": _normalize_text(file_info.get("filename"), max_length=320),
        "status": _normalize_text(file_info.get("status"), max_length=32),
        "previous_filename": _normalize_text(file_info.get("previous_filename"), max_length=320),
        "additions": int(file_info.get("additions") or 0),
        "deletions": int(file_info.get("deletions") or 0),
        "changes": int(file_info.get("changes") or 0),
        "patch_excerpt": patch,
    }


def _build_pr_payload(
    pr_detail: dict[str, Any],
    commits: list[dict[str, Any]],
    comments: list[dict[str, Any]],
    reviews: list[dict[str, Any]],
    files: list[dict[str, Any]],
) -> dict[str, Any]:
    compact_files = [
        _compact_pr_file(item)
        for item in files[:MAX_SUMMARY_FILE_CONTEXT]
        if isinstance(item, dict) and _normalize_text(item.get("filename"), max_length=320)
    ]
    changed_files = [item.get("filename") for item in compact_files if item.get("filename")]

    commits_text = [
        _normalize_text(c.get("commit", {}).get("message"))
        for c in commits[:MAX_SUMMARY_TEXT_ITEMS]
        if isinstance(c, dict)
    ]
    comments_text = [
        _normalize_text(c.get("body"))
        for c in comments[:MAX_SUMMARY_TEXT_ITEMS]
        if isinstance(c, dict)
    ]
    reviews_text = [
        _normalize_text(r.get("body"))
        for r in reviews[:MAX_SUMMARY_TEXT_ITEMS]
        if isinstance(r, dict)
    ]

    additions = sum(int(item.get("additions") or 0) for item in compact_files)
    deletions = sum(int(item.get("deletions") or 0) for item in compact_files)
    renamed_files = sum(1 for item in compact_files if str(item.get("status") or "").lower() == "renamed")
    added_files = sum(1 for item in compact_files if str(item.get("status") or "").lower() == "added")
    removed_files = sum(1 for item in compact_files if str(item.get("status") or "").lower() == "removed")

    return {
        "summary_schema_version": PR_SUMMARY_SCHEMA_VERSION,
        "title": pr_detail.get("title"),
        "body": pr_detail.get("body"),
        "number": pr_detail.get("number"),
        "state": pr_detail.get("state"),
        "merged_at": pr_detail.get("merged_at"),
        "author": pr_detail.get("user", {}).get("login"),
        "base_branch": pr_detail.get("base", {}).get("ref"),
        "head_branch": pr_detail.get("head", {}).get("ref"),
        "commits": [text for text in commits_text if text],
        "comments": [text for text in comments_text if text],
        "reviews": [text for text in reviews_text if text],
        "files": changed_files,
        "file_changes": compact_files,
        "change_stats": {
            "file_count": len(changed_files),
            "additions": additions,
            "deletions": deletions,
            "renamed_files": renamed_files,
            "added_files": added_files,
            "removed_files": removed_files,
        },
    }


def _upsert_repository(db: Session, repo: dict[str, Any], github_account_id: str | None) -> str:
    stmt = text(
        """
        INSERT INTO repositories (
            id, github_repo_id, owner, name, full_name, is_private,
            default_branch, github_account_id
        )
        VALUES (
            gen_random_uuid(), :github_repo_id, :owner, :name, :full_name, :is_private,
            :default_branch, :github_account_id
        )
        ON CONFLICT (github_repo_id)
        DO UPDATE SET
            owner = EXCLUDED.owner,
            name = EXCLUDED.name,
            full_name = EXCLUDED.full_name,
            is_private = EXCLUDED.is_private,
            default_branch = EXCLUDED.default_branch,
            github_account_id = COALESCE(repositories.github_account_id, EXCLUDED.github_account_id),
            updated_at = NOW()
        RETURNING id;
        """
    )
    result = db.execute(
        stmt,
        {
            "github_repo_id": repo["id"],
            "owner": repo["owner"]["login"],
            "name": repo["name"],
            "full_name": repo["full_name"],
            "is_private": repo.get("private", False),
            "default_branch": repo.get("default_branch"),
            "github_account_id": github_account_id,
        },
    ).fetchone()
    return str(result[0])


def _upsert_pr(db: Session, repo_id: str, pr: dict[str, Any]) -> str:
    stmt = text(
        """
        INSERT INTO pull_requests (
            id, repo_id, github_pr_id, github_pr_number, title, body, state,
            merged_at, created_at, updated_at, author_login, url, base_branch, head_branch
        )
        VALUES (
            gen_random_uuid(), :repo_id, :github_pr_id, :github_pr_number, :title, :body, :state,
            :merged_at, :created_at, :updated_at, :author_login, :url, :base_branch, :head_branch
        )
        ON CONFLICT (repo_id, github_pr_number)
        DO UPDATE SET
            title = EXCLUDED.title,
            body = EXCLUDED.body,
            state = EXCLUDED.state,
            merged_at = EXCLUDED.merged_at,
            updated_at = EXCLUDED.updated_at,
            author_login = EXCLUDED.author_login,
            url = EXCLUDED.url,
            base_branch = EXCLUDED.base_branch,
            head_branch = EXCLUDED.head_branch
        RETURNING id;
        """
    )
    result = db.execute(
        stmt,
        {
            "repo_id": repo_id,
            "github_pr_id": pr["id"],
            "github_pr_number": pr["number"],
            "title": pr.get("title"),
            "body": pr.get("body"),
            "state": pr.get("state"),
            "merged_at": pr.get("merged_at"),
            "created_at": pr.get("created_at"),
            "updated_at": pr.get("updated_at"),
            "author_login": pr.get("user", {}).get("login"),
            "url": pr.get("html_url"),
            "base_branch": pr.get("base", {}).get("ref"),
            "head_branch": pr.get("head", {}).get("ref"),
        },
    ).fetchone()
    return str(result[0])


def _upsert_commits(db: Session, repo_id: str, pr_id: str, commits: list[dict[str, Any]]) -> None:
    stmt = text(
        """
        INSERT INTO commits (
            id, repo_id, pr_id, github_sha, message, author_name, author_email, committed_at, url
        )
        VALUES (
            gen_random_uuid(), :repo_id, :pr_id, :github_sha, :message, :author_name,
            :author_email, :committed_at, :url
        )
        ON CONFLICT (repo_id, github_sha)
        DO UPDATE SET
            message = EXCLUDED.message,
            author_name = EXCLUDED.author_name,
            author_email = EXCLUDED.author_email,
            committed_at = EXCLUDED.committed_at,
            url = EXCLUDED.url,
            pr_id = EXCLUDED.pr_id;
        """
    )
    for commit in commits:
        author = commit.get("commit", {}).get("author", {})
        db.execute(
            stmt,
            {
                "repo_id": str(repo_id),
                "pr_id": str(pr_id),
                "github_sha": commit.get("sha"),
                "message": commit.get("commit", {}).get("message"),
                "author_name": author.get("name"),
                "author_email": author.get("email"),
                "committed_at": author.get("date"),
                "url": commit.get("html_url"),
            },
        )

def _upsert_knowledge_entry(
    db: Session,
    repo_id: str,
    pr_id: str,
    summary: dict[str, Any],
    source_hash: str,
) -> str:
    stmt = text(
        """
        INSERT INTO knowledge_entries (
            id, repo_id, pr_id, summary, intent, decisions, risks, tags,
            ai_model, source_data_hash
        )
        VALUES (
            gen_random_uuid(), :repo_id, :pr_id, :summary, :intent, CAST(:decisions AS jsonb), CAST(:risks AS jsonb), CAST(:tags AS text[]),
            :ai_model, :source_data_hash
        )
        ON CONFLICT (pr_id)
        DO UPDATE SET
            summary = EXCLUDED.summary,
            intent = EXCLUDED.intent,
            decisions = EXCLUDED.decisions,
            risks = EXCLUDED.risks,
            tags = EXCLUDED.tags,
            ai_model = EXCLUDED.ai_model,
            source_data_hash = EXCLUDED.source_data_hash,
            updated_at = NOW()
        RETURNING id;
        """
    )
    result = db.execute(
        stmt,
        {
            "repo_id": str(repo_id),
            "pr_id": str(pr_id),
            "summary": summary.get("summary"),
            "intent": summary.get("intent"),
            "decisions": json.dumps(summary.get("decisions") or []),
            "risks": json.dumps(summary.get("risks") or []),
            "tags": [str(tag).strip() for tag in (summary.get("tags") or []) if str(tag).strip()],
            "ai_model": settings.AI_MODEL,
            "source_data_hash": source_hash,
        },
    ).fetchone()
    return str(result[0])


def _upsert_file_mappings(
    db: Session,
    repo_id: str,
    knowledge_entry_id: str,
    pr_files: list[dict[str, Any]],
) -> None:
    stmt = text(
        """
        INSERT INTO file_mappings (
            id, repo_id, knowledge_entry_id, file_path, start_line, end_line, confidence
        )
        VALUES (
            gen_random_uuid(), :repo_id, :knowledge_entry_id, :file_path, :start_line, :end_line, :confidence
        )
        ON CONFLICT (knowledge_entry_id, file_path, start_line, end_line)
        DO NOTHING;
        """
    )
    for file_info in pr_files:
        start_line, end_line = _parse_patch_ranges(file_info.get("patch"))
        db.execute(
            stmt,
            {
                "repo_id": str(repo_id),
                "knowledge_entry_id": str(knowledge_entry_id),
                "file_path": file_info.get("filename"),
                "start_line": start_line,
                "end_line": end_line,
                "confidence": 0.6,
            },
        )


def sync_repository(
    db: Session,
    repo_full_name: str,
    github_token: str,
    github_account_id: str | None = None,
) -> dict[str, Any]:
    github = GitHubService(github_token)
    ai_service = AIService()

    repo = github.get_repository(repo_full_name)
    repo_id = _upsert_repository(db, repo, github_account_id)
    if github_account_id:
        grant_repository_access(db, repo_id, github_account_id)
    db.commit()

    prs = github.list_pull_requests(repo_full_name, state="all")
    results = {"repo_id": repo_id, "synced_prs": 0, "errors": []}

    for pr in prs:
        try:
            pr_number = pr.get("number")
            pr_detail = github.get_pull_request(repo_full_name, pr_number)
            commits = github.list_pull_request_commits(repo_full_name, pr_number)
            comments = github.list_pull_request_comments(repo_full_name, pr_number)
            reviews = github.list_pull_request_reviews(repo_full_name, pr_number)
            files = github.list_pull_request_files(repo_full_name, pr_number)

            payload = _build_pr_payload(pr_detail, commits, comments, reviews, files)
            source_hash = _hash_payload(payload)

            pr_id = _upsert_pr(db, repo_id, pr_detail)
            _upsert_commits(db, repo_id, pr_id, commits)
            existing = db.execute(
                text(
                    """
                    SELECT id, source_data_hash
                    FROM knowledge_entries
                    WHERE pr_id = :pr_id
                    """
                ),
                {"pr_id": pr_id},
            ).mappings().first()

            if existing and existing.get("source_data_hash") == source_hash:
                knowledge_entry_id = str(existing["id"])
            else:
                summary = ai_service.summarize_pr(payload)
                knowledge_entry_id = _upsert_knowledge_entry(db, repo_id, pr_id, summary, source_hash)

            _upsert_file_mappings(db, repo_id, knowledge_entry_id, files)

            db.commit()
            results["synced_prs"] += 1
        except HTTPException as exc:
            db.rollback()
            logger.warning("Failed to ingest PR %s: %s", pr.get("number"), exc.detail)
            results["errors"].append({"pr": pr.get("number"), "error": exc.detail})
        except Exception as exc:
            db.rollback()
            logger.exception("Unexpected ingestion error")
            results["errors"].append({"pr": pr.get("number"), "error": str(exc)})

    db.execute(
        text(
            """
            UPDATE repositories
            SET synced_at = NOW(), updated_at = NOW()
            WHERE id = :repo_id
            """
        ),
        {"repo_id": repo_id},
    )
    db.commit()

    audit_log(
        "repository.sync.completed",
        repo_id=repo_id,
        repo_full_name=repo_full_name,
        synced_prs=results["synced_prs"],
        error_count=len(results["errors"]),
        github_account_id=github_account_id,
    )

    return results
