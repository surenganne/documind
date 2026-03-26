"""Document insights API endpoint."""
import uuid
import logging

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.security import get_current_user
from app.models.document import Document
from app.models.document_tree import DocumentTree
from app.models.user import User

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/insights", tags=["insights"])


@router.get("/{doc_id}")
async def get_document_insights(
    doc_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Return insights for a document. Enforces workspace isolation."""
    # Fetch the document
    result = await db.execute(select(Document).where(Document.id == doc_id))
    document = result.scalar_one_or_none()

    if document is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"error": {"code": "NOT_FOUND", "message": "Document not found"}},
        )

    # Enforce workspace isolation
    if document.workspace_id != current_user.workspace_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={"error": {"code": "FORBIDDEN", "message": "Access denied to this document"}},
        )

    # Fetch the document tree
    tree_result = await db.execute(
        select(DocumentTree).where(DocumentTree.document_id == doc_id)
    )
    tree = tree_result.scalar_one_or_none()

    if tree is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"error": {"code": "NOT_FOUND", "message": "Document insights not found"}},
        )

    return {
        "doc_id": str(doc_id),
        "executive_summary": tree.executive_summary,
        "key_entities": tree.key_entities,
        "document_tags": tree.document_tags,
        "complexity_score": tree.complexity_score,
        "tree_json": tree.tree_json,
    }
