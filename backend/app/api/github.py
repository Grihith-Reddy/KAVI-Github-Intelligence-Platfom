from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import RedirectResponse
from sqlalchemy import text
from sqlalchemy.orm import Session
from urllib.parse import urlencode

from app.core.access import require_github_account
from app.core.audit import audit_log
from app.core.database import get_db
from app.core.security import (
    UserContext,
    create_oauth_state,
    decrypt_token,
    encrypt_token,
    get_current_user,
    verify_oauth_state,
)
from app.core.settings import settings
from app.services.github_service import GitHubService, exchange_code_for_token, get_authenticated_user

router = APIRouter(prefix="/github", tags=["github"])


def _upsert_user_id(db: Session, current_user: UserContext) -> str:
    result = db.execute(
        text(
            """
            INSERT INTO users (id, auth0_sub, email, name)
            VALUES (gen_random_uuid(), :auth0_sub, :email, :name)
            ON CONFLICT (auth0_sub)
            DO UPDATE SET
                email = EXCLUDED.email,
                name = EXCLUDED.name,
                updated_at = NOW()
            RETURNING id
            """
        ),
        {
            "auth0_sub": current_user.sub,
            "email": current_user.email,
            "name": current_user.name,
        },
    ).fetchone()
    db.commit()
    return str(result[0])


def _get_user_id_by_sub(db: Session, auth0_sub: str) -> str:
    result = db.execute(
        text("SELECT id FROM users WHERE auth0_sub = :auth0_sub"),
        {"auth0_sub": auth0_sub},
    ).fetchone()
    if not result:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    return str(result[0])


@router.get("/connect-url")
def github_connect_url(
    current_user: UserContext = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    user_id = _upsert_user_id(db, current_user)
    state = create_oauth_state(current_user.sub)
    scopes = "read:user,repo,read:org"
    params = {
        "client_id": settings.GITHUB_CLIENT_ID,
        "redirect_uri": settings.GITHUB_OAUTH_REDIRECT_URI,
        "scope": scopes,
        "state": state,
        # Always surface account selection to avoid sticky browser sessions
        # reconnecting to the previously active GitHub identity.
        "prompt": "select_account",
    }
    url = f"https://github.com/login/oauth/authorize?{urlencode(params)}"
    audit_log("github.connect_url.created", user_id=user_id, auth0_sub=current_user.sub)
    return {"url": url, "state": state}


@router.get("/callback")
def github_callback(
    code: str = Query(...),
    state: str = Query(...),
    redirect: bool = Query(True),
    db: Session = Depends(get_db),
):
    auth0_sub = verify_oauth_state(state)
    user_id = _get_user_id_by_sub(db, auth0_sub)

    token_data = exchange_code_for_token(code)
    oauth_error = token_data.get("error")
    oauth_error_description = token_data.get("error_description")
    if oauth_error:
        audit_log(
            "github.callback.exchange_failed",
            user_id=user_id,
            auth0_sub=auth0_sub,
            error=oauth_error,
        )
        detail = f"GitHub OAuth exchange failed: {oauth_error}"
        if oauth_error_description:
            detail = f"{detail} ({oauth_error_description})"
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=detail)

    access_token = token_data.get("access_token")
    if not access_token:
        audit_log(
            "github.callback.exchange_missing_token",
            user_id=user_id,
            auth0_sub=auth0_sub,
        )
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="GitHub OAuth exchange did not return an access token. Check GitHub OAuth app credentials and callback URL.",
        )

    gh_user = get_authenticated_user(access_token)
    encrypted_token = encrypt_token(access_token)

    github_user_id = gh_user.get("id")
    if not github_user_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unable to read GitHub user id")

    # Keep one GitHub account per app user while allowing account re-link after auth migrations.
    db.execute(
        text(
            """
            DELETE FROM github_accounts
            WHERE user_id = :user_id
              AND github_user_id <> :github_user_id
            """
        ),
        {
            "user_id": user_id,
            "github_user_id": github_user_id,
        },
    )

    result = db.execute(
        text(
            """
            INSERT INTO github_accounts (
                id, user_id, github_user_id, username, access_token_encrypted, token_scopes
            )
            VALUES (
                gen_random_uuid(), :user_id, :github_user_id, :username, :access_token_encrypted, :token_scopes
            )
            ON CONFLICT (github_user_id)
            DO UPDATE SET
                user_id = EXCLUDED.user_id,
                github_user_id = EXCLUDED.github_user_id,
                username = EXCLUDED.username,
                access_token_encrypted = EXCLUDED.access_token_encrypted,
                token_scopes = EXCLUDED.token_scopes,
                updated_at = NOW()
            RETURNING id;
            """
        ),
        {
            "user_id": user_id,
            "github_user_id": github_user_id,
            "username": gh_user.get("login"),
            "access_token_encrypted": encrypted_token,
            "token_scopes": token_data.get("scope"),
        },
    ).fetchone()
    db.commit()

    audit_log(
        "github.connected",
        user_id=user_id,
        auth0_sub=auth0_sub,
        github_account_id=str(result[0]),
        github_username=gh_user.get("login"),
    )

    if redirect:
        return RedirectResponse(url=f"{settings.FRONTEND_URL.split(',')[0]}/repositories")

    return {"status": "connected", "github_account_id": str(result[0])}


