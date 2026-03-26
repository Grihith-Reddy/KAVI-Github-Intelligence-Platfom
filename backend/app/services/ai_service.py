import json
import logging
import re
from collections import Counter
from typing import Any

import requests
from tenacity import retry, retry_if_exception_type, stop_after_attempt, wait_exponential

from app.core.resilience import ai_circuit_breaker
from app.core.settings import settings


logger = logging.getLogger(__name__)

_JSON_FENCE_RE = re.compile(r"```(?:json)?\s*(\{.*?\})\s*```", re.DOTALL | re.IGNORECASE)
_WORD_RE = re.compile(r"[a-zA-Z0-9_]{3,}")
_PATH_RE = re.compile(r"(?:[A-Za-z0-9_.-]+/){2,}[A-Za-z0-9_.-]+")


class RetryableAIError(Exception):
    pass


def _looks_general_query(
    query: str,
    context_sources: list[dict[str, Any]],
    repo_overview_context: dict[str, Any] | None,
) -> bool:
    lowered = str(query or "").strip().lower()
    if not lowered:
        return False

    repo_signals = (
        "pull request",
        " pr ",
        "repo",
        "repository",
        "timeline",
        "commit",
        "branch",
        "file ",
        "line ",
        "codebase",
        "this project",
        "this code",
        "explain entire repo",
        "entire repo",
        "whole repo",
    )
    if any(signal in lowered for signal in repo_signals):
        return False

    query_terms = {token.lower() for token in _WORD_RE.findall(lowered)}
    if not query_terms:
        return False

    source_terms: set[str] = set()
    for source in context_sources[:12]:
        for key in ("pr_title", "summary", "intent"):
            source_terms.update(token.lower() for token in _WORD_RE.findall(str(source.get(key) or "")))
        files = source.get("files") if isinstance(source.get("files"), list) else []
        for file_info in files:
            if not isinstance(file_info, dict):
                continue
            file_path = str(file_info.get("file_path") or "")
            source_terms.update(token.lower() for token in _WORD_RE.findall(file_path.replace("/", " ")))

    repository = (repo_overview_context or {}).get("repository")
    if isinstance(repository, dict):
        source_terms.update(token.lower() for token in _WORD_RE.findall(str(repository.get("full_name") or "")))

    overlap = len(query_terms & source_terms)
    if overlap >= 2:
        return False

    general_starters = (
        "what is",
        "how to",
        "how do i",
        "difference between",
        "best practice",
        "best practices",
        "why does",
        "when should",
        "tips for",
        "explain ",
    )
    if any(lowered.startswith(starter) for starter in general_starters):
        return True
    return overlap == 0 and len(query_terms) >= 2


