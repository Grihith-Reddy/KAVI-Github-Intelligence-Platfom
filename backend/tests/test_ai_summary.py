import unittest

from app.services.ai_service import AIService


class AISummaryTests(unittest.TestCase):
    def setUp(self):
        self.service = AIService()
        self.payload = {
            "number": 2,
            "title": "master-abhishek",
            "body": "",
            "commits": [
                "feat: add enrollment and progress APIs",
                "refactor: extract enrollment service logic",
            ],
            "comments": [],
            "reviews": [],
            "files": [
                "src/main/java/io/github/grihithreddy/onlinecoursemanagement/enrollment/controller/EnrollmentController.java",
                "src/main/java/io/github/grihithreddy/onlinecoursemanagement/enrollment/service/EnrollmentService.java",
            ],
            "file_changes": [
                {
                    "filename": "src/main/java/io/github/grihithreddy/onlinecoursemanagement/enrollment/controller/EnrollmentController.java",
                    "status": "modified",
                    "additions": 120,
                    "deletions": 18,
                    "changes": 138,
                    "patch_excerpt": "@@ -1,1 +1,10 @@ ...",
                },
                {
                    "filename": "src/main/java/io/github/grihithreddy/onlinecoursemanagement/enrollment/service/EnrollmentService.java",
                    "status": "added",
                    "additions": 160,
                    "deletions": 0,
                    "changes": 160,
                    "patch_excerpt": "@@ -0,0 +1,30 @@ ...",
                },
            ],
            "change_stats": {
                "file_count": 2,
                "additions": 280,
                "deletions": 18,
                "renamed_files": 0,
                "added_files": 1,
                "removed_files": 0,
            },
        }

    def test_fallback_summary_uses_code_changes_when_text_is_empty(self):
        summary = self.service._fallback_summary(self.payload)

        self.assertIn("updates 2 files", summary["summary"].lower())
        self.assertNotIn("no files were changed", summary["summary"].lower())
        self.assertTrue(summary["intent"])
        self.assertIn("code-intent", summary["tags"])

    def test_normalize_summary_rejects_incorrect_no_files_claim(self):
        parsed = {
            "summary": "No files were changed as part of this pull request.",
            "intent": "No clear change intent.",
            "decisions": [],
            "risks": [],
            "tags": [],
        }

        normalized = self.service._normalize_summary(parsed, self.payload)

        self.assertNotIn("no files were changed", normalized["summary"].lower())
        self.assertIn("updates 2 files", normalized["summary"].lower())
        self.assertTrue(normalized["decisions"])

    def test_code_reference_notes_are_file_specific_when_repeated(self):
        raw_code_refs = [
            {
                "file_path": "src/main/java/com/acme/EnrollmentController.java",
                "start_line": 1,
                "end_line": 60,
                "pr_number": 1,
                "note": "The primary intent of this change is to implement enrollment flow.",
            },
            {
                "file_path": "src/main/java/com/acme/EnrollmentProgressController.java",
                "start_line": 1,
                "end_line": 43,
                "pr_number": 1,
                "note": "The primary intent of this change is to implement enrollment flow.",
            },
        ]

        normalized = self.service._normalize_code_references(raw_code_refs, context_sources=[])

        self.assertEqual(len(normalized), 2)
        self.assertNotEqual(normalized[0]["note"], normalized[1]["note"])
        self.assertIn("EnrollmentController.java", normalized[0]["note"])
        self.assertIn("EnrollmentProgressController.java", normalized[1]["note"])

    def test_fallback_chat_omits_code_refs_for_high_level_query(self):
        context_sources = [
            {
                "pr_number": 1,
                "pr_title": "master-abhi",
                "summary": "Implements enrollment and progress flow.",
                "intent": "Implement core enrollment flow.",
                "files": [
                    {
                        "file_path": "src/main/java/com/acme/EnrollmentController.java",
                        "start_line": 1,
                        "end_line": 60,
                    }
                ],
            }
        ]

        payload = self.service._fallback_chat_payload(
            query="what did master-abhi do",
            context_sources=context_sources,
            repo_overview_context=None,
        )
        structured = payload.get("structured") or {}
        self.assertEqual(structured.get("code_references"), [])

    def test_fallback_chat_keeps_code_refs_for_code_query(self):
        context_sources = [
            {
                "pr_number": 1,
                "pr_title": "master-abhi",
                "summary": "Implements enrollment and progress flow.",
                "intent": "Implement core enrollment flow.",
                "files": [
                    {
                        "file_path": "src/main/java/com/acme/EnrollmentController.java",
                        "start_line": 1,
                        "end_line": 60,
                    }
                ],
            }
        ]

        payload = self.service._fallback_chat_payload(
            query="which files and lines changed in master-abhi",
            context_sources=context_sources,
            repo_overview_context=None,
        )
        structured = payload.get("structured") or {}
        refs = structured.get("code_references") or []
        self.assertTrue(refs)


if __name__ == "__main__":
    unittest.main()
