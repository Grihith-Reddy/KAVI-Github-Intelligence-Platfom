import logging
from collections import Counter
from typing import Any
import json
import re

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.access import assert_repo_access, require_github_account, require_user_id
from app.core.audit import audit_log
from app.core.database import get_db
from app.core.security import UserContext, decrypt_token, get_current_user
from app.services.ai_service import AIService
from app.services.github_service import GitHubService

router = APIRouter(prefix="/chat", tags=["chat"])
logger = logging.getLogger(__name__)

_QUERY_TOKEN_RE = re.compile(r"[a-zA-Z0-9][a-zA-Z0-9_./\\-]{1,}")
_QUERY_STOP_WORDS = {
    "a",
    "about",
    "an",
    "and",
    "are",
    "can",
    "code",
    "did",
    "do",
    "does",
    "explain",
    "file",
    "files",
    "for",
    "from",
    "function",
    "how",
    "i",
    "in",
    "is",
    "line",
    "lines",
    "me",
    "method",
    "module",
    "of",
    "or",
    "please",
    "project",
    "repo",
    "repository",
    "show",
    "tell",
    "that",
    "the",
    "this",
    "to",
    "was",
    "what",
    "where",
    "which",
    "who",
    "why",
    "with",
}
_TEXT_FILE_EXTENSIONS = {
    ".c",
    ".cc",
    ".cfg",
    ".conf",
    ".cpp",
    ".cs",
    ".css",
    ".csv",
    ".env",
    ".go",
    ".graphql",
    ".h",
    ".hpp",
    ".html",
    ".ini",
    ".java",
    ".js",
    ".json",
    ".jsx",
    ".kt",
    ".md",
    ".php",
    ".properties",
    ".py",
    ".rb",
    ".rs",
    ".scss",
    ".sh",
    ".sql",
    ".swift",
    ".toml",
    ".ts",
    ".tsx",
    ".txt",
    ".xml",
    ".yaml",
    ".yml",
}


class ChatQuery(BaseModel):
    repo_id: str
    query: str
    limit: int = Field(default=5, ge=1, le=15)
    mode: str | None = None


def _resolve_mode(query: str, mode: str | None) -> str:
    if mode and mode.strip().lower() in {"default", "repo_overview"}:
        return mode.strip().lower()

    normalized_query = query.strip().lower()
    overview_phrases = {
        "explain entire repo",
        "explain the entire repo",
        "repo overview",
        "project overview",
        "full repo overview",
        "explain repository",
    }
    if any(phrase in normalized_query for phrase in overview_phrases):
        return "repo_overview"
    if "entire repo" in normalized_query or "whole repo" in normalized_query:
        return "repo_overview"
    return "default"


def _extract_search_terms(query: str, limit: int = 10) -> list[str]:
    seen: set[str] = set()
    terms: list[str] = []
    lowered = str(query or "").lower()

    for raw_token in _QUERY_TOKEN_RE.findall(lowered):
        token = raw_token.strip("`'\"()[]{}<>,:;!?").replace("\\", "/").strip("/")
        if not token:
            continue

        token_parts = [token]
        token_parts.extend(part for part in re.split(r"[._/-]+", token) if part)
        if "/" in token:
            token_parts.append(token.split("/")[-1])
        if "." in token:
            token_parts.append(token.split(".")[0])

        for part in token_parts:
            normalized = str(part).strip().strip("-_")
            if len(normalized) < 3:
                continue
            if normalized in _QUERY_STOP_WORDS:
                continue
            if normalized in seen:
                continue
            seen.add(normalized)
            terms.append(normalized)
            if len(terms) >= limit:
                return terms

    return terms


def _has_file_path_signal(query: str) -> bool:
    text_value = str(query or "")
    if "/" in text_value or "\\" in text_value:
        return True
    return bool(re.search(r"\b[a-zA-Z0-9_.-]+\.[a-zA-Z0-9]{1,8}\b", text_value))


def _is_text_file_path(file_path: str) -> bool:
    normalized = str(file_path or "").strip().replace("\\", "/")
    if not normalized:
        return False

    filename = normalized.split("/")[-1].lower()
    if filename in {"dockerfile", "makefile", "jenkinsfile", "procfile"}:
        return True
    if "." not in filename:
        return False
    extension = "." + filename.split(".")[-1]
    return extension in _TEXT_FILE_EXTENSIONS


