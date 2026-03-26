"""Chat session and message API endpoints with PageIndex pipeline."""
from __future__ import annotations

import json
import logging
import time
import uuid
from typing import AsyncIterator

from fastapi import APIRouter, Depends, HTTPException, Query, WebSocket, WebSocketDisconnect, status
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.database import get_db
from app.core.security import decode_token, get_current_user
from app.models.audit_log import AuditLog
from app.models.chat_message import ChatMessage
from app.models.chat_session import ChatSession
from app.models.document import Document, DocumentStatus
from app.models.document_tree import DocumentTree
from app.models.knowledge_base import KnowledgeBase
from app.models.user import User
from app.schemas.chat import ChatMessageCreate, ChatMessageOut, ChatSessionCreate, ChatSessionOut
from app.services.llm.bedrock import BedrockProvider
from app.services.pageindex.answer_generator import generate_answer, stream_answer
from app.services.pageindex.trace_logger import build_trace
from app.services.pageindex.tree_navigator import navigate

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/chat", tags=["chat"])

# Simple in-memory rate limiter: {user_id: [timestamps]}
_rate_limit_store: dict[str, list[float]] = {}
_RATE_WINDOW_SECONDS = 60


def _check_rate_limit(user_id: str) -> None:
    """Raise HTTP 429 if user exceeds rate limit."""
    now = time.time()
    window_start = now - _RATE_WINDOW_SECONDS
    timestamps = _rate_limit_store.get(user_id, [])
    # Prune old timestamps
    timestamps = [t for t in timestamps if t > window_start]
    if len(timestamps) >= settings.rate_limit_per_minute:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Rate limit exceeded. Please slow down.",
        )
    timestamps.append(now)
    _rate_limit_store[user_id] = timestamps


async def _get_kb_or_403(kb_id: uuid.UUID, workspace_id: uuid.UUID, db: AsyncSession) -> KnowledgeBase:
    result = await db.execute(
        select(KnowledgeBase).where(
            KnowledgeBase.id == kb_id,
            KnowledgeBase.workspace_id == workspace_id,
        )
    )
    kb = result.scalar_one_or_none()
    if kb is None:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="KnowledgeBase not found in workspace")
    return kb


async def _get_session_or_403(
    session_id: uuid.UUID, workspace_id: uuid.UUID, db: AsyncSession
) -> ChatSession:
    result = await db.execute(
        select(ChatSession).where(
            ChatSession.id == session_id,
            ChatSession.workspace_id == workspace_id,
        )
    )
    session = result.scalar_one_or_none()
    if session is None:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Session not found")
    return session


async def _load_kb_trees(kb_id: uuid.UUID, db: AsyncSession) -> list[tuple[str, str, dict]]:
    """Load all ready document trees for a KB. Returns (doc_id, filename, tree_json) tuples."""
    result = await db.execute(
        select(Document, DocumentTree)
        .join(DocumentTree, DocumentTree.document_id == Document.id)
        .where(
            Document.kb_id == kb_id,
            Document.status == DocumentStatus.ready,
        )
    )
    rows = result.all()
    return [(str(doc.id), doc.filename, tree.tree_json) for doc, tree in rows]


async def _add_audit_log(
    db: AsyncSession,
    user_id: uuid.UUID,
    action: str,
    resource_type: str,
    resource_id: uuid.UUID,
    metadata: dict | None = None,
) -> None:
    log = AuditLog(
        user_id=user_id,
        action=action,
        resource_type=resource_type,
        resource_id=resource_id,
        log_metadata=metadata or {},
    )
    db.add(log)


# ── POST /chat/sessions ───────────────────────────────────────────────────────

