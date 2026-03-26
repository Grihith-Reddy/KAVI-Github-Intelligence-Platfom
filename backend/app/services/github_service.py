import logging
import time
from typing import Any

import requests
from fastapi import HTTPException, status
from tenacity import retry, retry_if_exception_type, stop_after_attempt, wait_exponential

from app.core.resilience import github_circuit_breaker
from app.core.settings import settings


logger = logging.getLogger(__name__)


class RetryableGitHubError(Exception):
    pass


class GitHubService:
    def __init__(self, token: str):
        self.token = token

    def _headers(self) -> dict[str, str]:
        return {
            "Authorization": f"Bearer {self.token}",
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
        }

    def _handle_rate_limit(self, response: requests.Response, allow_wait: bool) -> bool:
        remaining = response.headers.get("X-RateLimit-Remaining")
        reset = response.headers.get("X-RateLimit-Reset")
        if response.status_code == 403 and remaining == "0" and reset:
            reset_at = int(reset)
            sleep_for = max(reset_at - int(time.time()), settings.RATE_LIMIT_SLEEP_SECONDS)
            if allow_wait:
                time.sleep(min(sleep_for, 60))
                return True
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="GitHub rate limit exceeded. Try again later.",
            )
        return False

    @retry(
        retry=retry_if_exception_type((requests.RequestException, RetryableGitHubError)),
        wait=wait_exponential(multiplier=1, min=1, max=10),
        stop=stop_after_attempt(settings.OUTBOUND_RETRY_ATTEMPTS),
    )
    def _request(self, method: str, url: str, allow_wait: bool = False, **kwargs: Any) -> Any:
        github_circuit_breaker.before_request()
        try:
            response = requests.request(
                method,
                url,
                headers={**self._headers(), **kwargs.pop("headers", {})},
                timeout=settings.REQUEST_TIMEOUT_SECONDS,
                **kwargs,
            )
        except requests.RequestException:
            github_circuit_breaker.record_failure()
            raise

        if self._handle_rate_limit(response, allow_wait=allow_wait):
            raise RetryableGitHubError("Retrying after GitHub rate limit sleep")

        if response.status_code in {429, 500, 502, 503, 504}:
            github_circuit_breaker.record_failure()
            raise RetryableGitHubError(f"Retryable GitHub API error: {response.status_code}")

        if response.status_code >= 400:
            raise HTTPException(
                status_code=response.status_code,
                detail=f"GitHub API error: {response.text}",
            )

        github_circuit_breaker.record_success()
        return response.json()

    def _request_list_paginated(
        self,
        url: str,
        *,
        params: dict[str, Any] | None = None,
        allow_wait: bool = True,
        per_page: int = 100,
        max_pages: int = 20,
    ) -> list[dict[str, Any]]:
        merged: list[dict[str, Any]] = []
        base_params = dict(params or {})

        for page in range(1, max_pages + 1):
            page_params = {**base_params, "page": page, "per_page": per_page}
            payload = self._request("GET", url, params=page_params, allow_wait=allow_wait)
            if not isinstance(payload, list):
                break
            rows = [item for item in payload if isinstance(item, dict)]
            merged.extend(rows)
            if len(payload) < per_page:
                break

        return merged

    def list_repositories(self, page: int = 1, per_page: int = 50) -> list[dict[str, Any]]:
        url = f"{settings.GITHUB_API_BASE}/user/repos"
        return self._request(
            "GET",
            url,
            params={
                "page": page,
                "per_page": per_page,
                "affiliation": "owner,collaborator,organization_member",
                "visibility": "all",
            },
        )

    def get_repository(self, full_name: str) -> dict[str, Any]:
        url = f"{settings.GITHUB_API_BASE}/repos/{full_name}"
        return self._request("GET", url)

    def list_pull_requests(
        self,
        full_name: str,
        state: str = "all",
        page: int = 1,
        per_page: int = 50,
        max_pages: int = 20,
    ) -> list[dict[str, Any]]:
        url = f"{settings.GITHUB_API_BASE}/repos/{full_name}/pulls"
        if page > 1:
            payload = self._request(
                "GET",
                url,
                params={"state": state, "page": page, "per_page": per_page},
                allow_wait=True,
            )
            return payload if isinstance(payload, list) else []
        return self._request_list_paginated(
            url,
            params={"state": state},
            allow_wait=True,
            per_page=per_page,
            max_pages=max_pages,
        )

    def get_pull_request(self, full_name: str, number: int) -> dict[str, Any]:
        url = f"{settings.GITHUB_API_BASE}/repos/{full_name}/pulls/{number}"
        return self._request("GET", url, allow_wait=True)

    def list_pull_request_commits(self, full_name: str, number: int) -> list[dict[str, Any]]:
        url = f"{settings.GITHUB_API_BASE}/repos/{full_name}/pulls/{number}/commits"
        return self._request_list_paginated(url, allow_wait=True, per_page=100, max_pages=20)

    def list_pull_request_comments(self, full_name: str, number: int) -> list[dict[str, Any]]:
        url = f"{settings.GITHUB_API_BASE}/repos/{full_name}/issues/{number}/comments"
        return self._request_list_paginated(url, allow_wait=True, per_page=100, max_pages=20)

    def list_pull_request_reviews(self, full_name: str, number: int) -> list[dict[str, Any]]:
        url = f"{settings.GITHUB_API_BASE}/repos/{full_name}/pulls/{number}/reviews"
        return self._request_list_paginated(url, allow_wait=True, per_page=100, max_pages=20)

    def list_pull_request_files(self, full_name: str, number: int) -> list[dict[str, Any]]:
        url = f"{settings.GITHUB_API_BASE}/repos/{full_name}/pulls/{number}/files"
        return self._request_list_paginated(url, allow_wait=True, per_page=100, max_pages=20)

    def list_repository_tree(
        self,
        full_name: str,
        branch: str | None = None,
        max_entries: int = 5000,
    ) -> list[dict[str, Any]]:
        if not branch:
            repo = self.get_repository(full_name)
            branch = str(repo.get("default_branch") or "main")

        url = f"{settings.GITHUB_API_BASE}/repos/{full_name}/git/trees/{branch}"
        data = self._request("GET", url, params={"recursive": "1"}, allow_wait=True)
        tree = data.get("tree") if isinstance(data, dict) else []
        if not isinstance(tree, list):
            return []

        files: list[dict[str, Any]] = []
        for item in tree:
            if not isinstance(item, dict):
                continue
            if item.get("type") != "blob":
                continue
            files.append(
                {
                    "path": item.get("path"),
                    "size": item.get("size"),
                }
            )
            if len(files) >= max_entries:
                break
        return files


