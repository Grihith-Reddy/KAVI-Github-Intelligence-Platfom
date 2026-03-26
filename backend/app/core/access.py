from fastapi import HTTPException, status
from sqlalchemy import text
from sqlalchemy.orm import Session


def require_user_id(db: Session, auth0_sub: str) -> str:
    result = db.execute(
        text("SELECT id FROM users WHERE auth0_sub = :auth0_sub"),
        {"auth0_sub": auth0_sub},
    ).fetchone()
    if not result:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    return str(result[0])


def require_github_account(db: Session, user_id: str) -> dict:
    result = db.execute(
        text(
            """
            SELECT id, username, access_token_encrypted, token_scopes, updated_at
            FROM github_accounts
            WHERE user_id = :user_id
            """
        ),
        {"user_id": user_id},
    ).mappings().first()
    if not result:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="GitHub account not connected")
    return dict(result)


def assert_repo_access(db: Session, repo_id: str, auth0_sub: str) -> dict:
    repo = db.execute(
        text(
            """
            SELECT DISTINCT
                r.id,
                r.github_repo_id,
                r.full_name,
                r.owner,
                r.name,
                r.is_private,
                r.default_branch,
                r.synced_at,
                r.created_at,
                r.updated_at
            FROM repositories r
            JOIN repository_access ra ON ra.repository_id = r.id
            JOIN github_accounts ga ON ga.id = ra.github_account_id
            JOIN users u ON u.id = ga.user_id
            WHERE r.id = :repo_id
              AND u.auth0_sub = :auth0_sub
            """
        ),
        {"repo_id": repo_id, "auth0_sub": auth0_sub},
    ).mappings().first()
    if not repo:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Repository not found")
    return dict(repo)


def assert_entry_access(db: Session, entry_id: str, auth0_sub: str) -> dict:
    entry = db.execute(
        text(
            """
            SELECT DISTINCT
                k.id,
                k.repo_id,
                r.full_name
            FROM knowledge_entries k
            JOIN repositories r ON r.id = k.repo_id
            JOIN repository_access ra ON ra.repository_id = r.id
            JOIN github_accounts ga ON ga.id = ra.github_account_id
            JOIN users u ON u.id = ga.user_id
            WHERE k.id = :entry_id
              AND u.auth0_sub = :auth0_sub
            """
        ),
        {"entry_id": entry_id, "auth0_sub": auth0_sub},
    ).mappings().first()
    if not entry:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Knowledge entry not found")
    return dict(entry)


def grant_repository_access(db: Session, repository_id: str, github_account_id: str, permission: str = "read") -> None:
    db.execute(
        text(
            """
            INSERT INTO repository_access (
                id, repository_id, github_account_id, permission
            )
            VALUES (
                gen_random_uuid(), :repository_id, :github_account_id, :permission
            )
            ON CONFLICT (repository_id, github_account_id)
            DO UPDATE SET
                permission = EXCLUDED.permission,
                updated_at = NOW()
            """
        ),
        {
            "repository_id": repository_id,
            "github_account_id": github_account_id,
            "permission": permission,
        },
    )
