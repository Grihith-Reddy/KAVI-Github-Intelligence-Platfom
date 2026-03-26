from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy.exc import ProgrammingError
from sqlalchemy.orm import Session

from app.core.access import assert_repo_access, require_github_account, require_user_id
from app.core.audit import audit_log
from app.core.database import get_db
from app.core.security import UserContext, decrypt_token, get_current_user
from app.services.ingestion_service import sync_repository
from app.services.sync_jobs import enqueue_sync_job, get_latest_sync_job_for_repo

router = APIRouter(prefix="/ingestion", tags=["ingestion"])


class SyncRequest(BaseModel):
    repo_full_name: str


@router.post("/repositories/sync")
def sync_repo(
    payload: SyncRequest,
    wait: bool = Query(False),
    current_user: UserContext = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    user_id = require_user_id(db, current_user.sub)
    gh_account = require_github_account(db, user_id)
    token = decrypt_token(gh_account["access_token_encrypted"])

    if wait:
        result = sync_repository(db, payload.repo_full_name, token, gh_account["id"])
        audit_log(
            "repository.sync.request.completed",
            user_id=user_id,
            github_account_id=gh_account["id"],
            repo_full_name=payload.repo_full_name,
            repo_id=result["repo_id"],
            synced_prs=result.get("synced_prs", 0),
        )
        return {"status": "completed", **result}

    try:
        job = enqueue_sync_job(
            db,
            user_id=user_id,
            github_account_id=gh_account["id"],
            repo_full_name=payload.repo_full_name,
        )
    except ProgrammingError as exc:
        db.rollback()
        if "sync_jobs" in str(exc).lower() and "does not exist" in str(exc).lower():
            # Legacy DB without sync_jobs migration: fallback to synchronous sync.
            result = sync_repository(db, payload.repo_full_name, token, gh_account["id"])
            audit_log(
                "repository.sync.request.completed.fallback",
                user_id=user_id,
                github_account_id=gh_account["id"],
                repo_full_name=payload.repo_full_name,
                repo_id=result["repo_id"],
                synced_prs=result.get("synced_prs", 0),
            )
            return {"status": "completed", "queue_unavailable": True, **result}
        raise

    audit_log(
        "repository.sync.request.queued",
        user_id=user_id,
        github_account_id=gh_account["id"],
        repo_full_name=payload.repo_full_name,
        job_id=job["id"],
    )
    return {
        "status": "queued",
        "repo_full_name": job["repo_full_name"],
        "job_id": job["id"],
    }


@router.get("/repositories/{repo_id}/status")
def repo_status(
    repo_id: str,
    current_user: UserContext = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    repo = assert_repo_access(db, repo_id, current_user.sub)
    job = get_latest_sync_job_for_repo(db, repo_id)
    audit_log("repository.status.checked", auth0_sub=current_user.sub, repo_id=repo_id)
    return {"repository": repo, "sync_job": job}
