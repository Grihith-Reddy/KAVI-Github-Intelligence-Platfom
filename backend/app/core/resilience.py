import threading
import time

from fastapi import HTTPException, status

from app.core.settings import settings


class CircuitBreaker:
    def __init__(self, service_name: str, failure_threshold: int, reset_timeout_seconds: int):
        self.service_name = service_name
        self.failure_threshold = failure_threshold
        self.reset_timeout_seconds = reset_timeout_seconds
        self._failure_count = 0
        self._opened_until = 0.0
        self._lock = threading.Lock()

    def before_request(self) -> None:
        with self._lock:
            if self._opened_until and time.time() < self._opened_until:
                raise HTTPException(
                    status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                    detail=f"{self.service_name} temporarily unavailable. Try again later.",
                )

    def record_success(self) -> None:
        with self._lock:
            self._failure_count = 0
            self._opened_until = 0.0

    def record_failure(self) -> None:
        with self._lock:
            self._failure_count += 1
            if self._failure_count >= self.failure_threshold:
                self._opened_until = time.time() + self.reset_timeout_seconds


github_circuit_breaker = CircuitBreaker(
    service_name="GitHub upstream",
    failure_threshold=settings.OUTBOUND_CIRCUIT_BREAKER_THRESHOLD,
    reset_timeout_seconds=settings.OUTBOUND_CIRCUIT_BREAKER_SECONDS,
)

ai_circuit_breaker = CircuitBreaker(
    service_name="AI upstream",
    failure_threshold=settings.OUTBOUND_CIRCUIT_BREAKER_THRESHOLD,
    reset_timeout_seconds=settings.OUTBOUND_CIRCUIT_BREAKER_SECONDS,
)