def _find_candidate_file_paths(
    db: Session,
    repo_id: str,
    query_terms: list[str],
    limit: int = 4,
) -> list[str]:
    if not query_terms:
        return []

    predicates: list[str] = []
    params: dict[str, Any] = {"repo_id": repo_id, "limit": max(12, limit * 4)}
    for idx, term in enumerate(query_terms[:10]):
        key = f"path_term_{idx}"
        predicates.append(f"LOWER(fm.file_path) LIKE :{key}")
        params[key] = f"%{term.lower()}%"

    if not predicates:
        return []

    rows = db.execute(
        text(
            f"""
            SELECT fm.file_path, COUNT(*) AS reference_count
            FROM file_mappings fm
            WHERE fm.repo_id = :repo_id
              AND ({' OR '.join(predicates)})
            GROUP BY fm.file_path
            ORDER BY reference_count DESC
            LIMIT :limit
            """
        ),
        params,
    ).mappings().all()

    scored: list[tuple[int, int, str]] = []
    lowered_terms = [term.lower() for term in query_terms]
    for row in rows:
        file_path = str(row.get("file_path") or "").strip()
        if not file_path or not _is_text_file_path(file_path):
            continue
        lowered_path = file_path.lower()
        base_name = lowered_path.split("/")[-1]
        score = 0
        for term in lowered_terms:
            if term == lowered_path or term == base_name:
                score += 16
            elif base_name.startswith(term) or base_name.endswith(term):
                score += 10
            elif term in base_name:
                score += 8
            elif term in lowered_path:
                score += 4
        score += min(int(row.get("reference_count") or 0), 12)
        scored.append((score, int(row.get("reference_count") or 0), file_path))

    ranked = sorted(scored, key=lambda item: (item[0], item[1]), reverse=True)
    return [path for _, _, path in ranked[:limit]]


def _merge_sources(
    primary: list[dict[str, Any]],
    secondary: list[dict[str, Any]],
    limit: int,
) -> list[dict[str, Any]]:
    merged: list[dict[str, Any]] = []
    seen: set[str] = set()

    for group in (primary, secondary):
        for source in group:
            files = source.get("files") if isinstance(source.get("files"), list) else []
            primary_path = ""
            if files and isinstance(files[0], dict):
                primary_path = str(files[0].get("file_path") or "").strip()
            key = str(source.get("entry_id") or "").strip() or f"path::{primary_path}"
            if not key or key in seen:
                continue
            seen.add(key)
            merged.append(source)
            if len(merged) >= limit:
                return merged

    return merged


def _build_lexical_term_fragments(terms: list[str]) -> tuple[str, str, dict[str, str]]:
    if not terms:
        return "FALSE", "0", {}

    predicates: list[str] = []
    rank_signals: list[str] = []
    params: dict[str, str] = {}

    for idx, term in enumerate(terms):
        key = f"term_{idx}"
        params[key] = f"%{term}%"
        predicates.extend(
            [
                f"k.summary ILIKE :{key}",
                f"k.intent ILIKE :{key}",
                f"coalesce(pr.title, '') ILIKE :{key}",
                f"coalesce(pr.body, '') ILIKE :{key}",
                f"coalesce(fm.file_path, '') ILIKE :{key}",
            ]
        )
        rank_signals.append(f"CASE WHEN coalesce(fm.file_path, '') ILIKE :{key} THEN 4 ELSE 0 END")
        rank_signals.append(
            "CASE WHEN ("
            f"k.summary ILIKE :{key} OR "
            f"k.intent ILIKE :{key} OR "
            f"coalesce(pr.title, '') ILIKE :{key} OR "
            f"coalesce(pr.body, '') ILIKE :{key}"
            ") THEN 1 ELSE 0 END"
        )

    return " OR ".join(predicates), " + ".join(rank_signals), params


