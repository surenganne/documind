"""PageIndex tree navigator — LLM-driven reasoning over document trees to select relevant nodes."""
from __future__ import annotations

import json
import logging
import uuid
from dataclasses import dataclass, field
from typing import Any

from app.services.llm.provider import LLMProvider

logger = logging.getLogger(__name__)

_NAVIGATION_SYSTEM_PROMPT = """You are a document navigation expert implementing the PageIndex algorithm.
Given a list of document sections and a user query, identify the most relevant sections to answer the query.

Each section is shown as: node_id=<doc_uuid>::<section_id> | <title> (pp.X-Y): <text excerpt>

Return a JSON object with:
- selected_node_ids: array of node_id strings EXACTLY as shown (e.g. "abc-123::2.0"), most relevant first, max 10
- rationale: object mapping each node_id to a brief explanation
- confidence: float 0.0-1.0

IMPORTANT: Use the FULL node_id value including the :: separator exactly as shown. Do NOT use just the doc UUID.
Return ONLY valid JSON with no explanation, no markdown fences."""


@dataclass
class NavigationResult:
    selected_node_ids: list[str]
    rationale: dict[str, str]
    confidence: float


def prefix_node_ids(tree: dict, doc_id: str) -> dict:
    """
    Return a copy of the tree with all node_ids prefixed as '{doc_id}::{node_id}'.
    Used when merging trees from multiple documents to prevent ID collisions.
    """
    import copy
    tree_copy = copy.deepcopy(tree)
    tree_copy["doc_id"] = doc_id

    def _prefix(nodes: list) -> None:
        for node in nodes:
            node["node_id"] = f"{doc_id}::{node['node_id']}"
            _prefix(node.get("children", []))

    _prefix(tree_copy.get("nodes", []))
    return tree_copy


def merge_trees(trees: list[tuple[str, dict]]) -> dict:
    """
    Merge multiple document trees into a single tree.
    Each tree's node IDs are prefixed with its doc_id to prevent collisions.

    Args:
        trees: List of (doc_id, tree_dict) tuples.

    Returns:
        Merged tree dict with all nodes under a single root.
    """
    merged_nodes: list[dict] = []

    for doc_id, tree in trees:
        prefixed = prefix_node_ids(tree, doc_id)
        merged_nodes.extend(prefixed.get("nodes", []))

    return {
        "doc_id": "merged",
        "title": "Merged Document Collection",
        "nodes": merged_nodes,
    }


def _tree_to_toc_summary(tree: dict, max_nodes: int = 50) -> str:
    """Convert a tree to a compact table-of-contents string for the LLM prompt."""
    lines: list[str] = [f"Document: {tree.get('title', 'Unknown')}"]
    count = 0

    def _format(nodes: list, indent: int = 0) -> None:
        nonlocal count
        for node in nodes:
            if count >= max_nodes:
                return
            prefix = "  " * indent
            lines.append(
                f"{prefix}[{node['node_id']}] {node['title']} "
                f"(pp.{node.get('page_start', '?')}-{node.get('page_end', '?')}): "
                f"{node.get('text', '')[:100]}"
            )
            count += 1
            _format(node.get("children", []), indent + 1)

    _format(tree.get("nodes", []))
    return "\n".join(lines)


def _get_tree_nodes(tree: dict) -> list:
    """
    Get top-level nodes from a tree dict.
    Handles both {'nodes': [...]} format and root-node-with-children format.
    """
    if "nodes" in tree:
        return tree["nodes"]
    # Tree IS the root node — its children are the sections
    if "children" in tree:
        return tree["children"]
    return []


def _trees_to_toc_summary(trees: list[tuple[str, dict]], max_nodes_per_doc: int = 20) -> str:
    """
    Build a TOC summary across multiple documents.
    Each document gets up to max_nodes_per_doc nodes to ensure all docs are represented.
    Node IDs are shown as doc_id::node_id so the LLM returns prefixed IDs.
    """
    parts: list[str] = []
    for doc_id, tree in trees:
        doc_title = tree.get('title', doc_id)
        lines: list[str] = [f"\n=== {doc_title} ==="]
        count = 0

        def _format(nodes: list, indent: int = 0, _did: str = doc_id) -> None:
            nonlocal count
            for node in nodes:
                if count >= max_nodes_per_doc:
                    return
                prefix = "  " * indent
                prefixed_id = f"{_did}::{node['node_id']}"
                lines.append(
                    f"{prefix}node_id={prefixed_id} | {node['title']} "
                    f"(pp.{node.get('page_start', '?')}-{node.get('page_end', '?')}): "
                    f"{node.get('text', '')[:120]}"
                )
                count += 1
                _format(node.get("children", []), indent + 1, _did)

        _format(_get_tree_nodes(tree))
        parts.append("\n".join(lines))

    return "\n".join(parts)


def _parse_navigation_response(content: str) -> NavigationResult:
    """Parse LLM navigation response into a NavigationResult."""
    raw = content.strip()
    if raw.startswith("```"):
        parts = raw.split("```")
        raw = parts[1] if len(parts) > 1 else raw
        if raw.startswith("json"):
            raw = raw[4:]
        raw = raw.strip()

    try:
        data = json.loads(raw)
        return NavigationResult(
            selected_node_ids=data.get("selected_node_ids", []),
            rationale=data.get("rationale", {}),
            confidence=float(data.get("confidence", 0.5)),
        )
    except (json.JSONDecodeError, ValueError, TypeError):
        logger.warning("Failed to parse navigation response")
        return NavigationResult(selected_node_ids=[], rationale={}, confidence=0.0)


def collect_node_ids_from_merged(tree: dict) -> list[str]:
    """Collect all node IDs from a (potentially merged) tree."""
    ids: list[str] = []

    def _collect(nodes: list) -> None:
        for node in nodes:
            ids.append(node["node_id"])
            _collect(node.get("children", []))

    _collect(tree.get("nodes", []))
    return ids


async def navigate(
    query: str,
    trees: list[tuple[str, dict]],
    llm: LLMProvider,
) -> NavigationResult:
    """
    Use LLM reasoning to select relevant tree nodes for a given query.

    Args:
        query: The user's question.
        trees: List of (doc_id, tree_dict) tuples for all ready documents in the KB.
        llm: LLMProvider instance.

    Returns:
        NavigationResult with selected node IDs (prefixed as doc_id::node_id), rationale, and confidence.
    """
    if not trees:
        return NavigationResult(selected_node_ids=[], rationale={}, confidence=0.0)

    # Build per-document TOC so every doc is represented regardless of count
    toc_summary = _trees_to_toc_summary(trees, max_nodes_per_doc=15)

    messages = [
        {
            "role": "user",
            "content": (
                f"User query: {query}\n\n"
                f"Available document sections:\n{toc_summary}"
            ),
        }
    ]

    response = await llm.complete(messages, system_prompt=_NAVIGATION_SYSTEM_PROMPT)
    result = _parse_navigation_response(response.content)
    logger.info(
        "Navigation result",
        extra={"node_ids": result.selected_node_ids, "confidence": result.confidence, "raw": response.content[:500]}
    )
    return result
