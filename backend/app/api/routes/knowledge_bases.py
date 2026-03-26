"""KnowledgeBase CRUD API endpoints."""
import uuid
import logging

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.security import get_current_user, require_role
from app.models.document import Document
from app.models.knowledge_base import KnowledgeBase
from app.models.user import User
from app.schemas.documents import DocumentOut
from app.schemas.knowledge_bases import (
    KnowledgeBaseCreate,
    KnowledgeBaseDetail,
    KnowledgeBaseOut,
    KnowledgeBaseUpdate,
)
from app.services.kb_service import (
    assert_no_active_sessions,
    assert_unique_name,
    get_document_count,
    get_kb_or_403,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/knowledge-bases", tags=["knowledge-bases"])


@router.post("", status_code=status.HTTP_201_CREATED, response_model=KnowledgeBaseOut)
async def create_knowledge_base(
    body: KnowledgeBaseCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Create a new KnowledgeBase scoped to the current user's workspace."""
    await assert_unique_name(body.name, current_user.workspace_id, db)

    kb = KnowledgeBase(
        workspace_id=current_user.workspace_id,
        name=body.name,
        description=body.description,
        created_by=current_user.id,
        settings=body.settings or {},
    )
    db.add(kb)
    await db.commit()
    await db.refresh(kb)

    doc_count = await get_document_count(kb.id, db)
    logger.info("KnowledgeBase created", extra={"kb_id": str(kb.id)})

    return KnowledgeBaseOut(
        id=kb.id,
        workspace_id=kb.workspace_id,
        name=kb.name,
        description=kb.description,
        created_by=kb.created_by,
        created_at=kb.created_at,
        document_count=doc_count,
    )


@router.get("", response_model=list[KnowledgeBaseOut])
async def list_knowledge_bases(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """List all KnowledgeBases in the current workspace."""
    result = await db.execute(
        select(KnowledgeBase)
        .where(KnowledgeBase.workspace_id == current_user.workspace_id)
        .order_by(KnowledgeBase.created_at.desc())
    )
    kbs = result.scalars().all()

    out = []
    for kb in kbs:
        doc_count = await get_document_count(kb.id, db)
        out.append(
            KnowledgeBaseOut(
                id=kb.id,
                workspace_id=kb.workspace_id,
                name=kb.name,
                description=kb.description,
                created_by=kb.created_by,
                created_at=kb.created_at,
                document_count=doc_count,
            )
        )
    return out


@router.get("/{kb_id}", response_model=KnowledgeBaseDetail)
async def get_knowledge_base(
    kb_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Get a single KnowledgeBase with its document list."""
    kb = await get_kb_or_403(kb_id, current_user.workspace_id, db)

    doc_count = await get_document_count(kb.id, db)

    docs_result = await db.execute(
        select(Document)
        .where(Document.kb_id == kb.id)
        .order_by(Document.created_at.desc())
    )
    docs = docs_result.scalars().all()

    return KnowledgeBaseDetail(
        id=kb.id,
        workspace_id=kb.workspace_id,
        name=kb.name,
        description=kb.description,
        created_by=kb.created_by,
        created_at=kb.created_at,
        settings=kb.settings or {},
        document_count=doc_count,
        documents=[
            {
                "id": str(d.id),
                "filename": d.filename,
                "file_type": d.file_type,
                "size_bytes": d.size_bytes,
                "status": d.status,
                "created_at": d.created_at.isoformat(),
            }
            for d in docs
        ],
    )


@router.patch("/{kb_id}", response_model=KnowledgeBaseOut)
async def update_knowledge_base(
    kb_id: uuid.UUID,
    body: KnowledgeBaseUpdate,
    current_user: User = Depends(require_role("editor")),
    db: AsyncSession = Depends(get_db),
):
    """Update a KnowledgeBase name, description, or settings. Requires Editor+ role."""
    kb = await get_kb_or_403(kb_id, current_user.workspace_id, db)

    if body.name is not None and body.name != kb.name:
        await assert_unique_name(body.name, current_user.workspace_id, db, exclude_id=kb_id)
        kb.name = body.name

    if body.description is not None:
        kb.description = body.description

    if body.settings is not None:
        kb.settings = body.settings

    await db.commit()
    await db.refresh(kb)

    doc_count = await get_document_count(kb.id, db)
    return KnowledgeBaseOut(
        id=kb.id,
        workspace_id=kb.workspace_id,
        name=kb.name,
        description=kb.description,
        created_by=kb.created_by,
        created_at=kb.created_at,
        document_count=doc_count,
    )


@router.delete("/{kb_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_knowledge_base(
    kb_id: uuid.UUID,
    current_user: User = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_db),
):
    """Delete a KnowledgeBase. Requires Admin role. Blocked if active sessions exist."""
    kb = await get_kb_or_403(kb_id, current_user.workspace_id, db)
    await assert_no_active_sessions(kb_id, db)

    await db.delete(kb)
    await db.commit()
    logger.info("KnowledgeBase deleted", extra={"kb_id": str(kb_id)})