def _merge_entry_rows(
    primary: list[dict[str, Any]],
    secondary: list[dict[str, Any]],
    limit: int,
) -> list[dict[str, Any]]:
    merged: list[dict[str, Any]] = []
    seen: set[str] = set()

    for group in (primary, secondary):
        for row in group:
            row_id = row.get("id")
            if row_id is None:
                continue
            key = str(row_id)
            if key in seen:
                continue
            seen.add(key)
            merged.append(dict(row))
            if len(merged) >= limit:
                return merged

    return merged


def _fetch_full_text_entries(db: Session, payload: ChatQuery, limit: int) -> list[dict[str, Any]]:
    entries: list[dict[str, Any]] = []
    try:
        entries = db.execute(
            text(
                """
                SELECT
                    k.id,
                    k.summary,
                    k.intent,
                    k.tags,
                    pr.github_pr_number,
                    pr.title AS pr_title,
                    pr.url AS pr_url,
                    MAX(ts_rank(
                        k.search_document,
                        websearch_to_tsquery('english', :query)
                    )) AS rank,
                    MAX(COALESCE(pr.updated_at, k.updated_at)) AS sort_ts
                FROM knowledge_entries k
                LEFT JOIN pull_requests pr ON pr.id = k.pr_id
                LEFT JOIN file_mappings fm ON fm.knowledge_entry_id = k.id
                WHERE k.repo_id = :repo_id
                  AND (
                    k.search_document @@ websearch_to_tsquery('english', :query)
                    OR to_tsvector(
                        'english',
                        coalesce(pr.title, '') || ' ' || coalesce(pr.body, '')
                    ) @@ websearch_to_tsquery('english', :query)
                    OR coalesce(fm.file_path, '') ILIKE :query_file_hint
                  )
                GROUP BY
                    k.id,
                    k.summary,
                    k.intent,
                    k.tags,
                    pr.github_pr_number,
                    pr.title,
                    pr.url
                ORDER BY rank DESC, sort_ts DESC
                LIMIT :limit
                """
            ),
            {
                "repo_id": payload.repo_id,
                "query": payload.query.strip(),
                "query_file_hint": f"%{payload.query.strip()}%",
                "limit": limit,
            },
        ).mappings().all()
    except Exception:
        db.rollback()
        logger.exception("Full-text retrieval failed; falling back to lexical retrieval")

    return [dict(row) for row in entries]


def _fetch_lexical_entries(
    db: Session,
    payload: ChatQuery,
    query_terms: list[str],
    limit: int,
) -> list[dict[str, Any]]:
    term_predicates, rank_formula, term_params = _build_lexical_term_fragments(query_terms)
    ilike_query = f"%{payload.query.strip()}%"
    entries: list[dict[str, Any]] = []

    try:
        entries = db.execute(
            text(
                f"""
                SELECT
                    k.id,
                    k.summary,
                    k.intent,
                    k.tags,
                    pr.github_pr_number,
                    pr.title AS pr_title,
                    pr.url AS pr_url,
                    MAX({rank_formula}) AS rank,
                    MAX(COALESCE(pr.updated_at, k.updated_at)) AS sort_ts
                FROM knowledge_entries k
                LEFT JOIN pull_requests pr ON pr.id = k.pr_id
                LEFT JOIN file_mappings fm ON fm.knowledge_entry_id = k.id
                WHERE k.repo_id = :repo_id
                  AND (
                    k.summary ILIKE :ilike_query
                    OR k.intent ILIKE :ilike_query
                    OR coalesce(pr.title, '') ILIKE :ilike_query
                    OR coalesce(pr.body, '') ILIKE :ilike_query
                    OR coalesce(fm.file_path, '') ILIKE :ilike_query
                    OR ({term_predicates})
                  )
                GROUP BY
                    k.id,
                    k.summary,
                    k.intent,
                    k.tags,
                    pr.github_pr_number,
                    pr.title,
                    pr.url
                ORDER BY rank DESC, sort_ts DESC
                LIMIT :limit
                """
            ),
            {"repo_id": payload.repo_id, "ilike_query": ilike_query, "limit": limit, **term_params},
        ).mappings().all()
    except Exception:
        db.rollback()
        logger.exception("Lexical retrieval failed; falling back to recency retrieval")

    return [dict(row) for row in entries]