@retry(
    retry=retry_if_exception_type((requests.RequestException, RetryableGitHubError)),
    wait=wait_exponential(multiplier=1, min=1, max=10),
    stop=stop_after_attempt(settings.OUTBOUND_RETRY_ATTEMPTS),
)
def exchange_code_for_token(code: str) -> dict[str, Any]:
    github_circuit_breaker.before_request()
    try:
        response = requests.post(
            f"{settings.GITHUB_OAUTH_BASE}/access_token",
            headers={"Accept": "application/json"},
            data={
                "client_id": settings.GITHUB_CLIENT_ID,
                "client_secret": settings.GITHUB_CLIENT_SECRET,
                "code": code,
                "redirect_uri": settings.GITHUB_OAUTH_REDIRECT_URI,
            },
            timeout=settings.REQUEST_TIMEOUT_SECONDS,
        )
    except requests.RequestException:
        github_circuit_breaker.record_failure()
        raise

    if response.status_code in {429, 500, 502, 503, 504}:
        github_circuit_breaker.record_failure()
        raise RetryableGitHubError(f"Retryable GitHub OAuth error: {response.status_code}")

    if response.status_code >= 400:
        raise HTTPException(
            status_code=response.status_code,
            detail=f"GitHub OAuth error: {response.text}",
        )

    github_circuit_breaker.record_success()
    return response.json()


@retry(
    retry=retry_if_exception_type((requests.RequestException, RetryableGitHubError)),
    wait=wait_exponential(multiplier=1, min=1, max=10),
    stop=stop_after_attempt(settings.OUTBOUND_RETRY_ATTEMPTS),
)
def get_authenticated_user(token: str) -> dict[str, Any]:
    github_circuit_breaker.before_request()
    try:
        response = requests.get(
            f"{settings.GITHUB_API_BASE}/user",
            headers={
                "Authorization": f"Bearer {token}",
                "Accept": "application/vnd.github+json",
            },
            timeout=settings.REQUEST_TIMEOUT_SECONDS,
        )
    except requests.RequestException:
        github_circuit_breaker.record_failure()
        raise

    if response.status_code in {429, 500, 502, 503, 504}:
        github_circuit_breaker.record_failure()
        raise RetryableGitHubError(f"Retryable GitHub user fetch error: {response.status_code}")

    if response.status_code >= 400:
        raise HTTPException(
            status_code=response.status_code,
            detail=f"GitHub user fetch error: {response.text}",
        )

    github_circuit_breaker.record_success()
    return response.json()
