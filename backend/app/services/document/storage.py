"""File storage service supporting S3 and local filesystem backends."""
import os
import uuid
import logging
from pathlib import Path

import boto3
from botocore.exceptions import ClientError

from app.core.config import settings

logger = logging.getLogger(__name__)


class FileStorageService:
    """
    Stores uploaded files to either S3 or local /data/uploads/.
    Backend is selected based on whether S3_BUCKET is configured.
    """

    def __init__(self):
        self._use_s3 = bool(settings.s3_bucket)
        if self._use_s3:
            session_kwargs = {}
            if settings.aws_endpoint_url:
                # LocalStack mode — use dummy credentials, ignore AWS_PROFILE
                session_kwargs["aws_access_key_id"] = "test"
                session_kwargs["aws_secret_access_key"] = "test"
            elif settings.aws_profile:
                session_kwargs["profile_name"] = settings.aws_profile
            session = boto3.Session(**session_kwargs)
            client_kwargs = {"region_name": settings.aws_region}
            if settings.aws_endpoint_url:
                # LocalStack or other S3-compatible endpoint
                client_kwargs["endpoint_url"] = settings.aws_endpoint_url
            self._s3 = session.client("s3", **client_kwargs)
            self._bucket = settings.s3_bucket
        else:
            self._local_root = Path(settings.s3_local_fallback_path)

    def store(self, file_bytes: bytes, filename: str, workspace_id: str) -> str:
        """
        Persist file_bytes and return the stored path or S3 key.

        Args:
            file_bytes: Raw file content.
            filename: Original filename (used to derive extension).
            workspace_id: Tenant ID used to namespace storage paths.

        Returns:
            str: S3 key (e.g. "workspaces/<id>/<uuid>.<ext>") or
                 absolute local path (e.g. "/data/uploads/workspaces/<id>/<uuid>.<ext>").
        """
        ext = Path(filename).suffix.lower()
        unique_name = f"{uuid.uuid4()}{ext}"
        relative_key = f"workspaces/{workspace_id}/{unique_name}"

        if self._use_s3:
            return self._store_s3(file_bytes, relative_key)
        return self._store_local(file_bytes, relative_key)

    def _store_s3(self, file_bytes: bytes, key: str) -> str:
        try:
            self._s3.put_object(Bucket=self._bucket, Key=key, Body=file_bytes)
            logger.info("Stored file to S3", extra={"key": key, "bucket": self._bucket})
            return key
        except ClientError as exc:
            logger.error("S3 upload failed", extra={"key": key, "error": str(exc)})
            raise

    def _store_local(self, file_bytes: bytes, relative_key: str) -> str:
        dest = self._local_root / relative_key
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(file_bytes)
        logger.info("Stored file locally", extra={"path": str(dest)})
        return str(dest)
