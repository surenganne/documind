"""Pydantic schemas for KnowledgeBase CRUD."""
import uuid
from datetime import datetime
from typing import Any, Optional

from pydantic import BaseModel


class KnowledgeBaseCreate(BaseModel):
    name: str
    description: Optional[str] = None
    settings: Optional[dict[str, Any]] = None


class KnowledgeBaseUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    settings: Optional[dict[str, Any]] = None


class KnowledgeBaseOut(BaseModel):
    id: uuid.UUID
    workspace_id: uuid.UUID
    name: str
    description: Optional[str]
    created_by: uuid.UUID
    created_at: datetime
    document_count: int = 0

    model_config = {"from_attributes": True}


class KnowledgeBaseDetail(KnowledgeBaseOut):
    settings: dict[str, Any]
    documents: list[dict[str, Any]] = []