@router.get("/status")
def github_status(
    current_user: UserContext = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    user_id = _upsert_user_id(db, current_user)
    account = db.execute(
        text(
            """
            SELECT id, username, updated_at
            FROM github_accounts
            WHERE user_id = :user_id
            """
        ),
        {"user_id": user_id},
    ).mappings().first()

    audit_log("github.status.checked", user_id=user_id, connected=bool(account))
    if not account:
        return {"connected": False, "account": None}

    return {"connected": True, "account": dict(account)}


@router.get("/repositories")
def list_repositories(
    current_user: UserContext = Depends(get_current_user),
    db: Session = Depends(get_db),
    page: int = 1,
    per_page: int = 50,
):
    user_id = _upsert_user_id(db, current_user)
    gh_account = require_github_account(db, user_id)
    token = decrypt_token(gh_account["access_token_encrypted"])

    github = GitHubService(token)
    repos = github.list_repositories(page=page, per_page=per_page)
    repo_ids = [repo["id"] for repo in repos]

    synced_map: dict[int, dict] = {}
    if repo_ids:
        synced = db.execute(
            text(
                """
                SELECT
                    r.id AS repo_uuid,
                    r.github_repo_id,
                    r.synced_at,
                    COALESCE(pr_counts.pr_count, 0) AS pr_count
                FROM repositories r
                JOIN repository_access ra ON ra.repository_id = r.id
                LEFT JOIN (
                    SELECT repo_id, COUNT(*) AS pr_count
                    FROM pull_requests
                    GROUP BY repo_id
                ) pr_counts ON pr_counts.repo_id = r.id
                WHERE ra.github_account_id = :github_account_id
                  AND r.github_repo_id = ANY(:repo_ids)
                """
            ),
            {"repo_ids": repo_ids, "github_account_id": gh_account["id"]},
        ).mappings().all()
        synced_map = {
            row["github_repo_id"]: {
                "repo_uuid": str(row["repo_uuid"]),
                "synced_at": row["synced_at"],
                "pr_count": int(row["pr_count"] or 0),
            }
            for row in synced
        }

    response = []
    for repo in repos:
        sync_meta = synced_map.get(repo["id"], {})
        response.append(
            {
                "id": repo["id"],
                "name": repo["name"],
                "full_name": repo["full_name"],
                "private": repo.get("private", False),
                "default_branch": repo.get("default_branch"),
                "synced_at": sync_meta.get("synced_at"),
                "pr_count": sync_meta.get("pr_count", 0),
                "repo_uuid": sync_meta.get("repo_uuid"),
            }
        )

    audit_log(
        "github.repositories.listed",
        user_id=user_id,
        github_account_id=gh_account["id"],
        repository_count=len(response),
    )
    return {"repositories": response}