@router.post("/sessions", status_code=status.HTTP_201_CREATED, response_model=ChatSessionOut)
async def create_session(
    body: ChatSessionCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Create a new chat session linked to a KnowledgeBase."""
    await _get_kb_or_403(body.kb_id, current_user.workspace_id, db)

    title = body.title or f"Session {uuid.uuid4().hex[:8]}"
    session = ChatSession(
        workspace_id=current_user.workspace_id,
        kb_id=body.kb_id,
        user_id=current_user.id,
        title=title,
    )
    db.add(session)
    await db.commit()
    await db.refresh(session)

    logger.info("Chat session created", extra={"session_id": str(session.id)})
    return session


# ── GET /chat/sessions ────────────────────────────────────────────────────────

@router.get("/sessions", response_model=list[ChatSessionOut])
async def list_sessions(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """List all chat sessions for the current user."""
    result = await db.execute(
        select(ChatSession)
        .where(
            ChatSession.workspace_id == current_user.workspace_id,
            ChatSession.user_id == current_user.id,
        )
        .order_by(ChatSession.created_at.desc())
    )
    return result.scalars().all()


# ── POST /chat/sessions/{id}/messages ─────────────────────────────────────────

@router.post("/sessions/{session_id}/messages")
async def send_message(
    session_id: uuid.UUID,
    body: ChatMessageCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Send a user message and receive a streamed SSE response.
    Runs the full PageIndex pipeline: tree_navigator → answer_generator → trace_logger.
    """
    _check_rate_limit(str(current_user.id))

    session = await _get_session_or_403(session_id, current_user.workspace_id, db)

    # Store user message
    user_msg = ChatMessage(
        session_id=session_id,
        role="user",
        content=body.content,
    )
    db.add(user_msg)
    await db.commit()
    await db.refresh(user_msg)

    # Audit log for chat query
    await _add_audit_log(db, current_user.id, "chat.query", "chat_session", session_id)
    await db.commit()

    # Load message history for multi-turn context
    history_result = await db.execute(
        select(ChatMessage)
        .where(ChatMessage.session_id == session_id)
        .order_by(ChatMessage.created_at.asc())
    )
    history = [
        {"role": m.role, "content": m.content}
        for m in history_result.scalars().all()
        if m.id != user_msg.id
    ]

    # Load document trees for the KB
    trees = await _load_kb_trees(session.kb_id, db)

    # Run tree navigation
    llm = BedrockProvider()
    nav_trees = [(doc_id, tree) for doc_id, _, tree in trees]
    nav_result = await navigate(body.content, nav_trees, llm)

    # Build trace
    trace = build_trace(
        query=body.content,
        selected_node_ids=nav_result.selected_node_ids,
        rationale=nav_result.rationale,
        confidence=nav_result.confidence,
        trees=nav_trees,
    )

    # Generate answer
    answer = await generate_answer(
        query=body.content,
        node_ids=nav_result.selected_node_ids,
        trees=trees,
        history=history,
        llm=llm,
    )

    # Store assistant message
    assistant_msg = ChatMessage(
        session_id=session_id,
        role="assistant",
        content=answer.content,
        citations=[c.to_dict() for c in answer.citations],
        reasoning_trace=trace.to_dict(),
        node_ids_visited=trace.node_ids,
    )
    db.add(assistant_msg)
    await db.flush()  # get assistant_msg.id before audit log

    # Audit log for citation access
    if answer.citations:
        await _add_audit_log(
            db, current_user.id, "citation.access", "chat_message", assistant_msg.id,
            {"citation_count": len(answer.citations)},
        )

    await db.commit()
    await db.refresh(assistant_msg)

    logger.info(
        "Chat message processed",
        extra={"session_id": str(session_id), "nodes_visited": len(trace.node_ids)},
    )

    return ChatMessageOut.model_validate(assistant_msg)


# ── DELETE /chat/sessions/{id} ────────────────────────────────────────────────

@router.delete("/sessions/{session_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_session(
    session_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Delete a chat session and all its messages."""
    session = await _get_session_or_403(session_id, current_user.workspace_id, db)
    await db.delete(session)
    await db.commit()


# ── GET /chat/sessions/{id}/messages ──────────────────────────────────────────

@router.get("/sessions/{session_id}/messages", response_model=list[ChatMessageOut])
async def get_messages(
    session_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Return full message history for a session in chronological order."""
    await _get_session_or_403(session_id, current_user.workspace_id, db)

    result = await db.execute(
        select(ChatMessage)
        .where(ChatMessage.session_id == session_id)
        .order_by(ChatMessage.created_at.asc())
    )
    return result.scalars().all()


# ── WS /ws/chat/{session_id} ──────────────────────────────────────────────────

async def _get_ws_user(token: str, db: AsyncSession) -> User | None:
    """Authenticate a WebSocket connection via JWT query param."""
    try:
        payload = decode_token(token)
        if payload.get("type") != "access":
            return None
        user_id = payload.get("sub")
        if not user_id:
            return None
        result = await db.execute(select(User).where(User.id == uuid.UUID(user_id)))
        return result.scalar_one_or_none()
    except Exception:
        return None


async def _ws_stream_answer(
    websocket: WebSocket,
    session: ChatSession,
    query: str,
    history: list[dict],
    trees: list[tuple[str, str, dict]],
    db: AsyncSession,
    user: User,
) -> tuple[str, list, dict, list[str]]:
    """Run PageIndex pipeline and stream tokens over WebSocket. Returns (content, citations, trace_dict, node_ids)."""
    llm = BedrockProvider()
    nav_trees = [(doc_id, tree) for doc_id, _, tree in trees]
    nav_result = await navigate(query, nav_trees, llm)

    trace = build_trace(
        query=query,
        selected_node_ids=nav_result.selected_node_ids,
        rationale=nav_result.rationale,
        confidence=nav_result.confidence,
        trees=nav_trees,
    )

    # Send trace event first
    await websocket.send_json({"type": "trace", "data": trace.to_dict()})

    # Stream answer tokens
    full_content = ""
    async for chunk in stream_answer(query, nav_result.selected_node_ids, trees, history, llm):
        full_content += chunk
        await websocket.send_json({"type": "token", "data": chunk})

    # Parse final answer for citations
    from app.services.pageindex.answer_generator import _parse_answer_and_citations
    answer_text, citations = _parse_answer_and_citations(full_content)

    await websocket.send_json({
        "type": "done",
        "citations": [c.to_dict() for c in citations],
    })

    return answer_text, citations, trace.to_dict(), trace.node_ids


# WebSocket router is registered on the app directly (not under /api/v1 prefix)
ws_router = APIRouter(tags=["chat-ws"])


@ws_router.websocket("/ws/chat/{session_id}")
async def websocket_chat(
    websocket: WebSocket,
    session_id: uuid.UUID,
    token: str = Query(...),
    db: AsyncSession = Depends(get_db),
):
    """WebSocket endpoint for streaming chat tokens and events. JWT via query param."""
    await websocket.accept()

    user = await _get_ws_user(token, db)
    if user is None:
        await websocket.close(code=4001, reason="Unauthorized")
        return

    session_result = await db.execute(
        select(ChatSession).where(
            ChatSession.id == session_id,
            ChatSession.workspace_id == user.workspace_id,
        )
    )
    session = session_result.scalar_one_or_none()
    if session is None:
        await websocket.close(code=4003, reason="Session not found")
        return

    try:
        while True:
            data = await websocket.receive_json()
            query = data.get("content", "").strip()
            if not query:
                continue

            _check_rate_limit(str(user.id))

            # Store user message
            user_msg = ChatMessage(session_id=session_id, role="user", content=query)
            db.add(user_msg)
            await db.commit()

            # Load history and trees
            history_result = await db.execute(
                select(ChatMessage)
                .where(ChatMessage.session_id == session_id)
                .order_by(ChatMessage.created_at.asc())
            )
            history = [
                {"role": m.role, "content": m.content}
                for m in history_result.scalars().all()
                if m.id != user_msg.id
            ]
            trees = await _load_kb_trees(session.kb_id, db)

            answer_text, citations, trace_dict, node_ids = await _ws_stream_answer(
                websocket, session, query, history, trees, db, user
            )

            # Store assistant message
            assistant_msg = ChatMessage(
                session_id=session_id,
                role="assistant",
                content=answer_text,
                citations=[c.to_dict() for c in citations],
                reasoning_trace=trace_dict,
                node_ids_visited=node_ids,
            )
            db.add(assistant_msg)
            await _add_audit_log(db, user.id, "chat.query", "chat_session", session_id)
            await db.commit()

    except WebSocketDisconnect:
        logger.info("WebSocket disconnected", extra={"session_id": str(session_id)})
    except HTTPException as exc:
        await websocket.send_json({"type": "error", "detail": exc.detail})
        await websocket.close(code=4029, reason="Rate limit exceeded")
    except Exception as exc:
        logger.exception("WebSocket error", extra={"session_id": str(session_id)})
        await websocket.close(code=1011, reason="Internal error")
