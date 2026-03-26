import json
import threading
import time
from dataclasses import dataclass
from typing import Any

import firebase_admin
from cryptography.fernet import Fernet, InvalidToken
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from firebase_admin import auth as firebase_auth
from firebase_admin import credentials as firebase_credentials
from firebase_admin.exceptions import FirebaseError
from jose import JWTError, jwt

from app.core.settings import settings


bearer_scheme = HTTPBearer(auto_error=False)

_FIREBASE_APP = None
_FIREBASE_APP_LOCK = threading.Lock()


@dataclass
class UserContext:
    sub: str
    email: str | None = None
    name: str | None = None


def _build_firebase_credential():
    raw_json = (settings.FIREBASE_CREDENTIALS_JSON or "").strip()
    if raw_json:
        try:
            payload = json.loads(raw_json)
        except json.JSONDecodeError as exc:
            raise RuntimeError("FIREBASE_CREDENTIALS_JSON must be valid JSON") from exc
        return firebase_credentials.Certificate(payload)

    credential_path = (settings.FIREBASE_CREDENTIALS_PATH or "").strip()
    if credential_path:
        return firebase_credentials.Certificate(credential_path)

    return firebase_credentials.ApplicationDefault()


def _get_firebase_app():
    global _FIREBASE_APP
    if _FIREBASE_APP is not None:
        return _FIREBASE_APP

    with _FIREBASE_APP_LOCK:
        if _FIREBASE_APP is not None:
            return _FIREBASE_APP

        try:
            _FIREBASE_APP = firebase_admin.get_app()
            return _FIREBASE_APP
        except ValueError:
            pass

        options: dict[str, str] = {}
        if settings.FIREBASE_PROJECT_ID:
            options["projectId"] = settings.FIREBASE_PROJECT_ID

        try:
            _FIREBASE_APP = firebase_admin.initialize_app(
                credential=_build_firebase_credential(),
                options=options or None,
            )
        except Exception as exc:
            raise RuntimeError("Unable to initialize Firebase Admin SDK") from exc

        return _FIREBASE_APP


def verify_jwt_token(token: str) -> dict[str, Any]:
    try:
        firebase_app = _get_firebase_app()
    except RuntimeError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Firebase authentication is not configured",
        ) from exc

    try:
        payload = firebase_auth.verify_id_token(token, app=firebase_app, check_revoked=False)
        return payload
    except firebase_auth.ExpiredIdTokenError as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token expired") from exc
    except (
        firebase_auth.InvalidIdTokenError,
        firebase_auth.RevokedIdTokenError,
        firebase_auth.UserDisabledError,
    ) as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token") from exc
    except (ValueError, FirebaseError) as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Unable to verify Firebase token",
        ) from exc


def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
) -> UserContext:
    if not credentials:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing bearer token")

    payload = verify_jwt_token(credentials.credentials)
    sub = payload.get("uid") or payload.get("sub")
    if not sub:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token payload")

    return UserContext(
        sub=sub,
        email=payload.get("email"),
        name=payload.get("name"),
    )


def _get_fernet() -> Fernet:
    try:
        return Fernet(settings.TOKEN_ENCRYPTION_KEY.encode())
    except Exception as exc:  # pragma: no cover - config error
        raise RuntimeError("TOKEN_ENCRYPTION_KEY must be a valid Fernet key") from exc


def encrypt_token(token: str) -> str:
    fernet = _get_fernet()
    return fernet.encrypt(token.encode()).decode()


def decrypt_token(token_encrypted: str) -> str:
    fernet = _get_fernet()
    try:
        return fernet.decrypt(token_encrypted.encode()).decode()
    except InvalidToken as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid GitHub token") from exc


def create_oauth_state(sub: str) -> str:
    now = int(time.time())
    payload = {
        "sub": sub,
        "iat": now,
        "exp": now + 600,
        "nonce": f"{now}-{sub}",
    }
    return jwt.encode(payload, settings.GITHUB_STATE_SECRET, algorithm="HS256")


def verify_oauth_state(state: str) -> str:
    try:
        payload = jwt.decode(state, settings.GITHUB_STATE_SECRET, algorithms=["HS256"])
        return payload.get("sub")
    except JWTError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid OAuth state") from exc
