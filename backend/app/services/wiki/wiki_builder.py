"""Wiki builder — extracts wiki pages from documents and merges new info into existing pages.

Two LLM calls:
  1. extract_pages(): Document text → list of new wiki page dicts
  2. merge_page_content(): Existing page content + new passages → updated content
"""
from __future__ import annotations

import json
import logging
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from app.services.llm.provider import LLMProvider

logger = logging.getLogger(__name__)

_WIKI_MAX_PAGES = 100     # Hard cap per KB to control LLM costs
_EXTRACT_MAX_CHARS = 10_000  # Truncate doc text for extraction prompt

_EXTRACT_SYSTEM_PROMPT = """\
You are a knowledge base curator. Analyze the provided document and extract wiki-style pages \
for the most important entities, concepts, processes, and topics it covers.

For each page return exactly these fields:
- title: Clear, concise canonical title (e.g. "Machine Learning", not "ML"). This is the \
unique merge key — use consistent naming.
- page_type: one of "entity", "concept", "process", "event", "general"
- summary: 1–2 sentence description (used as a search index)
- content: 3–6 paragraph markdown explanation with ## subheadings where helpful
- related_titles: list of other page titles defined in this same response that this topic \
links to (use the exact title strings you defined)

Return ONLY valid JSON in this format:
{"pages": [{"title": "...", "page_type": "...", "summary": "...", "content": "...", "related_titles": [...]}]}

Extract between 3 and 15 pages. Prefer quality over quantity.\
"""

_MERGE_SYSTEM_PROMPT = """\
You are updating a wiki page with new information from a document.

Rules:
- Preserve all accurate existing information
- Integrate new facts, examples, and context naturally into the markdown structure
- If new information contradicts existing content, add a blockquote note:
  > ⚠️ **Conflict**: [brief description of the contradiction]
- Keep the page well-organized with ## markdown subheadings
- Return ONLY the updated markdown content — no explanation, no JSON wrapper\
"""


async def extract_pages(provider: "LLMProvider", text: str, filename: str) -> list[dict]:
    """
    Send document text to the LLM and extract structured wiki page dicts.

    Returns a list of dicts with keys: title, page_type, summary, content, related_titles.
    Returns [] on any failure — callers should handle an empty list gracefully.
    """
    truncated = text[:_EXTRACT_MAX_CHARS]
    messages = [
        {
            "role": "user",
            "content": f"Document: {filename}\n\n{truncated}",
        }
    ]
    try:
        response = await provider.complete(messages, system_prompt=_EXTRACT_SYSTEM_PROMPT)
        return _parse_pages_json(response.content)
    except Exception as exc:
        logger.warning("Wiki page extraction failed", extra={"doc_filename": filename, "error": str(exc)})
        return []


async def merge_page_content(
    provider: "LLMProvider",
    existing_content: str,
    new_passages: str,
) -> str:
    """
    Ask the LLM to merge new document passages into an existing wiki page.

    Returns the updated markdown content string.
    Falls back to existing_content unchanged if the LLM call fails.
    """
    messages = [
        {
            "role": "user",
            "content": f"EXISTING PAGE:\n{existing_content}\n\nNEW INFORMATION:\n{new_passages}",
        }
    ]
    try:
        response = await provider.complete(messages, system_prompt=_MERGE_SYSTEM_PROMPT)
        merged = response.content.strip()
        # Strip any accidental markdown fences the LLM may add
        if merged.startswith("```"):
            lines = merged.split("\n")
            merged = "\n".join(lines[1:-1] if lines[-1].startswith("```") else lines[1:])
        return merged or existing_content
    except Exception as exc:
        logger.warning("Wiki page merge failed", extra={"error": str(exc)})
        return existing_content


def _parse_pages_json(raw: str) -> list[dict]:
    """Parse LLM response containing JSON wiki pages. Returns [] on any error."""
    try:
        content = raw.strip()
        # Strip markdown code fences if present
        if content.startswith("```"):
            lines = content.split("\n")
            content = "\n".join(lines[1:-1] if lines[-1].startswith("```") else lines[1:])
            if content.startswith("json"):
                content = content[4:]

        data = json.loads(content)
        pages = data.get("pages", [])
        if not isinstance(pages, list):
            logger.warning("Wiki extraction: 'pages' is not a list")
            return []

        validated = []
        for p in pages:
            if not isinstance(p, dict):
                continue
            title = str(p.get("title", "")).strip()
            content_text = str(p.get("content", "")).strip()
            if not title or not content_text:
                continue
            validated.append({
                "title": title,
                "page_type": str(p.get("page_type", "general")).strip(),
                "summary": str(p.get("summary", "")).strip(),
                "content": content_text,
                "related_titles": [str(t) for t in p.get("related_titles", []) if t],
            })
        return validated

    except (json.JSONDecodeError, KeyError, TypeError) as exc:
        logger.warning("Wiki page JSON parse failed", extra={"error": str(exc)})
        return []