def _fetch_recency_entries(db: Session, payload: ChatQuery, limit: int) -> list[dict[str, Any]]:
    try:
        rows = db.execute(
            text(
                """
                SELECT
                    k.id,
                    k.summary,
                    k.intent,
                    k.tags,
                    pr.github_pr_number,
                    pr.title AS pr_title,
                    pr.url AS pr_url,
                    0 AS rank
                FROM knowledge_entries k
                LEFT JOIN pull_requests pr ON pr.id = k.pr_id
                WHERE k.repo_id = :repo_id
                ORDER BY COALESCE(pr.merged_at, pr.created_at, k.created_at) DESC
                LIMIT :limit
                """
            ),
            {"repo_id": payload.repo_id, "limit": limit},
        ).mappings().all()
        return [dict(row) for row in rows]
    except Exception:
        db.rollback()
        logger.exception("Recency retrieval failed")
        return []


def _fetch_candidate_entries(db: Session, payload: ChatQuery) -> list[dict]:
    target_limit = max(payload.limit, 8)
    query_terms = _extract_search_terms(payload.query, limit=10)
    prefer_lexical_first = _has_file_path_signal(payload.query)

    fulltext_entries = _fetch_full_text_entries(db, payload, limit=target_limit * 2)
    lexical_entries = _fetch_lexical_entries(db, payload, query_terms, limit=target_limit * 2)

    primary = lexical_entries if prefer_lexical_first else fulltext_entries
    secondary = fulltext_entries if prefer_lexical_first else lexical_entries
    merged = _merge_entry_rows(primary, secondary, limit=target_limit)
    if len(merged) >= target_limit:
        return merged

    recency_entries = _fetch_recency_entries(db, payload, limit=target_limit)
    return _merge_entry_rows(merged, recency_entries, limit=target_limit)


def _fetch_repo_overview_entries(db: Session, repo_id: str, limit: int = 20) -> list[dict]:
    try:
        return db.execute(
            text(
                """
                SELECT
                    k.id,
                    k.summary,
                    k.intent,
                    k.tags,
                    pr.github_pr_number,
                    pr.title AS pr_title,
                    pr.url AS pr_url,
                    0 AS rank
                FROM knowledge_entries k
                LEFT JOIN pull_requests pr ON pr.id = k.pr_id
                WHERE k.repo_id = :repo_id
                ORDER BY COALESCE(pr.merged_at, pr.updated_at, k.updated_at) DESC
                LIMIT :limit
                """
            ),
            {"repo_id": repo_id, "limit": max(limit, 12)},
        ).mappings().all()
    except Exception:
        logger.exception("Repo overview retrieval failed")
        return []


def _build_sources_from_pr_metadata(
    db: Session,
    repo_id: str,
    query: str,
    limit: int,
) -> list[dict[str, Any]]:
    query_text = str(query or "").strip()
    ilike_query = f"%{query_text}%"
    try:
        rows = db.execute(
            text(
                """
                SELECT
                    id,
                    github_pr_number,
                    title,
                    body,
                    url,
                    author_login,
                    state,
                    created_at,
                    updated_at,
                    merged_at,
                    CASE
                        WHEN :query_text <> ''
                             AND (
                                 COALESCE(title, '') ILIKE :ilike_query
                                 OR COALESCE(body, '') ILIKE :ilike_query
                             )
                        THEN 1
                        ELSE 0
                    END AS match_score
                FROM pull_requests
                WHERE repo_id = :repo_id
                ORDER BY match_score DESC, COALESCE(merged_at, updated_at, created_at) DESC
                LIMIT :limit
                """
            ),
            {
                "repo_id": repo_id,
                "query_text": query_text,
                "ilike_query": ilike_query,
                "limit": max(limit, 8),
            },
        ).mappings().all()
    except Exception:
        logger.exception("PR metadata fallback retrieval failed")
        return []

    fallback_sources: list[dict[str, Any]] = []
    for row in rows:
        commit_rows = db.execute(
            text(
                """
                SELECT message
                FROM commits
                WHERE pr_id = :pr_id
                ORDER BY committed_at DESC NULLS LAST
                LIMIT 3
                """
            ),
            {"pr_id": row.get("id")},
        ).mappings().all()
        commit_messages = [
            str(item.get("message") or "").strip()
            for item in commit_rows
            if str(item.get("message") or "").strip()
        ]

        title = str(row.get("title") or "Untitled pull request").strip()
        body = str(row.get("body") or "").strip()
        pr_number = row.get("github_pr_number")
        summary = body[:700] if body else ""
        if not summary and commit_messages:
            summary = "Commit highlights: " + " | ".join(commit_messages[:2])[:680]
        if not summary:
            summary = f"PR #{pr_number or '?'} ({title}) is available with limited discussion text."

        intent = body[:420] if body else ""
        if not intent and commit_messages:
            intent = f"Intent inferred from commits: {commit_messages[0][:360]}"
        if not intent:
            intent = f"PR #{pr_number or '?'} focuses on {title.lower()}."

        fallback_sources.append(
            {
                "entry_id": f"pr-metadata-{pr_number or row.get('id')}",
                "pr_number": pr_number,
                "pr_title": title,
                "pr_url": row.get("url"),
                "summary": summary,
                "intent": intent,
                "files": [],
                "rank": float(row.get("match_score") or 0),
            }
        )

    return fallback_sources


