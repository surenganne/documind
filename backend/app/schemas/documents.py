"""Pydantic schemas for document upload and listing."""
import uuid
from datetime import datetime
from typing import Optional

from pydantic import BaseModel

from app.models.document import DocumentStatus


class DocumentUploadResponse(BaseModel):
    document_id: uuid.UUID
    status: DocumentStatus
    filename: str
    kb_id: uuid.UUID


class DocumentOut(BaseModel):
    id: uuid.UUID
    workspace_id: uuid.UUID
    kb_id: uuid.UUID
    filename: str
    file_type: str
    size_bytes: int
    status: DocumentStatus
    uploaded_by: uuid.UUID
    created_at: datetime

    model_config = {"from_attributes": True}
