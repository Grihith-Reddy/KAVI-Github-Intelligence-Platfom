import hashlib
import threading
import time
from collections import defaultdict
from uuid import uuid4

from fastapi import Request, status
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware

from app.core.audit import audit_log
from app.core.settings import settings


class RequestContextMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        request_id = request.headers.get("X-Request-ID") or str(uuid4())
        request.state.request_id = request_id
        response = await call_next(request)
        response.headers["X-Request-ID"] = request_id
        return response


class RequestSizeLimitMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        content_length = request.headers.get("content-length")
        if content_length:
            try:
                if int(content_length) > settings.MAX_REQUEST_BODY_BYTES:
                    return JSONResponse(
                        status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                        content={"detail": "Request body too large"},
                    )
            except ValueError:
                return JSONResponse(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    content={"detail": "Invalid Content-Length header"},
                )
        return await call_next(request)


class RateLimitMiddleware(BaseHTTPMiddleware):
    _lock = threading.Lock()
    _requests: dict[str, dict[int, int]] = defaultdict(dict)

    async def dispatch(self, request: Request, call_next):
        if request.url.path in {"/", "/health/live", "/health/ready"}:
            return await call_next(request)

        window = int(time.time() // 60)
        key = self._request_key(request)
        allowed = False
        current_count = 0

        with self._lock:
            bucket = self._requests[key]
            stale_windows = [bucket_window for bucket_window in bucket if bucket_window < window]
            for stale_window in stale_windows:
                bucket.pop(stale_window, None)

            current_count = bucket.get(window, 0)
            if current_count < settings.RATE_LIMIT_REQUESTS_PER_MINUTE:
                bucket[window] = current_count + 1
                allowed = True
                current_count = bucket[window]

        if not allowed:
            audit_log(
                "rate_limit.exceeded",
                key=key,
                path=request.url.path,
                method=request.method,
                request_id=getattr(request.state, "request_id", None),
            )
            return JSONResponse(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                headers={"Retry-After": "60"},
                content={"detail": "Rate limit exceeded"},
            )

        response = await call_next(request)
        response.headers["X-RateLimit-Limit"] = str(settings.RATE_LIMIT_REQUESTS_PER_MINUTE)
        response.headers["X-RateLimit-Remaining"] = str(
            max(settings.RATE_LIMIT_REQUESTS_PER_MINUTE - current_count, 0)
        )
        return response

    def _request_key(self, request: Request) -> str:
        auth_header = request.headers.get("authorization", "").strip()
        if auth_header:
            token_hash = hashlib.sha256(auth_header.encode()).hexdigest()[:20]
            return f"token:{token_hash}"

        client_host = request.client.host if request.client else "unknown"
        return f"ip:{client_host}"