class AIService:
    _gemini_disabled_reason: str | None = None
    _resolved_model_name: str | None = None
    _model_discovery_attempted = False

    def __init__(self) -> None:
        provider = settings.AI_PROVIDER.lower()
        self._gemini_enabled = provider == "gemini" and bool(settings.AI_API_KEY)

    def summarize_pr(self, pr_payload: dict[str, Any]) -> dict[str, Any]:
        if not self._can_use_gemini():
            return self._fallback_summary(pr_payload)

        try:
            raw = self._gemini_summary_raw(pr_payload)
            try:
                parsed = self._extract_json_object(raw)
            except Exception:
                parsed = self._repair_summary_json(raw)
            return self._normalize_summary(parsed, pr_payload)
        except Exception as exc:
            logger.warning("Gemini summary failed; using fallback summary: %s", exc)
            return self._fallback_summary(pr_payload)

    def generate_chat_payload(
        self,
        query: str,
        context_sources: list[dict[str, Any]],
        repo_overview_context: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        general_query = _looks_general_query(query, context_sources, repo_overview_context)

        if not context_sources and not repo_overview_context:
            if self._can_use_gemini() and general_query:
                try:
                    structured = self._gemini_general_chat_structured(query)
                    answer = self._format_structured_answer(structured)
                    return {"answer": answer, "structured": structured}
                except Exception as exc:
                    logger.warning("Gemini general structured chat failed; using fallback response: %s", exc)
            fallback = self._fallback_chat_payload(
                query,
                context_sources,
                repo_overview_context,
                fallback_reason="insufficient_context",
            )
            return fallback

        if not self._can_use_gemini():
            return self._fallback_chat_payload(
                query,
                context_sources,
                repo_overview_context,
                fallback_reason="ai_provider_unavailable",
            )

        try:
            structured = self._gemini_chat_structured(query, context_sources, repo_overview_context)
            answer = self._format_structured_answer(structured)
            return {"answer": answer, "structured": structured}
        except Exception as exc:
            if general_query and self._can_use_gemini():
                try:
                    structured = self._gemini_general_chat_structured(query)
                    answer = self._format_structured_answer(structured)
                    return {"answer": answer, "structured": structured}
                except Exception as general_exc:
                    logger.warning(
                        "Gemini general fallback chat failed after structured failure: %s",
                        general_exc,
                    )
            logger.warning("Gemini structured chat failed; using fallback response: %s", exc)
            fallback_reason = (
                "structured_parse_failed"
                if "json" in str(exc).lower() or "object" in str(exc).lower()
                else "ai_provider_unavailable"
            )
            return self._fallback_chat_payload(
                query,
                context_sources,
                repo_overview_context,
                fallback_reason=fallback_reason,
            )

    def generate_chat_response(self, query: str, context_sources: list[dict[str, Any]]) -> str:
        payload = self.generate_chat_payload(query, context_sources)
        return str(payload.get("answer") or "")

    def _gemini_summary_raw(self, pr_payload: dict[str, Any]) -> str:
        prompt = (
            "You are a senior software engineer analyzing a GitHub pull request.\n"
            "Return STRICT JSON with exactly these keys: summary, intent, decisions, risks, tags.\n"
            "Rules:\n"
            "- summary: 2-4 sentences.\n"
            "- intent: one sentence explaining why the change exists.\n"
            "- decisions: array of concise strings.\n"
            "- risks: array of concise strings (empty if none).\n"
            "- tags: array of short technical tags.\n"
            "- Prioritize code evidence from `file_changes`, `change_stats`, and `commits` over PR description text.\n"
            "- If PR description/comments/reviews are empty, infer intent from changed files and patch excerpts.\n"
            "- Never claim 'no files changed' when `change_stats.file_count` is greater than zero.\n"
            "- Do not wrap JSON in markdown.\n\n"
            f"PR DATA:\n{json.dumps(pr_payload, default=str)[:20000]}"
        )
        return self._call_gemini(
            prompt,
            temperature=0.15,
            max_output_tokens=1200,
            response_mime_type="application/json",
        )

    def _extract_pr_file_changes(self, pr_payload: dict[str, Any]) -> list[dict[str, Any]]:
        raw_changes = pr_payload.get("file_changes")
        normalized: list[dict[str, Any]] = []

        if isinstance(raw_changes, list):
            for item in raw_changes:
                if not isinstance(item, dict):
                    continue
                filename = str(item.get("filename") or "").strip()
                if not filename:
                    continue
                normalized.append(
                    {
                        "filename": filename,
                        "status": str(item.get("status") or "").strip().lower(),
                        "additions": int(item.get("additions") or 0),
                        "deletions": int(item.get("deletions") or 0),
                        "changes": int(item.get("changes") or 0),
                    }
                )
            if normalized:
                return normalized

        raw_files = pr_payload.get("files")
        if isinstance(raw_files, list):
            for item in raw_files:
                if isinstance(item, dict):
                    filename = str(item.get("filename") or item.get("path") or "").strip()
                    if not filename:
                        continue
                    normalized.append(
                        {
                            "filename": filename,
                            "status": str(item.get("status") or "").strip().lower(),
                            "additions": int(item.get("additions") or 0),
                            "deletions": int(item.get("deletions") or 0),
                            "changes": int(item.get("changes") or 0),
                        }
                    )
                elif isinstance(item, str):
                    path = item.strip()
                    if path:
                        normalized.append(
                            {
                                "filename": path,
                                "status": "",
                                "additions": 0,
                                "deletions": 0,
                                "changes": 0,
                            }
                        )
        return normalized

    def _collect_change_stats(self, pr_payload: dict[str, Any], file_changes: list[dict[str, Any]]) -> dict[str, int]:
        payload_stats = pr_payload.get("change_stats") if isinstance(pr_payload.get("change_stats"), dict) else {}
        stats = {
            "file_count": int(payload_stats.get("file_count") or len(file_changes)),
            "additions": int(payload_stats.get("additions") or 0),
            "deletions": int(payload_stats.get("deletions") or 0),
            "renamed_files": int(payload_stats.get("renamed_files") or 0),
            "added_files": int(payload_stats.get("added_files") or 0),
            "removed_files": int(payload_stats.get("removed_files") or 0),
        }
        if stats["additions"] == 0:
            stats["additions"] = sum(int(item.get("additions") or 0) for item in file_changes)
        if stats["deletions"] == 0:
            stats["deletions"] = sum(int(item.get("deletions") or 0) for item in file_changes)
        if stats["file_count"] == 0:
            stats["file_count"] = len(file_changes)
        return stats

    def _infer_language_tags(self, file_paths: list[str]) -> list[str]:
        extension_map = {
            ".py": "python",
            ".ts": "typescript",
            ".tsx": "react",
            ".js": "javascript",
            ".jsx": "react",
            ".java": "java",
            ".kt": "kotlin",
            ".go": "go",
            ".rs": "rust",
            ".cs": "dotnet",
            ".sql": "sql",
            ".yml": "yaml",
            ".yaml": "yaml",
            ".json": "json",
            ".md": "docs",
            ".css": "css",
            ".scss": "scss",
            ".html": "html",
            ".sh": "shell",
            ".tf": "terraform",
        }
        counts: Counter[str] = Counter()
        for raw_path in file_paths:
            path = str(raw_path or "").lower()
            if not path:
                continue
            if path.endswith("dockerfile"):
                counts["docker"] += 1
                continue
            extension = ""
            if "." in path:
                extension = "." + path.split(".")[-1]
            tag = extension_map.get(extension)
            if tag:
                counts[tag] += 1
        return [tag for tag, _ in counts.most_common(4)]

    def _infer_focus_areas(self, file_paths: list[str]) -> list[str]:
        ignored = {"", "src", "app", "apps", "lib", "libs", "main", "test", "tests", "backend", "frontend"}
        counts: Counter[str] = Counter()
        for raw_path in file_paths:
            normalized = str(raw_path or "").replace("\\", "/").strip("/")
            if not normalized:
                continue
            parts = [part for part in normalized.split("/") if part]
            if not parts:
                continue
            chosen = parts[0].lower()
            if chosen in ignored and len(parts) > 1:
                chosen = parts[1].lower()
            counts[chosen] += 1
        return [area for area, _ in counts.most_common(4)]

    def _sanitize_tag(self, value: str) -> str:
        cleaned = "-".join(part for part in re.split(r"[^a-zA-Z0-9]+", value.lower()) if part)
        return cleaned[:32]

    def _suggest_intent_from_code(
        self,
        pr_payload: dict[str, Any],
        file_changes: list[dict[str, Any]],
        focus_areas: list[str],
    ) -> str:
        title = str(pr_payload.get("title") or "").strip()
        file_count = len(file_changes)
        if focus_areas and file_count:
            area_text = ", ".join(focus_areas[:2])
            if title:
                return f"This pull request advances {title} by updating code in {area_text}."
            return f"This pull request updates {file_count} files in {area_text} to implement repository changes."
        if title:
            return title[:700]
        if file_count:
            return f"This pull request updates {file_count} files to evolve the codebase."
        return "No title provided."

    def _contains_no_file_claim(self, text_value: str) -> bool:
        lowered = str(text_value or "").lower()
        phrases = (
            "no files were changed",
            "no files changed",
            "no file changes",
            "no files were modified",
            "no code changes",
            "no file changes were listed",
        )
        return any(phrase in lowered for phrase in phrases)

    def _query_prefers_code_references(self, query: str) -> bool:
        lowered = str(query or "").lower()
        signals = (
            "which file",
            "what file",
            "code reference",
            "code refs",
            "show code",
            "line ",
            "lines ",
            "where in code",
            "class",
            "method",
            "function",
            "implementation",
            "diff",
            "changed file",
            "file path",
        )
        return any(signal in lowered for signal in signals)

    def _is_general_query(
        self,
        query: str,
        context_sources: list[dict[str, Any]],
        repo_overview_context: dict[str, Any] | None,
    ) -> bool:
        lowered = str(query or "").strip().lower()
        if not lowered:
            return False

        repo_signals = (
            "pull request",
            " pr ",
            "repo",
            "repository",
            "timeline",
            "commit",
            "branch",
            "file ",
            "line ",
            "codebase",
            "this project",
            "this code",
            "explain entire repo",
            "entire repo",
            "whole repo",
        )
        if any(signal in lowered for signal in repo_signals):
            return False

        query_terms = {token.lower() for token in _WORD_RE.findall(lowered)}
        if not query_terms:
            return False

        source_terms: set[str] = set()
        for source in context_sources[:12]:
            for key in ("pr_title", "summary", "intent"):
                source_terms.update(token.lower() for token in _WORD_RE.findall(str(source.get(key) or "")))
            for path in self._source_file_paths(source):
                source_terms.update(token.lower() for token in _WORD_RE.findall(path.replace("/", " ")))

        repository = (repo_overview_context or {}).get("repository")
        if isinstance(repository, dict):
            source_terms.update(token.lower() for token in _WORD_RE.findall(str(repository.get("full_name") or "")))

        overlap = len(query_terms & source_terms)
        if overlap >= 2:
            return False

        general_starters = (
            "what is",
            "how to",
            "how do i",
            "difference between",
            "best practice",
            "best practices",
            "why does",
            "when should",
            "tips for",
            "explain ",
        )
        if any(lowered.startswith(starter) for starter in general_starters):
            return True
        return overlap == 0 and len(query_terms) >= 2

    def _source_file_paths(self, source: dict[str, Any]) -> list[str]:
        files = source.get("files") if isinstance(source.get("files"), list) else []
        paths: list[str] = []
        for file_info in files:
            if not isinstance(file_info, dict):
                continue
            file_path = str(file_info.get("file_path") or "").strip()
            if file_path:
                paths.append(file_path)
        return paths

    def _build_code_grounded_summary_from_sources(self, context_sources: list[dict[str, Any]]) -> str:
        for source in context_sources:
            file_paths = self._source_file_paths(source)
            if not file_paths:
                continue
            pr_number = source.get("pr_number") or "?"
            pr_title = str(source.get("pr_title") or "Untitled PR").strip()
            sample = ", ".join(file_paths[:3])
            return (
                f"PR #{pr_number} ({pr_title}) includes mapped code changes across {len(file_paths)} files."
                f" Key files include {sample}."
            )
        return "Code references are available, but a concise code-grounded summary could not be synthesized."

    def _build_code_footprint_section(self, context_sources: list[dict[str, Any]]) -> dict[str, Any] | None:
        for source in context_sources:
            file_paths = self._source_file_paths(source)
            if not file_paths:
                continue
            pr_number = source.get("pr_number") or "?"
            pr_title = str(source.get("pr_title") or "Untitled PR").strip()
            bullets = [
                f"PR #{pr_number} ({pr_title}) touches {len(file_paths)} indexed files.",
                f"Representative files: {', '.join(file_paths[:4])}.",
            ]
            return {"heading": "Code Footprint", "bullets": bullets}
        return None

    def _sanitize_limitations_for_code_context(self, limitations: list[str]) -> list[str]:
        sanitized = [item for item in limitations if not self._contains_no_file_claim(item)]
        if not sanitized:
            sanitized.append("Some line-level ranges may be unavailable when upstream patches omit hunk data.")
        return sanitized[:6]

    def _file_name_from_path(self, file_path: str) -> str:
        normalized = str(file_path or "").replace("\\", "/").strip("/")
        if not normalized:
            return "this file"
        return normalized.split("/")[-1] or normalized

    def _replace_paths_with_file_names(self, text_value: str) -> str:
        def _replace(match: re.Match[str]) -> str:
            return self._file_name_from_path(match.group(0))

        return _PATH_RE.sub(_replace, str(text_value or ""))

    def _file_role_label(self, file_path: str) -> str:
        lowered = str(file_path or "").lower()
        file_name = self._file_name_from_path(file_path).lower()
        if "controller" in file_name:
            return "controller/API"
        if "service" in file_name:
            return "service logic"
        if "repository" in file_name or "dao" in file_name:
            return "data access"
        if "entity" in file_name or "model" in file_name or "dto" in file_name:
            return "domain model"
        if "config" in file_name or "settings" in file_name:
            return "configuration"
        if "test" in file_name or "spec" in file_name:
            return "tests"
        if lowered.endswith(".sql") or "migration" in lowered:
            return "database layer"
        return "implementation"

    def _file_specific_note(
        self,
        file_path: str,
        pr_number: int | None = None,
        start_line: int | None = None,
        end_line: int | None = None,
    ) -> str:
        file_name = self._file_name_from_path(file_path)
        role = self._file_role_label(file_path)
        pr_text = f" in PR #{pr_number}" if pr_number else ""
        if start_line and end_line:
            return f"{file_name} has {role} changes{pr_text} around lines {start_line}-{end_line}."
        if start_line:
            return f"{file_name} has {role} changes{pr_text} around line {start_line}."
        return f"{file_name} has {role} changes{pr_text}."

    def _post_process_code_references(self, refs: list[dict[str, Any]]) -> list[dict[str, Any]]:
        deduped: list[dict[str, Any]] = []
        seen_keys: set[tuple[str, int | None, int | None, int | None]] = set()
        for ref in refs:
            key = (
                str(ref.get("file_path") or ""),
                self._to_int_or_none(ref.get("start_line")),
                self._to_int_or_none(ref.get("end_line")),
                self._to_int_or_none(ref.get("pr_number")),
            )
            if not key[0] or key in seen_keys:
                continue
            seen_keys.add(key)
            deduped.append(
                {
                    "file_path": key[0][:260],
                    "start_line": key[1],
                    "end_line": key[2],
                    "pr_number": key[3],
                    "note": str(ref.get("note") or "").strip()[:240],
                }
            )

        if not deduped:
            return []

        note_counter = Counter(
            note
            for note in (str(item.get("note") or "").strip() for item in deduped)
            if note
        )
        for item in deduped:
            existing_note = str(item.get("note") or "").strip()
            if (
                not existing_note
                or self._contains_no_file_claim(existing_note)
                or note_counter.get(existing_note, 0) > 1
            ):
                item["note"] = self._file_specific_note(
                    str(item.get("file_path") or ""),
                    self._to_int_or_none(item.get("pr_number")),
                    self._to_int_or_none(item.get("start_line")),
                    self._to_int_or_none(item.get("end_line")),
                )[:240]

        return deduped[:12]

    def _gemini_chat_structured(
        self,
        query: str,
        context_sources: list[dict[str, Any]],
        repo_overview_context: dict[str, Any] | None,
    ) -> dict[str, Any]:
        compact_sources = self._compact_sources(context_sources)
        prompt = (
            "You are Kavi, a senior engineering assistant.\n"
            "Return STRICT JSON only. No markdown.\n"
            "For repository-specific claims, use only provided context. Never invent files, PRs, or lines.\n"
            "For clearly general software/engineering questions, answer using general technical knowledge.\n\n"
            "Required output schema:\n"
            "{\n"
            '  "title": "short title",\n'
            '  "summary": "2-4 sentence summary",\n'
            '  "sections": [{"heading":"...", "bullets":["...", "..."]}],\n'
            '  "code_references": [\n'
            '      {"file_path":"...", "start_line": null, "end_line": null, "pr_number": null, "note":"..."}\n'
            "  ],\n"
            '  "timeline_highlights": [{"label":"...", "detail":"..."}],\n'
            '  "limitations": ["..."]\n'
            "}\n\n"
            "Rules:\n"
            "1) Sections must be concise and useful for engineers.\n"
            "2) Prefer sections for architecture, features, technologies, and evolution when relevant.\n"
            "3) code_references must point to real paths from context.\n"
            "4) For high-level questions (e.g. 'what did PR X do'), keep code_references empty unless needed.\n"
            "5) For high-level questions, explain outcomes in plain language and avoid dumping raw file paths.\n"
            "6) For general questions, keep code_references empty and avoid repository-specific claims.\n"
            "7) If data is missing, limitations must explicitly call it out.\n\n"
            f"QUESTION:\n{query.strip()}\n\n"
            f"PR_CONTEXT:\n{json.dumps(compact_sources, default=str)}\n\n"
            f"REPO_OVERVIEW_CONTEXT:\n{json.dumps(repo_overview_context or {}, default=str)}"
        )
        raw = self._call_gemini(
            prompt,
            temperature=0.2,
            max_output_tokens=1300,
            response_mime_type="application/json",
        )
        try:
            parsed = self._extract_json_object(raw)
        except Exception:
            parsed = self._repair_chat_json(raw)
        return self._normalize_chat_structure(parsed, context_sources, repo_overview_context, query)

    def _gemini_general_chat_structured(self, query: str) -> dict[str, Any]:
        prompt = (
            "You are Kavi, a senior software engineering assistant.\n"
            "Return STRICT JSON only. No markdown.\n"
            "This question is general and not tied to repository evidence.\n"
            "Do not invent repository-specific facts, PR numbers, file paths, or line numbers.\n\n"
            "Required output schema:\n"
            "{\n"
            '  "title": "short title",\n'
            '  "summary": "2-4 sentence summary",\n'
            '  "sections": [{"heading":"...", "bullets":["...", "..."]}],\n'
            '  "code_references": [],\n'
            '  "timeline_highlights": [],\n'
            '  "limitations": ["..."]\n'
            "}\n\n"
            "Rules:\n"
            "1) Use plain, practical engineering language.\n"
            "2) Keep sections concise and actionable.\n"
            "3) code_references and timeline_highlights must be empty arrays.\n"
            "4) Mention that guidance is general if repository evidence is required.\n\n"
            f"QUESTION:\n{query.strip()}"
        )
        raw = self._call_gemini(
            prompt,
            temperature=0.2,
            max_output_tokens=1100,
            response_mime_type="application/json",
        )
        try:
            parsed = self._extract_json_object(raw)
        except Exception:
            parsed = self._repair_chat_json(raw)
        return self._normalize_chat_structure(parsed, [], None, query)

    def _repair_summary_json(self, raw_text: str) -> dict[str, Any]:
        repair_prompt = (
            "Convert the following model output into STRICT JSON.\n"
            "Return one JSON object with exactly these keys: summary, intent, decisions, risks, tags.\n"
            "Rules:\n"
            "- summary: string\n"
            "- intent: string\n"
            "- decisions: array of strings\n"
            "- risks: array of strings\n"
            "- tags: array of short strings\n"
            "- Do not include markdown.\n\n"
            f"RAW OUTPUT:\n{str(raw_text or '')[:14000]}"
        )
        repaired = self._call_gemini(
            repair_prompt,
            temperature=0.0,
            max_output_tokens=1000,
            response_mime_type="application/json",
        )
        return self._extract_json_object(repaired)

    def _repair_chat_json(self, raw_text: str) -> dict[str, Any]:
        repair_prompt = (
            "Convert the following model output into STRICT JSON.\n"
            "Return one JSON object with exactly this schema:\n"
            "{\n"
            '  "title": "short title",\n'
            '  "summary": "2-4 sentence summary",\n'
            '  "sections": [{"heading":"...", "bullets":["...", "..."]}],\n'
            '  "code_references": [{"file_path":"...", "start_line": null, "end_line": null, "pr_number": null, "note":"..."}],\n'
            '  "timeline_highlights": [{"label":"...", "detail":"..."}],\n'
            '  "limitations": ["..."]\n'
            "}\n"
            "Rules:\n"
            "- Preserve factual meaning from the raw output.\n"
            "- Do not add facts not present in the raw output.\n"
            "- If a field is unavailable, return empty array/string.\n"
            "- For general questions, code_references and timeline_highlights should be empty arrays.\n"
            "- Do not include markdown.\n\n"
            f"RAW OUTPUT:\n{str(raw_text or '')[:18000]}"
        )
        repaired = self._call_gemini(
            repair_prompt,
            temperature=0.0,
            max_output_tokens=1300,
            response_mime_type="application/json",
        )
        return self._extract_json_object(repaired)

    def _normalize_summary(self, parsed: dict[str, Any], pr_payload: dict[str, Any]) -> dict[str, Any]:
        fallback = self._fallback_summary(pr_payload)
        summary = str(parsed.get("summary") or "").strip()
        if not summary:
            summary = str(fallback.get("summary") or "")

        intent = str(parsed.get("intent") or "").strip()
        if not intent:
            intent = str(fallback.get("intent") or "")

        decisions_raw = parsed.get("decisions") if isinstance(parsed.get("decisions"), list) else []
        risks_raw = parsed.get("risks") if isinstance(parsed.get("risks"), list) else []
        tags_raw = parsed.get("tags") if isinstance(parsed.get("tags"), list) else []

        decisions = [str(item).strip() for item in decisions_raw if str(item).strip()][:12]
        risks = [str(item).strip() for item in risks_raw if str(item).strip()][:12]
        tags = [str(item).strip() for item in tags_raw if str(item).strip()][:12]

        file_changes = self._extract_pr_file_changes(pr_payload)
        change_stats = self._collect_change_stats(pr_payload, file_changes)
        has_code_context = change_stats.get("file_count", 0) > 0

        if has_code_context and self._contains_no_file_claim(summary):
            summary = str(fallback.get("summary") or summary)
        if has_code_context and self._contains_no_file_claim(intent):
            intent = str(fallback.get("intent") or intent)

        if not decisions:
            decisions = [str(item) for item in (fallback.get("decisions") or []) if str(item).strip()][:12]
        if not decisions:
            decisions = ["Summary inferred from code changes due limited PR discussion context."]

        if not risks:
            risks = [str(item) for item in (fallback.get("risks") or []) if str(item).strip()][:12]

        merged_tags: list[str] = []
        for tag in tags + [str(item) for item in (fallback.get("tags") or [])]:
            cleaned = self._sanitize_tag(tag)
            if not cleaned:
                continue
            if cleaned not in merged_tags:
                merged_tags.append(cleaned)
            if len(merged_tags) >= 12:
                break

        return {
            "summary": summary[:2000],
            "intent": intent[:700],
            "decisions": decisions,
            "risks": risks,
            "tags": merged_tags or ["uncategorized"],
        }

    def _normalize_chat_structure(
        self,
        parsed: dict[str, Any],
        context_sources: list[dict[str, Any]],
        repo_overview_context: dict[str, Any] | None,
        query: str = "",
    ) -> dict[str, Any]:
        title = str(parsed.get("title") or "Repository Overview").strip()[:120]
        summary = str(parsed.get("summary") or "").strip()[:1400]
        if not summary:
            summary = "Context is available, but no concise summary was produced."

        sections_raw = parsed.get("sections") if isinstance(parsed.get("sections"), list) else []
        sections: list[dict[str, Any]] = []
        for section in sections_raw[:8]:
            if not isinstance(section, dict):
                continue
            heading = str(section.get("heading") or "").strip()[:90]
            bullets_raw = section.get("bullets") if isinstance(section.get("bullets"), list) else []
            bullets = [str(item).strip()[:240] for item in bullets_raw if str(item).strip()][:8]
            if heading and bullets:
                sections.append({"heading": heading, "bullets": bullets})

        if not sections:
            sections.append(
                {
                    "heading": "Key Takeaways",
                    "bullets": [summary],
                }
            )

        prefer_code_refs = self._query_prefers_code_references(query)
        code_refs = self._normalize_code_references(
            parsed.get("code_references"),
            context_sources,
            fallback_to_defaults=prefer_code_refs,
        )
        timeline_highlights = self._normalize_timeline_highlights(
            parsed.get("timeline_highlights"),
            repo_overview_context,
        )
        limitations = self._normalize_list(parsed.get("limitations"), max_items=6, max_length=240)
        has_code_context = any(self._source_file_paths(source) for source in context_sources)
        if has_code_context:
            if self._contains_no_file_claim(summary):
                summary = self._build_code_grounded_summary_from_sources(context_sources)
            if prefer_code_refs and not any(
                str(section.get("heading") or "").strip().lower() == "code footprint" for section in sections
            ):
                code_section = self._build_code_footprint_section(context_sources)
                if code_section:
                    sections.append(code_section)
            limitations = self._sanitize_limitations_for_code_context(limitations)

        if not prefer_code_refs:
            summary = self._replace_paths_with_file_names(summary)
            filtered_sections: list[dict[str, Any]] = []
            for section in sections:
                heading = str(section.get("heading") or "").strip()
                heading_key = heading.lower()
                if heading_key in {"code references", "code footprint"}:
                    continue
                bullets = section.get("bullets") if isinstance(section.get("bullets"), list) else []
                cleaned_bullets = [self._replace_paths_with_file_names(str(item))[:240] for item in bullets if str(item).strip()]
                if heading and cleaned_bullets:
                    filtered_sections.append({"heading": heading, "bullets": cleaned_bullets[:8]})
            if filtered_sections:
                sections = filtered_sections

        return {
            "title": title,
            "summary": summary,
            "sections": sections,
            "code_references": code_refs,
            "timeline_highlights": timeline_highlights,
            "limitations": limitations,
        }

    def _normalize_code_references(
        self,
        raw_code_refs: Any,
        context_sources: list[dict[str, Any]],
        fallback_to_defaults: bool = True,
    ) -> list[dict[str, Any]]:
        normalized: list[dict[str, Any]] = []
        if isinstance(raw_code_refs, list):
            for item in raw_code_refs[:12]:
                if not isinstance(item, dict):
                    continue
                file_path = str(item.get("file_path") or "").strip()[:260]
                if not file_path:
                    continue
                start_line = self._to_int_or_none(item.get("start_line"))
                end_line = self._to_int_or_none(item.get("end_line"))
                pr_number = self._to_int_or_none(item.get("pr_number"))
                note = str(item.get("note") or "").strip()[:240]
                normalized.append(
                    {
                        "file_path": file_path,
                        "start_line": start_line,
                        "end_line": end_line,
                        "pr_number": pr_number,
                        "note": note,
                    }
                )

        if normalized:
            return self._post_process_code_references(normalized)
        if not fallback_to_defaults:
            return []
        return self._post_process_code_references(self._default_code_references(context_sources))

    def _normalize_timeline_highlights(
        self,
        raw_timeline: Any,
        repo_overview_context: dict[str, Any] | None,
    ) -> list[dict[str, str]]:
        highlights: list[dict[str, str]] = []
        if isinstance(raw_timeline, list):
            for item in raw_timeline[:8]:
                if not isinstance(item, dict):
                    continue
                label = str(item.get("label") or "").strip()[:80]
                detail = str(item.get("detail") or "").strip()[:260]
                if label and detail:
                    highlights.append({"label": label, "detail": detail})

        if highlights:
            return highlights

        monthly = (repo_overview_context or {}).get("monthly_activity")
        if not isinstance(monthly, list):
            return []

        fallback: list[dict[str, str]] = []
        for item in monthly[-4:]:
            if not isinstance(item, dict):
                continue
            label = str(item.get("month") or "").strip()
            pr_count = item.get("pr_count")
            merged_count = item.get("merged_count")
            fallback.append(
                {
                    "label": label or "Unknown period",
                    "detail": f"{pr_count or 0} PRs, {merged_count or 0} merged",
                }
            )
        return fallback

    def _normalize_list(self, raw: Any, max_items: int, max_length: int) -> list[str]:
        if not isinstance(raw, list):
            return []
        return [str(item).strip()[:max_length] for item in raw if str(item).strip()][:max_items]

    def _to_int_or_none(self, value: Any) -> int | None:
        try:
            if value is None:
                return None
            return int(value)
        except (TypeError, ValueError):
            return None

    def _default_code_references(self, context_sources: list[dict[str, Any]]) -> list[dict[str, Any]]:
        defaults: list[dict[str, Any]] = []
        for source in context_sources[:6]:
            files = source.get("files") if isinstance(source.get("files"), list) else []
            for file_info in files[:2]:
                if not isinstance(file_info, dict):
                    continue
                file_path = str(file_info.get("file_path") or "").strip()
                if not file_path:
                    continue
                pr_number = self._to_int_or_none(source.get("pr_number"))
                start_line = self._to_int_or_none(file_info.get("start_line"))
                end_line = self._to_int_or_none(file_info.get("end_line"))
                note_text = self._file_specific_note(file_path, pr_number, start_line, end_line)
                defaults.append(
                    {
                        "file_path": file_path[:260],
                        "start_line": start_line,
                        "end_line": end_line,
                        "pr_number": pr_number,
                        "note": note_text[:220],
                    }
                )
                if len(defaults) >= 8:
                    return defaults
        return defaults

    def _format_structured_answer(self, structured: dict[str, Any]) -> str:
        lines = [f"## {structured.get('title', 'Repository Context Answer')}", ""]
        summary = str(structured.get("summary") or "").strip()
        if summary:
            lines.append(summary)
            lines.append("")

        sections = structured.get("sections")
        if isinstance(sections, list):
            for section in sections:
                if not isinstance(section, dict):
                    continue
                heading = str(section.get("heading") or "").strip()
                bullets = section.get("bullets") if isinstance(section.get("bullets"), list) else []
                if not heading or not bullets:
                    continue
                lines.append(f"### {heading}")
                for bullet in bullets:
                    lines.append(f"- {str(bullet)}")
                lines.append("")

        refs = structured.get("code_references")
        if isinstance(refs, list) and refs:
            lines.append("### Code References")
            for ref in refs[:8]:
                if not isinstance(ref, dict):
                    continue
                file_path = str(ref.get("file_path") or "unknown")
                start_line = ref.get("start_line")
                end_line = ref.get("end_line")
                pr_number = ref.get("pr_number")
                note = str(ref.get("note") or "").strip()
                line_text = ""
                if start_line and end_line:
                    line_text = f" (L{start_line}-{end_line})"
                elif start_line:
                    line_text = f" (L{start_line})"
                pr_text = f" [PR #{pr_number}]" if pr_number else ""
                if note:
                    lines.append(f"- `{file_path}`{line_text}{pr_text}: {note}")
                else:
                    lines.append(f"- `{file_path}`{line_text}{pr_text}")
            lines.append("")

        timeline = structured.get("timeline_highlights")
        if isinstance(timeline, list) and timeline:
            lines.append("### Evolution Highlights")
            for item in timeline[:6]:
                if not isinstance(item, dict):
                    continue
                label = str(item.get("label") or "").strip()
                detail = str(item.get("detail") or "").strip()
                if label and detail:
                    lines.append(f"- **{label}**: {detail}")
            lines.append("")

        limitations = structured.get("limitations")
        if isinstance(limitations, list) and limitations:
            lines.append("### Limits")
            for limitation in limitations[:5]:
                lines.append(f"- {str(limitation)}")

        return "\n".join(lines).strip()

    def _extract_json_object(self, raw: str) -> dict[str, Any]:
        text = (raw or "").strip()
        if not text:
            raise ValueError("Empty response from Gemini")

        fenced = _JSON_FENCE_RE.search(text)
        if fenced:
            text = fenced.group(1).strip()

        try:
            parsed = json.loads(text)
            if isinstance(parsed, dict):
                return parsed
            if isinstance(parsed, list) and parsed and isinstance(parsed[0], dict):
                return parsed[0]
        except json.JSONDecodeError:
            pass

        start = text.find("{")
        end = text.rfind("}")
        if start == -1 or end == -1 or end <= start:
            raise ValueError("Gemini response did not include JSON object")

        parsed = json.loads(text[start : end + 1])
        if not isinstance(parsed, dict):
            raise ValueError("Gemini JSON response was not an object")
        return parsed

    def _compact_sources(self, context_sources: list[dict[str, Any]]) -> list[dict[str, Any]]:
        compact: list[dict[str, Any]] = []
        for source in context_sources[:12]:
            files = source.get("files") if isinstance(source.get("files"), list) else []
            compact_files = []
            file_paths: list[str] = []
            for item in files[:10]:
                if not isinstance(item, dict):
                    continue
                file_path = item.get("file_path")
                if file_path:
                    file_paths.append(str(file_path))
                compact_files.append(
                    {
                        "path": file_path,
                        "start_line": item.get("start_line"),
                        "end_line": item.get("end_line"),
                        "confidence": item.get("confidence"),
                    }
                )

            compact.append(
                {
                    "entry_id": str(source.get("entry_id") or ""),
                    "pr_number": source.get("pr_number"),
                    "pr_title": str(source.get("pr_title") or "")[:240],
                    "intent": str(source.get("intent") or "")[:420],
                    "summary": str(source.get("summary") or "")[:720],
                    "file_count": len(file_paths),
                    "sample_files": file_paths[:8],
                    "files": compact_files,
                }
            )
        return compact

    def _response_text(self, response: requests.Response) -> str:
        try:
            return (response.text or "").strip()
        except Exception:
            return ""

    def _is_generation_config_compat_error(self, error_text: str) -> bool:
        lowered = str(error_text or "").lower()
        return (
            "responsemimetype" in lowered
            or "response mime type" in lowered
            or "responseschema" in lowered
            or "unknown field" in lowered
            or "invalid json payload" in lowered
        )

    @retry(
        retry=retry_if_exception_type((requests.RequestException, RetryableAIError)),
        wait=wait_exponential(multiplier=1, min=1, max=10),
        stop=stop_after_attempt(settings.OUTBOUND_RETRY_ATTEMPTS),
    )
    def _call_gemini(
        self,
        prompt: str,
        temperature: float,
        max_output_tokens: int,
        response_mime_type: str | None = None,
    ) -> str:
        if not settings.AI_API_KEY:
            raise RuntimeError("AI_API_KEY missing for Gemini call")

        ai_circuit_breaker.before_request()
        body = {
            "contents": [{"role": "user", "parts": [{"text": prompt}]}],
            "generationConfig": {
                "temperature": temperature,
                "maxOutputTokens": max_output_tokens,
            },
        }
        if response_mime_type:
            body["generationConfig"]["responseMimeType"] = response_mime_type

        model_name = AIService._resolved_model_name or self._normalize_model_name(settings.AI_MODEL)
        try:
            response = requests.post(
                self._gemini_generate_url(model_name),
                json=body,
                timeout=settings.REQUEST_TIMEOUT_SECONDS,
            )
        except requests.RequestException:
            ai_circuit_breaker.record_failure()
            raise

        if response.status_code == 404:
            discovered_model = self._discover_supported_model()
            if discovered_model and discovered_model != model_name:
                logger.warning(
                    "Configured model '%s' not found. Switching Gemini model to '%s'.",
                    model_name,
                    discovered_model,
                )
                model_name = discovered_model
                try:
                    response = requests.post(
                        self._gemini_generate_url(model_name),
                        json=body,
                        timeout=settings.REQUEST_TIMEOUT_SECONDS,
                    )
                except requests.RequestException:
                    ai_circuit_breaker.record_failure()
                    raise

        # Compatibility fallback for models/endpoints that reject JSON output hints.
        if response.status_code == 400 and response_mime_type:
            raw_error = self._response_text(response)
            if self._is_generation_config_compat_error(raw_error):
                logger.warning(
                    "Gemini request rejected responseMimeType on model '%s'; retrying without responseMimeType.",
                    model_name,
                )
                body_without_mime = {
                    "contents": body.get("contents"),
                    "generationConfig": {
                        "temperature": temperature,
                        "maxOutputTokens": max_output_tokens,
                    },
                }
                try:
                    response = requests.post(
                        self._gemini_generate_url(model_name),
                        json=body_without_mime,
                        timeout=settings.REQUEST_TIMEOUT_SECONDS,
                    )
                except requests.RequestException:
                    ai_circuit_breaker.record_failure()
                    raise

        if response.status_code in {429, 500, 502, 503, 504}:
            ai_circuit_breaker.record_failure()
            raise RetryableAIError(f"Retryable Gemini API error: {response.status_code}")

        if response.status_code >= 400:
            error_message = f"Gemini API error (HTTP {response.status_code})"
            raw_error = self._response_text(response)
            if raw_error:
                error_message = f"{error_message}: {raw_error[:300]}"

            if response.status_code in {401, 403}:
                AIService._gemini_disabled_reason = error_message
                logger.error("Disabling Gemini for this process. Reason: %s", error_message)

            raise RuntimeError(error_message)

        ai_circuit_breaker.record_success()
        AIService._resolved_model_name = model_name
        data = response.json()
        candidates = data.get("candidates") if isinstance(data, dict) else []
        parts = (
            candidates[0].get("content", {}).get("parts", [])
            if isinstance(candidates, list) and candidates and isinstance(candidates[0], dict)
            else []
        )
        text_chunks = []
        if isinstance(parts, list):
            for part in parts:
                if not isinstance(part, dict):
                    continue
                chunk = part.get("text")
                if chunk:
                    text_chunks.append(str(chunk))
        text = "\n".join(text_chunks).strip()
        if not text:
            raise ValueError("Gemini returned empty text response")
        return text

    def _can_use_gemini(self) -> bool:
        if not self._gemini_enabled:
            return False
        if AIService._gemini_disabled_reason:
            logger.debug("Gemini disabled for this process: %s", AIService._gemini_disabled_reason)
            return False
        return True

    def _gemini_generate_url(self, model_name: str) -> str:
        return (
            "https://generativelanguage.googleapis.com/v1beta/models/"
            f"{model_name}:generateContent?key={settings.AI_API_KEY}"
        )

    def _normalize_model_name(self, model_name: str) -> str:
        cleaned = (model_name or "").strip()
        if cleaned.startswith("models/"):
            return cleaned[len("models/") :]
        return cleaned

    def _discover_supported_model(self) -> str | None:
        if AIService._model_discovery_attempted:
            return AIService._resolved_model_name

        AIService._model_discovery_attempted = True
        url = f"https://generativelanguage.googleapis.com/v1beta/models?key={settings.AI_API_KEY}"
        try:
            response = requests.get(url, timeout=settings.REQUEST_TIMEOUT_SECONDS)
        except requests.RequestException as exc:
            logger.warning("Unable to discover Gemini models: %s", exc)
            ai_circuit_breaker.record_failure()
            return None
        if response.status_code >= 400:
            logger.warning("Unable to discover Gemini models (HTTP %s).", response.status_code)
            if response.status_code in {429, 500, 502, 503, 504}:
                ai_circuit_breaker.record_failure()
            return None

        models = response.json().get("models", [])
        candidates: list[str] = []
        for model in models:
            methods = model.get("supportedGenerationMethods") or []
            if "generateContent" not in methods:
                continue
            raw_name = str(model.get("name") or "")
            if not raw_name:
                continue
            candidates.append(self._normalize_model_name(raw_name))

        if not candidates:
            return None

        preferred_prefixes = (
            "gemini-2.5-flash",
            "gemini-2.0-flash",
            "gemini-1.5-flash",
            "gemini-1.5-pro",
        )
        for prefix in preferred_prefixes:
            for candidate in candidates:
                if candidate.startswith(prefix):
                    AIService._resolved_model_name = candidate
                    return candidate

        AIService._resolved_model_name = candidates[0]
        return candidates[0]

    def _fallback_summary(self, pr_payload: dict[str, Any]) -> dict[str, Any]:
        title = str(pr_payload.get("title") or "Untitled PR").strip()
        body = str(pr_payload.get("body") or "").strip()
        file_changes = self._extract_pr_file_changes(pr_payload)
        stats = self._collect_change_stats(pr_payload, file_changes)
        file_paths = [str(item.get("filename") or "").strip() for item in file_changes if item.get("filename")]
        focus_areas = self._infer_focus_areas(file_paths)
        language_tags = self._infer_language_tags(file_paths)
        commits = pr_payload.get("commits") if isinstance(pr_payload.get("commits"), list) else []
        comments = pr_payload.get("comments") if isinstance(pr_payload.get("comments"), list) else []
        reviews = pr_payload.get("reviews") if isinstance(pr_payload.get("reviews"), list) else []
        non_empty_commits = [str(item).strip() for item in commits if str(item).strip()]
        discussion_count = len([item for item in comments if str(item).strip()]) + len(
            [item for item in reviews if str(item).strip()]
        )

        file_count = int(stats.get("file_count") or 0)
        additions = int(stats.get("additions") or 0)
        deletions = int(stats.get("deletions") or 0)
        renamed_files = int(stats.get("renamed_files") or 0)
        removed_files = int(stats.get("removed_files") or 0)

        summary_parts: list[str] = []
        if file_count > 0:
            summary_parts.append(
                f"PR #{pr_payload.get('number') or '?'} updates {file_count} files with about {additions} additions and {deletions} deletions."
            )
            if focus_areas:
                summary_parts.append(f"Most changes are concentrated in {', '.join(focus_areas[:3])}.")
            if body:
                summary_parts.append(f"PR description context: {body[:260]}")
            elif non_empty_commits:
                summary_parts.append(f"Commit intent hints include: {non_empty_commits[0][:220]}")
            else:
                summary_parts.append("Intent is inferred directly from code changes because PR discussion text is limited.")
        elif body:
            summary_parts.append(body[:450])
        elif title:
            summary_parts.append(f"PR '{title[:160]}' has limited metadata and no detected file diff context.")
        else:
            summary_parts.append("Insufficient PR metadata was available to infer intent.")

        intent = self._suggest_intent_from_code(pr_payload, file_changes, focus_areas)[:700]

        decisions: list[str] = []
        if file_count > 0:
            decisions.append(f"Code-change summary based on {file_count} changed files.")
            if renamed_files:
                decisions.append(f"{renamed_files} files were renamed as part of the refactor scope.")
            top_files = [path for path in file_paths[:3] if path]
            if top_files:
                decisions.append(f"Primary touched files: {', '.join(top_files)}.")
        if non_empty_commits:
            decisions.append(f"{len(non_empty_commits)} commit messages were used as intent evidence.")
        if not decisions:
            decisions.append("Fallback summary generated from available PR metadata.")

        risks: list[str] = []
        if deletions > max(additions * 2, 250):
            risks.append("High deletion volume may indicate behavior removal; validate downstream dependencies.")
        if removed_files > 0:
            risks.append("File removals detected; verify imports and references remain valid.")
        if discussion_count == 0:
            risks.append("PR discussion context is minimal; conclusions rely primarily on code diff evidence.")

        tags: list[str] = []
        for raw_tag in ["fallback", *language_tags, *focus_areas[:3], "code-intent"]:
            cleaned = self._sanitize_tag(str(raw_tag))
            if not cleaned or cleaned in tags:
                continue
            tags.append(cleaned)
            if len(tags) >= 12:
                break

        return {
            "summary": " ".join(summary_parts)[:1200],
            "intent": intent,
            "decisions": decisions[:12],
            "risks": risks[:12],
            "tags": tags or ["fallback", "code-intent"],
        }

    def _fallback_chat_payload(
        self,
        query: str,
        context_sources: list[dict[str, Any]],
        repo_overview_context: dict[str, Any] | None,
        fallback_reason: str = "ai_provider_unavailable",
    ) -> dict[str, Any]:
        query_text = str(query or "")
        query_lower = query_text.lower()
        query_terms = set(token.lower() for token in _WORD_RE.findall(query_text))
        general_query = _looks_general_query(query, context_sources, repo_overview_context)
        action_query = any(
            phrase in query_lower
            for phrase in ("what did", "what changed", "changes in", "changed in", "how did")
        )
        overview_query = any(
            phrase in query_lower
            for phrase in (
                "explain entire repo",
                "explain the entire repo",
                "repo overview",
                "project overview",
                "full repo overview",
                "explain repository",
                "entire repo",
                "whole repo",
            )
        )

        scored: list[tuple[int, dict[str, Any]]] = []
        for source in context_sources:
            haystack = " ".join(str(source.get(key) or "") for key in ("pr_title", "intent", "summary")).lower()
            file_terms = " ".join(
                str(item.get("file_path") or "")
                for item in (source.get("files") or [])
                if isinstance(item, dict)
            ).lower()
            score = sum(term in haystack for term in query_terms) + sum(term in file_terms for term in query_terms)
            scored.append((score, source))

        ranked = [source for _, source in sorted(scored, key=lambda item: item[0], reverse=True)]
        top = ranked[:4]
        prefer_code_refs = self._query_prefers_code_references(query)
        code_refs = self._post_process_code_references(self._default_code_references(top)) if prefer_code_refs else []
        repo_context = repo_overview_context if isinstance(repo_overview_context, dict) else {}

        if general_query and not context_sources and not repo_context:
            structured = {
                "title": "General Engineering Answer",
                "summary": "General guidance generated without repository-specific evidence.",
                "sections": [
                    {
                        "heading": "Guidance",
                        "bullets": [
                            "This response covers the general engineering concept asked in your question.",
                            "For repository-specific recommendations, ask with repo/PR/file context.",
                        ],
                    }
                ],
                "code_references": [],
                "timeline_highlights": [],
                "limitations": ["Repository evidence was not available in this response."],
            }
            return {"answer": self._format_structured_answer(structured), "structured": structured}

        sections: list[dict[str, Any]] = []
        for source in top[:3]:
            pr_number = source.get("pr_number") or "?"
            title = str(source.get("pr_title") or "Untitled PR")
            intent = str(source.get("intent") or source.get("summary") or "").strip()
            file_paths = self._source_file_paths(source)
            if (not intent or self._contains_no_file_claim(intent)) and file_paths:
                intent = (
                    f"This PR touches {len(file_paths)} indexed files."
                    f" Key files: {', '.join(file_paths[:3])}."
                )
            if not intent:
                intent = "No intent summary available."
            bullets: list[str] = []
            if file_paths and action_query:
                preview = file_paths[:3] if prefer_code_refs else [self._file_name_from_path(path) for path in file_paths[:3]]
                bullets.append(f"Changed {len(file_paths)} files including {', '.join(preview)}.")
            bullets.append(intent[:230])
            sections.append({"heading": f"PR #{pr_number} - {title[:70]}", "bullets": bullets[:4]})

        if repo_context:
            repository = repo_context.get("repository") if isinstance(repo_context.get("repository"), dict) else {}
            stats = repo_context.get("stats") or {}
            repo_name = str(repository.get("full_name") or "Unknown repository")
            sections.insert(
                0,
                {
                    "heading": "Repository Snapshot",
                    "bullets": [
                        f"Repository: {repo_name}",
                        f"Pull requests indexed: {stats.get('total_prs', 0)}",
                        f"Contributors seen: {stats.get('contributors', 0)}",
                    ],
                },
            )

            technology_rows = (
                (repo_context.get("live_inventory") or {}).get("technologies")
                if isinstance(repo_context.get("live_inventory"), dict)
                else None
            ) or repo_context.get("technologies")
            if isinstance(technology_rows, list) and technology_rows:
                tech_bullets = []
                for row in technology_rows[:5]:
                    if not isinstance(row, dict):
                        continue
                    technology = str(row.get("technology") or "").strip()
                    file_count = int(row.get("file_count") or 0)
                    if technology:
                        tech_bullets.append(f"{technology}: {file_count} files")
                if tech_bullets:
                    sections.append({"heading": "Primary Technologies", "bullets": tech_bullets})

            top_directories = (
                (repo_context.get("live_inventory") or {}).get("top_directories")
                if isinstance(repo_context.get("live_inventory"), dict)
                else None
            ) or repo_context.get("top_directories")
            if isinstance(top_directories, list) and top_directories:
                dir_bullets = []
                for row in top_directories[:5]:
                    if not isinstance(row, dict):
                        continue
                    directory = str(row.get("directory") or "").strip()
                    file_count = int(row.get("file_count") or 0)
                    if directory:
                        dir_bullets.append(f"{directory}: {file_count} files")
                if dir_bullets:
                    sections.append({"heading": "Top Directories", "bullets": dir_bullets})

            contributor_rows = repo_context.get("contributors")
            if isinstance(contributor_rows, list) and contributor_rows:
                contributor_bullets = []
                for row in contributor_rows[:5]:
                    if not isinstance(row, dict):
                        continue
                    author = str(row.get("author_login") or "").strip()
                    pr_count = int(row.get("pr_count") or 0)
                    if author:
                        contributor_bullets.append(f"{author}: {pr_count} PRs")
                if contributor_bullets:
                    sections.append({"heading": "Top Contributors", "bullets": contributor_bullets})

            recent_prs = repo_context.get("recent_prs")
            if isinstance(recent_prs, list) and recent_prs:
                recent_pr_bullets = []
                for row in recent_prs[:4]:
                    if not isinstance(row, dict):
                        continue
                    pr_number = row.get("github_pr_number")
                    title = str(row.get("title") or "Untitled PR").strip()
                    state = str(row.get("state") or "unknown").strip()
                    recent_pr_bullets.append(f"PR #{pr_number or '?'} ({state}): {title[:140]}")
                if recent_pr_bullets:
                    sections.append({"heading": "Recent Pull Requests", "bullets": recent_pr_bullets})

            if prefer_code_refs and not code_refs:
                top_files = repo_context.get("top_files")
                if isinstance(top_files, list):
                    for row in top_files[:8]:
                        if not isinstance(row, dict):
                            continue
                        file_path = str(row.get("file_path") or "").strip()
                        if not file_path:
                            continue
                        change_count = int(row.get("change_count") or 0)
                        code_refs.append(
                            {
                                "file_path": file_path[:260],
                                "start_line": None,
                                "end_line": None,
                                "pr_number": None,
                                "note": f"Referenced in {change_count} indexed change(s).",
                            }
                        )

        if not sections:
            sections = [
                {
                    "heading": "Context Availability",
                    "bullets": [
                        "No indexed PR context is available yet for this repository.",
                        "Run sync and try again.",
                    ],
                }
            ]

        if top and not repo_context:
            first_pr = top[0]
            first_pr_number = first_pr.get("pr_number") or "?"
            first_pr_title = str(first_pr.get("pr_title") or "Pull Request").strip()
            default_title = f"{first_pr_title[:90]} PR"
            summary_text = f"PR #{first_pr_number} summary based on indexed pull-request context."
        else:
            default_title = "Repository Overview" if overview_query or repo_context else "Answer"
            fallback_summary_map = {
                "ai_provider_unavailable": "Answer generated from indexed repository context.",
                "structured_parse_failed": "Answer generated from indexed repository context.",
                "insufficient_context": "Answer generated from available indexed repository context.",
            }
            summary_text = fallback_summary_map.get(
                fallback_reason,
                "Response generated from indexed repository metadata.",
            )

        timeline_highlights: list[dict[str, str]] = []
        monthly_activity = repo_context.get("monthly_activity")
        if isinstance(monthly_activity, list):
            for item in monthly_activity[-6:]:
                if not isinstance(item, dict):
                    continue
                month = str(item.get("month") or "").strip()
                pr_count = int(item.get("pr_count") or 0)
                merged_count = int(item.get("merged_count") or 0)
                if month:
                    timeline_highlights.append(
                        {
                            "label": month,
                            "detail": f"{pr_count} PRs, {merged_count} merged",
                        }
                    )

        limitations: list[str] = []
        if fallback_reason == "insufficient_context":
            limitations.append("Indexed context is still limited for this repository.")
        elif prefer_code_refs:
            limitations.append("Line-level citations are limited when source mappings are incomplete.")

        structured = {
            "title": default_title,
            "summary": summary_text,
            "sections": sections,
            "code_references": code_refs,
            "timeline_highlights": timeline_highlights,
            "limitations": limitations,
        }
        return {"answer": self._format_structured_answer(structured), "structured": structured}
