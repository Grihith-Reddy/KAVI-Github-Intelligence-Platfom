import os
from typing import Iterable

from cryptography.fernet import Fernet
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_ignore_empty=True, extra="ignore")

    ENV: str = "development"
    API_V1_PREFIX: str = "/api"

    FRONTEND_URL: str = "http://localhost:5173"
    DATABASE_URL: str = "postgresql+psycopg2://kavi:kavi@localhost:5432/kavi"

    FIREBASE_PROJECT_ID: str = ""
    FIREBASE_CREDENTIALS_PATH: str | None = None
    FIREBASE_CREDENTIALS_JSON: str | None = None

    GITHUB_CLIENT_ID: str = ""
    GITHUB_CLIENT_SECRET: str = ""
    GITHUB_OAUTH_REDIRECT_URI: str = "http://localhost:8000/api/github/callback"
    GITHUB_STATE_SECRET: str = "change-me"

    TOKEN_ENCRYPTION_KEY: str = "change-me"  # Must be a Fernet key

    AI_PROVIDER: str = "gemini"
    AI_MODEL: str = "gemini-1.5-flash"
    AI_API_KEY: str | None = None

    GITHUB_API_BASE: str = "https://api.github.com"
    GITHUB_OAUTH_BASE: str = "https://github.com/login/oauth"

    REQUEST_TIMEOUT_SECONDS: int = 30
    RATE_LIMIT_SLEEP_SECONDS: int = 5
    RATE_LIMIT_REQUESTS_PER_MINUTE: int = 120
    MAX_REQUEST_BODY_BYTES: int = 262144
    DB_POOL_SIZE: int = 10
    DB_MAX_OVERFLOW: int = 20
    DB_POOL_TIMEOUT_SECONDS: int = 30
    DB_POOL_RECYCLE_SECONDS: int = 1800
    OUTBOUND_RETRY_ATTEMPTS: int = 3
    OUTBOUND_CIRCUIT_BREAKER_THRESHOLD: int = 5
    OUTBOUND_CIRCUIT_BREAKER_SECONDS: int = 90
    SYNC_WORKER_POLL_SECONDS: int = 5
    SYNC_JOB_MAX_ATTEMPTS: int = 4
    SYNC_JOB_RETRY_DELAY_SECONDS: int = 30
    SYNC_JOB_STALE_AFTER_SECONDS: int = 900
    LOG_LEVEL: str = "INFO"

    @property
    def is_production(self) -> bool:
        return self.ENV.lower() == "production"

    def allowed_origins(self) -> list[str]:
        configured = [part.strip() for part in self.FRONTEND_URL.split(",") if part.strip()]
        if self.is_production:
            return configured

        defaults = [
            "http://localhost:5173",
            "http://127.0.0.1:5173",
            "http://localhost:4173",
            "http://127.0.0.1:4173",
        ]
        return sorted(set(configured + defaults))

    def validate_runtime(self) -> None:
        self._validate_secret("GITHUB_STATE_SECRET", self.GITHUB_STATE_SECRET)
        self._validate_secret("TOKEN_ENCRYPTION_KEY", self.TOKEN_ENCRYPTION_KEY)
        self._validate_fernet_key()

        if self.is_production:
            self._validate_non_empty(
                (
                    "FIREBASE_PROJECT_ID",
                    "GITHUB_CLIENT_ID",
                    "GITHUB_CLIENT_SECRET",
                    "GITHUB_OAUTH_REDIRECT_URI",
                    "GITHUB_STATE_SECRET",
                    "TOKEN_ENCRYPTION_KEY",
                )
            )
            self._validate_firebase_credentials_source()
            origins = self.allowed_origins()
            if not origins:
                raise RuntimeError("FRONTEND_URL must be set to at least one production origin")
            if any("localhost" in origin or "127.0.0.1" in origin for origin in origins):
                raise RuntimeError("Production FRONTEND_URL must not include localhost origins")

    def _validate_secret(self, name: str, value: str) -> None:
        if value.strip().lower() in {"", "change-me", "changeme", "replace-me"}:
            raise RuntimeError(f"{name} must be rotated before startup")

    def _validate_non_empty(self, names: Iterable[str]) -> None:
        for name in names:
            value = getattr(self, name, "")
            if not str(value).strip():
                raise RuntimeError(f"{name} must be configured before startup")

    def _validate_fernet_key(self) -> None:
        try:
            Fernet(self.TOKEN_ENCRYPTION_KEY.encode())
        except Exception as exc:  # pragma: no cover
            raise RuntimeError("TOKEN_ENCRYPTION_KEY must be a valid Fernet key") from exc

    def _validate_firebase_credentials_source(self) -> None:
        has_path = bool((self.FIREBASE_CREDENTIALS_PATH or "").strip())
        has_json = bool((self.FIREBASE_CREDENTIALS_JSON or "").strip())
        has_adc_env = bool(os.getenv("GOOGLE_APPLICATION_CREDENTIALS", "").strip())
        if not (has_path or has_json or has_adc_env):
            raise RuntimeError(
                "Configure Firebase credentials via FIREBASE_CREDENTIALS_PATH, "
                "FIREBASE_CREDENTIALS_JSON, or GOOGLE_APPLICATION_CREDENTIALS"
            )


settings = Settings()