def _build_live_file_sources(
    db: Session,
    repo_id: str,
    query: str,
    current_user: UserContext,
    repo_meta: dict[str, Any],
    max_files: int = 2,
) -> list[dict[str, Any]]:
    query_terms = _extract_search_terms(query, limit=10)
    if not _has_file_path_signal(query):
        return []
    if not query_terms:
        return []

    candidate_paths = _find_candidate_file_paths(db, repo_id, query_terms, limit=max_files * 2)
    if not candidate_paths:
        return []

    try:
        user_id = require_user_id(db, current_user.sub)
        gh_account = require_github_account(db, user_id)
        token = decrypt_token(gh_account["access_token_encrypted"])
        github = GitHubService(token)
    except Exception:
        logger.warning("Unable to initialize GitHub client for live file context", exc_info=True)
        return []

    repo_full_name = str(repo_meta.get("full_name") or "").strip()
    default_branch = str(repo_meta.get("default_branch") or "main").strip() or "main"
    if not repo_full_name:
        return []

    live_sources: list[dict[str, Any]] = []
    for file_path in candidate_paths:
        try:
            content = github.get_file_content(repo_full_name, file_path, ref=default_branch, max_chars=14000)
        except Exception:
            logger.warning("Unable to fetch live file content for %s", file_path, exc_info=True)
            continue

        normalized_content = str(content or "").strip()
        if not normalized_content:
            continue

        # Keep the excerpt bounded; AI service will compact again before prompt assembly.
        excerpt = normalized_content[:4200]
        excerpt_lines = excerpt.count("\n") + 1
        live_sources.append(
            {
                "entry_id": f"live-file::{file_path}",
                "pr_number": None,
                "pr_title": f"Live file snapshot: {file_path}",
                "pr_url": None,
                "summary": f"Current code excerpt from {file_path}:\n{excerpt}",
                "intent": (
                    f"Live code snapshot from {file_path} on branch {default_branch}. "
                    "Prefer this for code-level answers about this file."
                ),
                "file_excerpt": excerpt,
                "files": [
                    {
                        "knowledge_entry_id": None,
                        "file_path": file_path,
                        "start_line": 1,
                        "end_line": excerpt_lines,
                        "confidence": 1.0,
                    }
                ],
                "rank": 1000.0 - float(len(live_sources)),
            }
        )
        if len(live_sources) >= max_files:
            break

    return live_sources


