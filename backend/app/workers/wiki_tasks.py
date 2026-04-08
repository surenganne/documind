"""Celery task for Wiki RAG document ingestion — builds/updates LLM-maintained wiki pages."""
from __future__ import annotations

import asyncio
import logging
import uuid

from celery import Task
from celery.exceptions import MaxRetriesExceededError

from app.workers.celery_app import celery_app
from app.services.document.extractor import extract_text

logger = logging.getLogger(__name__)

_MAX_RETRIES = 3
_RETRY_BASE_DELAY = 10  # seconds — actual delays: 10s, 20s, 40s
_WIKI_PAGE_CAP = 100    # Max pages per KB to control LLM costs


def _run_async(coro):
    """Run an async coroutine from a sync Celery task."""
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    try:
        return loop.run_until_complete(coro)
    finally:
        loop.run_until_complete(loop.shutdown_asyncgens())
        loop.close()
        asyncio.set_event_loop(None)


@celery_app.task(
    bind=True,
    name="app.workers.wiki_tasks.build_wiki_pages",
    queue="default",
    max_retries=_MAX_RETRIES,
    acks_late=True,
)
def build_wiki_pages(self: Task, document_id: str) -> dict:
    """
    Build/update LLM-maintained wiki pages for a newly uploaded document.

    Retry policy: max 3 retries with exponential backoff (10s, 20s, 40s).
    On success: wiki pages created/updated, document status → ready.
    On exhaustion: document status → failed.
    """
    try:
        return _run_async(_build_wiki_async(document_id))
    except MaxRetriesExceededError:
        logger.error("Max retries exceeded for wiki build", extra={"document_id": document_id})
        _run_async(_mark_failed(document_id, "Max retries exceeded"))
        raise
    except Exception as exc:
        attempt = self.request.retries
        delay = (2 ** attempt) * _RETRY_BASE_DELAY
        logger.warning(
            "build_wiki_pages failed, retrying",
            extra={"document_id": document_id, "attempt": attempt, "delay": delay, "error": str(exc)},
        )
        try:
            raise self.retry(exc=exc, countdown=delay)
        except MaxRetriesExceededError:
            logger.error("Max retries exceeded for wiki build", extra={"document_id": document_id})
            _run_async(_mark_failed(document_id, str(exc)))
            raise


