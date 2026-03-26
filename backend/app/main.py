import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from sqlalchemy import text

from app.api import auth, chat, github, ingestion, knowledge
from app.core.database import SessionLocal
from app.core.middleware import RateLimitMiddleware, RequestContextMiddleware, RequestSizeLimitMiddleware
from app.core.settings import settings


logging.basicConfig(
    level=getattr(logging, settings.LOG_LEVEL.upper(), logging.INFO),
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
)
settings.validate_runtime()

app = FastAPI(title="KAVI API", version="0.2.0")

app.add_middleware(RequestContextMiddleware)
app.add_middleware(RequestSizeLimitMiddleware)
app.add_middleware(RateLimitMiddleware)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins(),
    allow_origin_regex=None if settings.is_production else r"^https?://(localhost|127\.0\.0\.1)(:\d+)?$",
    allow_credentials=True,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "X-Request-ID"],
)

app.include_router(auth.router, prefix=settings.API_V1_PREFIX)
app.include_router(github.router, prefix=settings.API_V1_PREFIX)
app.include_router(ingestion.router, prefix=settings.API_V1_PREFIX)
app.include_router(knowledge.router, prefix=settings.API_V1_PREFIX)
app.include_router(chat.router, prefix=settings.API_V1_PREFIX)


@app.get("/")
def root():
    return {"status": "ok", "service": "kavi-api"}


@app.get("/favicon.ico", include_in_schema=False)
def favicon():
    return Response(status_code=204)


@app.get("/health/live")
def live():
    return {"status": "ok"}


@app.get("/health/ready")
def ready():
    db = SessionLocal()
    try:
        db.execute(text("SELECT 1"))
        return {"status": "ready"}
    finally:
        db.close()
