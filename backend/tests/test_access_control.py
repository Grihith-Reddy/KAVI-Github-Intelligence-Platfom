import unittest

from fastapi import HTTPException

from app.api.chat import ChatQuery, chat_query
from app.api.ingestion import repo_status
from app.api.knowledge import entry_detail, list_entries
from app.core.security import UserContext


class FakeResult:
    def __init__(self, *, row=None, rows=None, fetch_row=None):
        self._row = row
        self._rows = rows or []
        self._fetch_row = fetch_row

    def fetchone(self):
        return self._fetch_row

    def mappings(self):
        return self

    def first(self):
        return self._row

    def all(self):
        return self._rows


class FakeSession:
    def __init__(self, *, allowed_repos=None, allowed_entries=None):
        self.allowed_repos = allowed_repos or {}
        self.allowed_entries = allowed_entries or {}

    def execute(self, statement, params=None):
        sql = str(statement)
        params = params or {}

        if "FROM repositories r" in sql and "JOIN repository_access ra" in sql:
            return FakeResult(row=self.allowed_repos.get(params.get("repo_id")))

        if "FROM knowledge_entries k" in sql and "JOIN repositories r ON r.id = k.repo_id" in sql:
            return FakeResult(row=self.allowed_entries.get(params.get("entry_id")))

        if "FROM sync_jobs" in sql:
            return FakeResult(row=None)

        if "FROM knowledge_entries k" in sql:
            return FakeResult(rows=[])

        if "FROM file_mappings" in sql:
            return FakeResult(rows=[])

        raise AssertionError(f"Unexpected SQL executed: {sql}")


class AccessControlTests(unittest.TestCase):
    def setUp(self):
        self.user = UserContext(sub="auth0|user-a", email="a@example.com", name="User A")

    def test_chat_query_rejects_repo_without_access(self):
        db = FakeSession()

        with self.assertRaises(HTTPException) as ctx:
            chat_query(ChatQuery(repo_id="repo-b", query="auth"), current_user=self.user, db=db)

        self.assertEqual(ctx.exception.status_code, 404)

    def test_knowledge_entries_reject_repo_without_access(self):
        db = FakeSession()

        with self.assertRaises(HTTPException) as ctx:
            list_entries("repo-b", current_user=self.user, db=db)

        self.assertEqual(ctx.exception.status_code, 404)

    def test_entry_detail_rejects_entry_without_access(self):
        db = FakeSession()

        with self.assertRaises(HTTPException) as ctx:
            entry_detail("entry-b", current_user=self.user, db=db)

        self.assertEqual(ctx.exception.status_code, 404)

    def test_repo_status_returns_only_accessible_repository(self):
        db = FakeSession(
            allowed_repos={
                "repo-a": {
                    "id": "repo-a",
                    "github_repo_id": 123,
                    "full_name": "owner/repo-a",
                    "owner": "owner",
                    "name": "repo-a",
                    "is_private": True,
                    "default_branch": "main",
                    "synced_at": None,
                    "created_at": None,
                    "updated_at": None,
                }
            }
        )

        response = repo_status("repo-a", current_user=self.user, db=db)

        self.assertEqual(response["repository"]["id"], "repo-a")
        self.assertIsNone(response["sync_job"])


if __name__ == "__main__":
    unittest.main()
