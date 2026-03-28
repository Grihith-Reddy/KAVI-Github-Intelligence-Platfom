from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.access import assert_entry_access, assert_repo_access
from app.core.audit import audit_log
from app.core.database import get_db
from app.core.security import UserContext, get_current_user

router = APIRouter(prefix="/knowledge", tags=["knowledge"])


@router.get("/repositories/{repo_id}/entries")
def list_entries(
    repo_id: str,
    limit: int = Query(20, le=100),
    offset: int = Query(0, ge=0),
    current_user: UserContext = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    assert_repo_access(db, repo_id, current_user.sub)
    rows = db.execute(
        text(
            """
            SELECT k.id, k.summary, k.intent, k.tags, k.created_at,
                   pr.github_pr_number, pr.title AS pr_title, pr.state AS pr_state
            FROM knowledge_entries k
            LEFT JOIN pull_requests pr ON pr.id = k.pr_id
            WHERE k.repo_id = :repo_id
            ORDER BY k.created_at DESC
            LIMIT :limit OFFSET :offset
            """
        ),
        {"repo_id": repo_id, "limit": limit, "offset": offset},
    ).mappings().all()
    used_pr_fallback = False
    if not rows:
        rows = db.execute(
            text(
                """
                SELECT
                    pr.id,
                    COALESCE(
                        NULLIF(pr.body, ''),
                        CONCAT('PR #', pr.github_pr_number, ': ', COALESCE(pr.title, 'Untitled pull request'))
                    ) AS summary,
                    COALESCE(NULLIF(pr.body, ''), COALESCE(pr.title, 'Untitled pull request')) AS intent,
                    NULL AS tags,
                    COALESCE(pr.updated_at, pr.created_at) AS created_at,
                    pr.github_pr_number,
                    pr.title AS pr_title,
                    pr.state AS pr_state
                FROM pull_requests pr
                WHERE pr.repo_id = :repo_id
                ORDER BY COALESCE(pr.merged_at, pr.updated_at, pr.created_at) DESC
                LIMIT :limit OFFSET :offset
                """
            ),
            {"repo_id": repo_id, "limit": limit, "offset": offset},
        ).mappings().all()
        used_pr_fallback = bool(rows)
    audit_log("knowledge.entries.listed", auth0_sub=current_user.sub, repo_id=repo_id, count=len(rows))
    return {
        "entries": [dict(row) for row in rows],
        "fallback": "pull_requests" if used_pr_fallback else None,
    }


@router.get("/entries/{entry_id}")
def entry_detail(
    entry_id: str,
    current_user: UserContext = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    entry_access = assert_entry_access(db, entry_id, current_user.sub)
    entry = db.execute(
        text(
            """
            SELECT k.*, pr.github_pr_number, pr.title AS pr_title, pr.state AS pr_state,
                   pr.url AS pr_url, pr.base_branch, pr.head_branch
            FROM knowledge_entries k
            LEFT JOIN pull_requests pr ON pr.id = k.pr_id
            WHERE k.id = :entry_id
            """
        ),
        {"entry_id": entry_id},
    ).mappings().first()
    if not entry:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Knowledge entry not found")

    files = db.execute(
        text(
            """
            SELECT file_path, start_line, end_line, confidence
            FROM file_mappings
            WHERE knowledge_entry_id = :entry_id
            ORDER BY file_path
            """
        ),
        {"entry_id": entry_id},
    ).mappings().all()

    response = dict(entry)
    response["files"] = [dict(f) for f in files]
    audit_log(
        "knowledge.entry.detail",
        auth0_sub=current_user.sub,
        repo_id=entry_access["repo_id"],
        entry_id=entry_id,
    )
    return {"entry": response}


@router.get("/repositories/{repo_id}/timeline")
def timeline(
    repo_id: str,
    current_user: UserContext = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    assert_repo_access(db, repo_id, current_user.sub)
    rows = db.execute(
        text(
            """
            SELECT k.id, k.intent, k.summary, k.created_at,
                   pr.github_pr_number, pr.title AS pr_title, pr.merged_at
            FROM knowledge_entries k
            LEFT JOIN pull_requests pr ON pr.id = k.pr_id
            WHERE k.repo_id = :repo_id
            ORDER BY COALESCE(pr.merged_at, k.created_at) DESC
            """
        ),
        {"repo_id": repo_id},
    ).mappings().all()
    audit_log("knowledge.timeline.viewed", auth0_sub=current_user.sub, repo_id=repo_id, count=len(rows))
    return {"timeline": [dict(row) for row in rows]}


@router.get("/repositories/{repo_id}/evolution")
def evolution(
    repo_id: str,
    current_user: UserContext = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    repo = assert_repo_access(db, repo_id, current_user.sub)

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

    milestones = db.execute(
        text(
            """
            SELECT
                pr.id,
                pr.github_pr_number,
                pr.title AS pr_title,
                pr.author_login,
                pr.state AS pr_state,
                pr.merged_at,
                pr.created_at,
                k.intent,
                k.summary
            FROM pull_requests pr
            LEFT JOIN knowledge_entries k ON k.pr_id = pr.id
            WHERE pr.repo_id = :repo_id
            ORDER BY COALESCE(pr.merged_at, pr.updated_at, pr.created_at) DESC
            LIMIT 24
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
            LIMIT 12
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
            LIMIT 10
            """
        ),
        {"repo_id": repo_id},
    ).mappings().all()

    response = {
        "repository": {
            "id": repo.get("id"),
            "full_name": repo.get("full_name"),
            "default_branch": repo.get("default_branch"),
            "synced_at": repo.get("synced_at"),
        },
        "stats": {
            "total_prs": int(stats.get("total_prs") or 0),
            "merged_prs": int(stats.get("merged_prs") or 0),
            "contributors": int(stats.get("contributors") or 0),
            "first_pr_at": stats.get("first_pr_at"),
            "last_pr_at": stats.get("last_pr_at"),
        },
        "monthly_activity": [dict(row) for row in monthly_activity],
        "milestones": [dict(row) for row in milestones],
        "top_files": [dict(row) for row in top_files],
        "contributors": [dict(row) for row in contributors],
    }
    audit_log(
        "knowledge.evolution.viewed",
        auth0_sub=current_user.sub,
        repo_id=repo_id,
        milestones=len(response["milestones"]),
    )
    return response


@router.get("/repositories/{repo_id}/files")
def list_files(
    repo_id: str,
    limit: int = Query(100, le=500),
    current_user: UserContext = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    assert_repo_access(db, repo_id, current_user.sub)
    rows = db.execute(
        text(
            """
            SELECT file_path, COUNT(*) AS reference_count
            FROM file_mappings
            WHERE repo_id = :repo_id
            GROUP BY file_path
            ORDER BY reference_count DESC
            LIMIT :limit
            """
        ),
        {"repo_id": repo_id, "limit": limit},
    ).mappings().all()
    audit_log("knowledge.files.listed", auth0_sub=current_user.sub, repo_id=repo_id, count=len(rows))
    return {"files": [dict(row) for row in rows]}


@router.get("/files")
def file_detail(
    repo_id: str,
    path: str = Query(...),
    current_user: UserContext = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    assert_repo_access(db, repo_id, current_user.sub)
    rows = db.execute(
        text(
            """
            SELECT fm.file_path, fm.start_line, fm.end_line, fm.confidence,
                   k.id AS knowledge_entry_id, k.intent, k.summary,
                   pr.github_pr_number, pr.title AS pr_title, pr.url AS pr_url
            FROM file_mappings fm
            JOIN knowledge_entries k ON k.id = fm.knowledge_entry_id
            LEFT JOIN pull_requests pr ON pr.id = k.pr_id
            WHERE fm.repo_id = :repo_id AND fm.file_path = :path
            ORDER BY k.created_at DESC
            """
        ),
        {"repo_id": repo_id, "path": path},
    ).mappings().all()
    if not rows:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="File not found in knowledge base")

    audit_log("knowledge.file.detail", auth0_sub=current_user.sub, repo_id=repo_id, path=path)
    return {"file": path, "entries": [dict(row) for row in rows]}