async def _build_wiki_async(document_id: str) -> dict:
    """Core async logic for wiki page building."""
    from sqlalchemy import select
    from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
    from app.models.document import Document, DocumentStatus
    from app.models.wiki_page import WikiPage
    from app.core.config import settings
    from app.services.llm.factory import get_llm_provider
    from app.services.wiki.wiki_builder import extract_pages, merge_page_content

    doc_uuid = uuid.UUID(document_id)

    # Fresh engine per task — avoids asyncpg pool reuse across event loops
    task_engine = create_async_engine(settings.database_url, echo=False, pool_size=1, max_overflow=0)
    TaskSession = async_sessionmaker(task_engine, class_=AsyncSession, expire_on_commit=False)

    try:
        async with TaskSession() as db:
            # Load document
            result = await db.execute(select(Document).where(Document.id == doc_uuid))
            doc = result.scalar_one_or_none()
            if doc is None:
                raise ValueError(f"Document {document_id} not found")

            # Skip extraction if text too short (empty/corrupt files)
            text = extract_text(doc.file_path, doc.file_type)
            if len(text.strip()) < 100:
                logger.info(
                    "Document text too short for wiki extraction, marking ready",
                    extra={"document_id": document_id},
                )
                doc.status = DocumentStatus.ready
                await db.commit()
                await _push_ws_event(document_id, "ready")
                return {"document_id": document_id, "status": "ready", "pages_created": 0}

            # Resolve LLM provider from workspace config
            provider = await get_llm_provider(doc.workspace_id, db)

            # Load existing wiki pages for this KB (merge key = lowercase title)
            existing_result = await db.execute(
                select(WikiPage).where(WikiPage.kb_id == doc.kb_id)
            )
            existing_pages = existing_result.scalars().all()
            existing_map = {p.title.lower(): p for p in existing_pages}
            existing_count = len(existing_pages)

            # Extract new pages from document
            new_pages_data = await extract_pages(provider, text, doc.filename)

            if not new_pages_data:
                # Fallback: create a single general page with filename as title
                new_pages_data = [{
                    "title": doc.filename.rsplit(".", 1)[0],
                    "page_type": "general",
                    "summary": f"Content from {doc.filename}",
                    "content": f"## {doc.filename}\n\n{text[:2000]}",
                    "related_titles": [],
                }]

            pages_created = 0
            pages_merged = 0

            for page_data in new_pages_data:
                title_key = page_data["title"].lower()
                existing = existing_map.get(title_key)

                if existing:
                    # Merge new document content into the existing wiki page
                    updated_content = await merge_page_content(
                        provider,
                        existing.content,
                        page_data["content"],
                    )
                    existing.content = updated_content
                    existing.summary = page_data.get("summary") or existing.summary
                    # Add this doc to source_doc_ids if not already present
                    src_ids = list(existing.source_doc_ids or [])
                    doc_id_str = str(doc.id)
                    if doc_id_str not in src_ids:
                        src_ids.append(doc_id_str)
                    existing.source_doc_ids = src_ids
                    # Union of related titles
                    existing_related = set(existing.related_titles or [])
                    existing_related.update(page_data.get("related_titles", []))
                    existing.related_titles = sorted(existing_related)
                    existing.llm_model_used = provider.model
                    pages_merged += 1
                else:
                    # Enforce per-KB page cap — only merge, don't create new pages
                    if existing_count >= _WIKI_PAGE_CAP:
                        logger.info(
                            "Wiki page cap reached, skipping new page creation",
                            extra={"kb_id": str(doc.kb_id), "title": page_data["title"]},
                        )
                        continue

                    new_page = WikiPage(
                        kb_id=doc.kb_id,
                        workspace_id=doc.workspace_id,
                        title=page_data["title"],
                        summary=page_data.get("summary"),
                        content=page_data["content"],
                        page_type=page_data.get("page_type", "general"),
                        source_doc_ids=[str(doc.id)],
                        related_titles=page_data.get("related_titles", []),
                        llm_model_used=provider.model,
                    )
                    db.add(new_page)
                    # Track for cap enforcement within this batch
                    existing_map[title_key] = new_page
                    existing_count += 1
                    pages_created += 1

            # Mark document ready
            doc.status = DocumentStatus.ready
            await db.commit()

    finally:
        await task_engine.dispose()

    await _push_ws_event(document_id, "ready")

    logger.info(
        "Wiki pages built successfully",
        extra={
            "document_id": document_id,
            "pages_created": pages_created,
            "pages_merged": pages_merged,
        },
    )
    return {
        "document_id": document_id,
        "status": "ready",
        "pages_created": pages_created,
        "pages_merged": pages_merged,
    }


async def _mark_failed(document_id: str, error_detail: str) -> None:
    """Set document status to failed."""
    from sqlalchemy import select
    from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
    from app.models.document import Document, DocumentStatus
    from app.core.config import settings

    doc_uuid = uuid.UUID(document_id)
    task_engine = create_async_engine(settings.database_url, echo=False, pool_size=1, max_overflow=0)
    TaskSession = async_sessionmaker(task_engine, class_=AsyncSession, expire_on_commit=False)
    try:
        async with TaskSession() as db:
            result = await db.execute(select(Document).where(Document.id == doc_uuid))
            doc = result.scalar_one_or_none()
            if doc:
                doc.status = DocumentStatus.failed
                await db.commit()
    finally:
        await task_engine.dispose()

    await _push_ws_event(document_id, "failed", error=error_detail)


async def _push_ws_event(document_id: str, status: str, **extra) -> None:
    """Push a WebSocket event via Redis pub/sub (same as tree_tasks)."""
    import json
    try:
        import redis.asyncio as aioredis
        from app.core.config import settings

        r = aioredis.from_url(settings.redis_url)
        payload = json.dumps({"type": "document.status", "document_id": document_id, "status": status, **extra})
        await r.publish(f"ws:document:{document_id}", payload)
        await r.aclose()
    except Exception as exc:
        logger.warning("Failed to push WebSocket event", extra={"error": str(exc)})