def _infer_technologies(file_paths: list[str]) -> list[dict[str, Any]]:
    extension_map = {
        ".py": "Python",
        ".ts": "TypeScript",
        ".tsx": "TypeScript React",
        ".js": "JavaScript",
        ".jsx": "JavaScript React",
        ".java": "Java",
        ".kt": "Kotlin",
        ".go": "Go",
        ".rs": "Rust",
        ".cs": "C#",
        ".sql": "SQL",
        ".yml": "YAML",
        ".yaml": "YAML",
        ".json": "JSON",
        ".md": "Markdown",
        ".css": "CSS",
        ".scss": "SCSS",
        ".html": "HTML",
        ".sh": "Shell",
        ".dockerfile": "Docker",
    }
    counts: Counter[str] = Counter()
    for path in file_paths:
        lowered = path.lower()
        extension = ""
        if "." in lowered:
            extension = "." + lowered.split(".")[-1]
        if lowered.endswith("dockerfile"):
            extension = ".dockerfile"
        tech = extension_map.get(extension)
        if tech:
            counts[tech] += 1

    return [{"technology": tech, "file_count": count} for tech, count in counts.most_common(12)]


def _top_directories(file_paths: list[str]) -> list[dict[str, Any]]:
    counts: Counter[str] = Counter()
    for path in file_paths:
        normalized = path.replace("\\", "/").strip("/")
        if not normalized:
            continue
        root = normalized.split("/")[0]
        counts[root] += 1
    return [{"directory": directory, "file_count": count} for directory, count in counts.most_common(12)]


def _extract_tags(raw_tags: Any) -> list[str]:
    if raw_tags is None:
        return []

    if isinstance(raw_tags, (list, tuple, set)):
        return [str(item).strip() for item in raw_tags if str(item).strip()]

    if isinstance(raw_tags, dict):
        if "tags" in raw_tags:
            return _extract_tags(raw_tags.get("tags"))
        values: list[str] = []
        for value in raw_tags.values():
            values.extend(_extract_tags(value))
        return values

    if isinstance(raw_tags, str):
        text_value = raw_tags.strip()
        if not text_value:
            return []

        # JSON encoded array/object from legacy rows.
        if text_value.startswith("[") or text_value.startswith("{"):
            try:
                parsed = json.loads(text_value)
                return _extract_tags(parsed)
            except Exception:
                pass

        # PostgreSQL text[] literal format: {"tag-a","tag-b"}
        if text_value.startswith("{") and text_value.endswith("}"):
            inner = text_value[1:-1].strip()
            if not inner:
                return []
            return [segment.strip().strip('"') for segment in inner.split(",") if segment.strip()]

        return [text_value]

    text_value = str(raw_tags).strip()
    return [text_value] if text_value else []


def _contains_no_file_claim(text_value: str | None) -> bool:
    lowered = str(text_value or "").lower()
    phrases = (
        "no files were changed",
        "no files changed",
        "no file changes",
        "no file changes were listed",
        "no code changes",
    )
    return any(phrase in lowered for phrase in phrases)


def _code_intent_from_files(pr_title: str | None, pr_number: Any, files: list[dict[str, Any]]) -> str:
    paths = [
        str(item.get("file_path") or "").strip()
        for item in files
        if isinstance(item, dict) and str(item.get("file_path") or "").strip()
    ]
    if not paths:
        return ""
    return (
        f"PR #{pr_number or '?'} ({str(pr_title or 'Untitled PR').strip()}) touches {len(paths)} indexed files. "
        f"Representative files: {', '.join(paths[:3])}."
    )


