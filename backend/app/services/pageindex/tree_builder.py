"""PageIndex tree builder — integrates document extraction with LLM tree generation."""
from __future__ import annotations

import json
import logging
import uuid
from typing import Any

from app.services.document.extractor import extract_text
from app.services.llm.provider import LLMProvider

logger = logging.getLogger(__name__)

_PAGEINDEX_SYSTEM_PROMPT = """You are a document structure analyzer implementing the PageIndex algorithm.
Given document text, produce a hierarchical JSON tree representing the document's structure.

Each node MUST have exactly these fields:
- node_id: unique string identifier (e.g. "n1", "n1.1", "n1.1.2")
- title: descriptive section title (string)
- page_start: starting page number (integer, 1-indexed)
- page_end: ending page number (integer, >= page_start)
- depth: nesting depth (integer, 1 = top-level chapter)
- text: raw section text excerpt (string, may be truncated)
- children: array of child nodes (same schema, empty array if leaf)

Return a JSON object with:
- doc_id: document identifier (string)
- title: document title (string)
- nodes: array of top-level nodes

Return ONLY valid JSON with no explanation, no markdown fences."""


def _parse_tree_response(content: str, filename: str, fallback_text: str) -> dict:
    """Parse LLM response into tree JSON, with fallback on parse failure."""
    raw = content.strip()
    # Strip markdown code fences if present
    if raw.startswith("```"):
        parts = raw.split("```")
        raw = parts[1] if len(parts) > 1 else raw
        if raw.startswith("json"):
            raw = raw[4:]
        raw = raw.strip()

    try:
        tree = json.loads(raw)
        # Validate minimal structure
        if "nodes" in tree and isinstance(tree["nodes"], list):
            return tree
    except (json.JSONDecodeError, ValueError):
        pass

    logger.warning("Failed to parse LLM tree response, using fallback", extra={"doc_filename": filename})
    return _fallback_tree(filename, fallback_text)


def _fallback_tree(filename: str, text: str) -> dict:
    """Minimal single-node tree used when LLM response cannot be parsed."""
    return {
        "doc_id": str(uuid.uuid4()),
        "title": filename,
        "nodes": [
            {
                "node_id": "n1",
                "title": "Full Document",
                "page_start": 1,
                "page_end": 1,
                "depth": 1,
                "text": text[:1000],
                "children": [],
            }
        ],
    }


def count_nodes(tree: dict) -> int:
    """Recursively count all nodes in a tree."""
    def _count(nodes: list) -> int:
        total = 0
        for node in nodes:
            total += 1
            total += _count(node.get("children", []))
        return total

    return _count(tree.get("nodes", []))


def max_depth(tree: dict) -> int:
    """Return the maximum depth of any node in the tree."""
    def _depth(nodes: list) -> int:
        if not nodes:
            return 0
        return max(
            node.get("depth", 1) + _depth(node.get("children", []))
            for node in nodes
        )

    return _depth(tree.get("nodes", []))


def collect_node_ids(tree: dict) -> list[str]:
    """Collect all node_ids from a tree (depth-first)."""
    ids: list[str] = []

    def _collect(nodes: list) -> None:
        for node in nodes:
            ids.append(node["node_id"])
            _collect(node.get("children", []))

    _collect(tree.get("nodes", []))
    return ids


async def build_tree(
    file_path: str,
    file_type: str,
    filename: str,
    llm: LLMProvider,
    doc_id: str | None = None,
) -> dict:
    """
    Extract text from a document and generate a PageIndex hierarchical tree via LLM.

    Args:
        file_path: Path to the document file on disk.
        file_type: One of "pdf", "docx", "txt", "md".
        filename: Original filename (used in prompts and fallback).
        llm: LLMProvider instance to use for tree generation.
        doc_id: Optional document UUID to embed in the tree root.

    Returns:
        Tree dict matching the PageIndex node schema.
    """
    text = extract_text(file_path, file_type)

    messages = [
        {
            "role": "user",
            "content": (
                f"Document filename: {filename}\n\n"
                f"{text[:8000]}"  # truncate to stay within token limits
            ),
        }
    ]

    response = await llm.complete(messages, system_prompt=_PAGEINDEX_SYSTEM_PROMPT)
    tree = _parse_tree_response(response.content, filename, text)

    # Embed doc_id in tree root
    if doc_id:
        tree["doc_id"] = doc_id

    return tree
