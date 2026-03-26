import logging
import time

from sqlalchemy import text

from app.core.audit import audit_log
from app.core.database import SessionLocal
from app.core.security import decrypt_token
from app.core.settings import settings
from app.services.ingestion_service import sync_repository
from app.services.sync_jobs import (
    claim_next_sync_job,
    mark_sync_job_failed,
    mark_sync_job_succeeded,
    recycle_stale_jobs,
)


logger = logging.getLogger(__name__)


def _get_github_token(db, github_account_id: str) -> str:
    account = db.execute(
        text(
            """
            SELECT access_token_encrypted
            FROM github_accounts
            WHERE id = :github_account_id
            """
        ),
        {"github_account_id": github_account_id},
    ).mappings().first()
    if not account:
        raise RuntimeError("GitHub account not found for sync job")
    return decrypt_token(account["access_token_encrypted"])


def process_one_job() -> bool:
    db = SessionLocal()
    job = None
    try:
        recycle_stale_jobs(db)
        job = claim_next_sync_job(db)
        if not job:
            return False

        token = _get_github_token(db, job["github_account_id"])
        result = sync_repository(db, job["repo_full_name"], token, job["github_account_id"])
        mark_sync_job_succeeded(db, job_id=job["id"], repo_id=result["repo_id"], result_summary=result)
        audit_log(
            "sync.job.completed",
            job_id=job["id"],
            repo_full_name=job["repo_full_name"],
            repo_id=result["repo_id"],
            synced_prs=result.get("synced_prs", 0),
            error_count=len(result.get("errors", [])),
        )
        return True
    except Exception as exc:
        logger.exception("Sync worker job failed")
        if job:
            db.rollback()
            mark_sync_job_failed(db, job_id=job["id"], error_message=str(exc))
            audit_log(
                "sync.job.failed",
                job_id=job["id"],
                repo_full_name=job["repo_full_name"],
                error=str(exc),
            )
        return True
    finally:
        db.close()


def run_forever() -> None:
    while True:
        processed = process_one_job()
        if not processed:
            time.sleep(settings.SYNC_WORKER_POLL_SECONDS)


if __name__ == "__main__":
    logging.basicConfig(level=settings.LOG_LEVEL)
    run_forever()