def _build_repo_overview_context(
    db: Session,
    repo_id: str,
    current_user: UserContext,
    repo_meta: dict[str, Any],
    include_live_inventory: bool = True,
) -> dict[str, Any]:
    stats = db.execute(
        text(
            """
            SELECT
                COUNT(*) AS total_prs,
                COUNT(*) FILTER (WHERE merged_at IS NOT NULL) AS merged_prs,
                COUNT(DISTINCT author_login) FILTER (WHERE author_login IS NOT NULL) AS contributors,
                MIN(created_at) AS first_pr_at,
                MAX(COALESCE(merged_at, updated_at, created_at)) AS last_pr_at
            FROM pull_requests
            WHERE repo_id = :repo_id
            """
        ),
        {"repo_id": repo_id},
    ).mappings().first() or {}

    recent_prs = db.execute(
        text(
            """
            SELECT github_pr_number, title, state, author_login, merged_at, created_at, updated_at
            FROM pull_requests
            WHERE repo_id = :repo_id
            ORDER BY COALESCE(merged_at, updated_at, created_at) DESC
            LIMIT 12
            """
        ),
        {"repo_id": repo_id},
    ).mappings().all()

    top_files = db.execute(
        text(
            """
            SELECT file_path, COUNT(*) AS change_count
            FROM file_mappings
            WHERE repo_id = :repo_id
            GROUP BY file_path
            ORDER BY change_count DESC
            LIMIT 120
            """
        ),
        {"repo_id": repo_id},
    ).mappings().all()

    tag_rows = db.execute(
        text(
            """
            SELECT tags
            FROM knowledge_entries
            WHERE repo_id = :repo_id
              AND tags IS NOT NULL
            ORDER BY updated_at DESC
            LIMIT 1200
            """
        ),
        {"repo_id": repo_id},
    ).mappings().all()
    tag_counts: Counter[str] = Counter()
    for row in tag_rows:
        for tag in _extract_tags(row.get("tags")):
            normalized_tag = " ".join(str(tag).split()).strip()
            if normalized_tag:
                tag_counts[normalized_tag] += 1
    top_tags = [
        {"tag": tag, "tag_count": count}
        for tag, count in tag_counts.most_common(20)
    ]

    monthly_activity = db.execute(
        text(
            """
            SELECT
                TO_CHAR(DATE_TRUNC('month', COALESCE(merged_at, created_at)), 'YYYY-MM') AS month,
                COUNT(*) AS pr_count,
                COUNT(*) FILTER (WHERE merged_at IS NOT NULL) AS merged_count
            FROM pull_requests
            WHERE repo_id = :repo_id
            GROUP BY month
            ORDER BY month
            """
        ),
        {"repo_id": repo_id},
    ).mappings().all()

    contributors = db.execute(
        text(
            """
            SELECT author_login, COUNT(*) AS pr_count
            FROM pull_requests
            WHERE repo_id = :repo_id AND author_login IS NOT NULL
            GROUP BY author_login
            ORDER BY pr_count DESC
            LIMIT 12
            """
        ),
        {"repo_id": repo_id},
    ).mappings().all()

    file_paths = [str(row.get("file_path") or "") for row in top_files if row.get("file_path")]
    technologies = _infer_technologies(file_paths)

    context: dict[str, Any] = {
        "repository": {
            "id": repo_meta.get("id"),
            "full_name": repo_meta.get("full_name"),
            "default_branch": repo_meta.get("default_branch"),
            "is_private": repo_meta.get("is_private"),
            "synced_at": repo_meta.get("synced_at"),
        },
        "stats": {
            "total_prs": int(stats.get("total_prs") or 0),
            "merged_prs": int(stats.get("merged_prs") or 0),
            "contributors": int(stats.get("contributors") or 0),
            "first_pr_at": stats.get("first_pr_at"),
            "last_pr_at": stats.get("last_pr_at"),
        },
        "recent_prs": [dict(row) for row in recent_prs],
        "top_files": [dict(row) for row in top_files[:80]],
        "top_directories": _top_directories(file_paths),
        "top_tags": top_tags,
        "monthly_activity": [dict(row) for row in monthly_activity],
        "contributors": [dict(row) for row in contributors],
        "technologies": technologies,
    }

    if include_live_inventory:
        try:
            user_id = require_user_id(db, current_user.sub)
            gh_account = require_github_account(db, user_id)
            token = decrypt_token(gh_account["access_token_encrypted"])
            github = GitHubService(token)
            inventory = github.list_repository_tree(
                str(repo_meta.get("full_name")),
                branch=str(repo_meta.get("default_branch") or "main"),
                max_entries=2500,
            )
            inventory_paths = [str(item.get("path") or "") for item in inventory if item.get("path")]
            context["live_inventory"] = {
                "file_count": len(inventory_paths),
                "sample_files": inventory_paths[:300],
                "top_directories": _top_directories(inventory_paths),
                "technologies": _infer_technologies(inventory_paths),
            }
        except Exception:
            logger.warning("Unable to fetch live GitHub tree for repo overview", exc_info=True)
            context["live_inventory"] = None
    else:
        context["live_inventory"] = None

    return context


@router.post("/query")
def chat_query(
    payload: ChatQuery,
    current_user: UserContext = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    query_text = payload.query.strip()
    if not query_text:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Query cannot be empty")

    mode = _resolve_mode(query_text, payload.mode)
    repo_meta = assert_repo_access(db, payload.repo_id, current_user.sub)

    entries = (
        _fetch_repo_overview_entries(db, payload.repo_id, limit=max(payload.limit, 18))
        if mode == "repo_overview"
        else _fetch_candidate_entries(db, payload)
    )

    repo_overview_context = None
    metadata_sources: list[dict[str, Any]] = []
    if mode == "repo_overview":
        repo_overview_context = _build_repo_overview_context(db, payload.repo_id, current_user, repo_meta)
    elif not entries:
        # If knowledge enrichment rows are absent, still provide repository metadata
        # so chat can answer from PR-level context instead of returning empty.
        repo_overview_context = _build_repo_overview_context(
            db,
            payload.repo_id,
            current_user,
            repo_meta,
            include_live_inventory=False,
        )
        metadata_sources = _build_sources_from_pr_metadata(db, payload.repo_id, query_text, payload.limit)

    entry_ids = [row["id"] for row in entries]
    files = []
    if entry_ids:
        files = db.execute(
            text(
                """
                SELECT knowledge_entry_id, file_path, start_line, end_line, confidence
                FROM (
                    SELECT
                        knowledge_entry_id,
                        file_path,
                        start_line,
                        end_line,
                        confidence,
                        ROW_NUMBER() OVER (
                            PARTITION BY knowledge_entry_id
                            ORDER BY confidence DESC, file_path ASC
                        ) AS row_no
                    FROM file_mappings
                    WHERE knowledge_entry_id = ANY(:entry_ids)
                ) ranked
                WHERE row_no <= 8
                ORDER BY knowledge_entry_id, row_no
                """
            ),
            {"entry_ids": entry_ids},
        ).mappings().all()

    files_by_entry: dict[str, list[dict]] = {}
    for file_mapping in files:
        key = str(file_mapping["knowledge_entry_id"])
        files_by_entry.setdefault(key, []).append(
            {k: str(v) if hasattr(v, "hex") else v for k, v in dict(file_mapping).items()}
        )

    sources = []
    for entry in entries:
        entry_id = str(entry["id"])
        entry_files = files_by_entry.get(entry_id, [])
        summary_text = str(entry["summary"] or "")
        intent_text = str(entry["intent"] or "")
        derived_code_intent = _code_intent_from_files(entry.get("pr_title"), entry.get("github_pr_number"), entry_files)
        if derived_code_intent:
            if _contains_no_file_claim(summary_text):
                summary_text = derived_code_intent
            if _contains_no_file_claim(intent_text) or not intent_text.strip():
                intent_text = derived_code_intent

        sources.append(
            {
                "entry_id": entry_id,
                "pr_number": entry["github_pr_number"],
                "pr_title": entry["pr_title"],
                "pr_url": entry["pr_url"],
                "summary": summary_text,
                "intent": intent_text,
                "files": entry_files,
                "rank": float(entry["rank"] or 0),
            }
        )

    if not sources and metadata_sources:
        sources = metadata_sources

    live_file_sources = _build_live_file_sources(
        db,
        payload.repo_id,
        query_text,
        current_user,
        repo_meta,
        max_files=2,
    )
    if live_file_sources:
        sources = _merge_sources(
            live_file_sources,
            sources,
            limit=max(12, max(payload.limit, 8) + len(live_file_sources)),
        )

    if not sources and not repo_overview_context:
        audit_log("chat.query.empty_context", auth0_sub=current_user.sub, repo_id=payload.repo_id, mode=mode)

    ai_service = AIService()
    ai_payload = ai_service.generate_chat_payload(query_text, sources, repo_overview_context)
    answer = str(ai_payload.get("answer") or "")
    answer_structured = ai_payload.get("structured")

    audit_log(
        "chat.query.completed",
        auth0_sub=current_user.sub,
        repo_id=payload.repo_id,
        source_count=len(sources),
        mode=mode,
    )
    return {
        "answer": answer,
        "answer_structured": answer_structured,
        "sources": sources,
        "context": sources,
        "mode": mode,
    }
