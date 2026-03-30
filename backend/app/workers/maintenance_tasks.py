"""Celery Beat maintenance tasks: nightly eval and file cleanup (Requirements 15.1–15.4)."""
from __future__ import annotations

import asyncio
import logging
import os
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

from celery.schedules import crontab
from app.workers.celery_app import celery_app

logger = logging.getLogger(__name__)

# ── Celery Beat schedule ──────────────────────────────────────────────────────

celery_app.conf.beat_schedule = {
    "nightly-eval-regression": {
        "task": "app.workers.maintenance_tasks.run_nightly_eval",
        "schedule": crontab(hour=2, minute=0),  # 2 AM UTC
    },
    "file-cleanup": {
        "task": "app.workers.maintenance_tasks.cleanup_orphaned_files",
        "schedule": crontab(hour=3, minute=0),  # 3 AM UTC
    },
}


def _run_async(coro):
    loop = asyncio.new_event_loop()
    try:
        return loop.run_until_complete(coro)
    finally:
        loop.close()


# ── run_nightly_eval ──────────────────────────────────────────────────────────

@celery_app.task(
    name="app.workers.maintenance_tasks.run_nightly_eval",
    queue="default",
    acks_late=True,
)
def run_nightly_eval() -> dict:
    """
    Re-evaluate all chat messages from the past 24 hours.
    Stores results with triggered_by='nightly'.
    Alerts workspace Admin if any metric drops >5% vs 7-day rolling baseline.
    """
    return _run_async(_run_nightly_eval_async())


async def _run_nightly_eval_async() -> dict:
    from sqlalchemy import select, func
    from app.core.database import AsyncSessionLocal
    from app.models.chat_message import ChatMessage
    from app.models.chat_session import ChatSession
    from app.models.eval_result import EvalResult
    from app.services.eval.test_case import build_test_case
    from app.services.eval.metrics import EvalThresholds
    from app.workers.eval_tasks import _run_deepeval, _neutral_scores
    from app.services.eval.bedrock_judge import JUDGE_MODEL_NAME

    cutoff = datetime.now(timezone.utc) - timedelta(hours=24)
    evaluated_count = 0
    alert_count = 0

    async with AsyncSessionLocal() as db:
        # Fetch all assistant messages from the past 24 hours
        result = await db.execute(
            select(ChatMessage)
            .where(
                ChatMessage.role == "assistant",
                ChatMessage.created_at >= cutoff,
            )
            .order_by(ChatMessage.created_at.asc())
        )
        messages = result.scalars().all()

        logger.info(
            "Nightly eval: found messages to evaluate",
            extra={"count": len(messages), "cutoff": cutoff.isoformat()},
        )

        for msg in messages:
            try:
                # Get workspace_id via session
                session_result = await db.execute(
                    select(ChatSession).where(ChatSession.id == msg.session_id)
                )
                session = session_result.scalar_one_or_none()
                if session is None:
                    continue

                test_case = await build_test_case(msg.id, db)
                thresholds = EvalThresholds()  # defaults; workspace config not loaded for nightly
                scores = await _run_deepeval(test_case, thresholds)

                overall_pass = (
                    scores["faithfulness"] >= thresholds.faithfulness
                    and scores["answer_relevancy"] >= thresholds.answer_relevancy
                    and scores["contextual_precision"] >= thresholds.contextual_precision
                    and scores["contextual_recall"] >= thresholds.contextual_recall
                    and scores["hallucination"] <= thresholds.hallucination
                )

                eval_result = EvalResult(
                    message_id=msg.id,
                    document_id=uuid.UUID("00000000-0000-0000-0000-000000000000"),
                    faithfulness_score=scores["faithfulness"],
                    faithfulness_reason=scores.get("faithfulness_reason", ""),
                    answer_relevancy_score=scores["answer_relevancy"],
                    contextual_precision_score=scores["contextual_precision"],
                    contextual_recall_score=scores["contextual_recall"],
                    hallucination_score=scores["hallucination"],
                    overall_pass=overall_pass,
                    eval_model=JUDGE_MODEL_NAME,
                    triggered_by="nightly",
                )
                db.add(eval_result)
                evaluated_count += 1

            except Exception as exc:
                logger.error(
                    "Nightly eval failed for message",
                    extra={"message_id": str(msg.id), "error": str(exc)},
                )

        await db.commit()

        # Check 7-day rolling baseline and alert if any metric drops >5%
        alert_count = await _check_baseline_and_alert(db, cutoff)

    logger.info(
        "Nightly eval complete",
        extra={"evaluated": evaluated_count, "alerts": alert_count},
    )
    return {"evaluated": evaluated_count, "alerts": alert_count}


async def _check_baseline_and_alert(db, cutoff: datetime) -> int:
    """
    Compare today's average scores against the 7-day rolling baseline.
    Alert workspace Admin if any metric drops >5%.
    Returns the number of alerts triggered.
    """
    from sqlalchemy import select, func
    from app.models.eval_result import EvalResult

    seven_days_ago = cutoff - timedelta(days=7)
    alert_count = 0

    # 7-day baseline averages
    baseline_result = await db.execute(
        select(
            func.avg(EvalResult.faithfulness_score).label("faithfulness"),
            func.avg(EvalResult.answer_relevancy_score).label("answer_relevancy"),
            func.avg(EvalResult.hallucination_score).label("hallucination"),
        ).where(
            EvalResult.evaluated_at >= seven_days_ago,
            EvalResult.evaluated_at < cutoff,
            EvalResult.triggered_by == "nightly",
        )
    )
    baseline = baseline_result.one()

    # Today's averages (nightly run just completed)
    today_result = await db.execute(
        select(
            func.avg(EvalResult.faithfulness_score).label("faithfulness"),
            func.avg(EvalResult.answer_relevancy_score).label("answer_relevancy"),
            func.avg(EvalResult.hallucination_score).label("hallucination"),
        ).where(
            EvalResult.evaluated_at >= cutoff,
            EvalResult.triggered_by == "nightly",
        )
    )
    today = today_result.one()

    metrics_to_check = [
        ("faithfulness", baseline.faithfulness, today.faithfulness, "higher_is_better"),
        ("answer_relevancy", baseline.answer_relevancy, today.answer_relevancy, "higher_is_better"),
        ("hallucination", baseline.hallucination, today.hallucination, "lower_is_better"),
    ]

    for metric_name, baseline_val, today_val, direction in metrics_to_check:
        if baseline_val is None or today_val is None:
            continue

        if direction == "higher_is_better":
            drop = baseline_val - today_val
        else:
            drop = today_val - baseline_val  # increase in hallucination = degradation

        if drop > 0.05:
            logger.warning(
                "Metric degradation alert",
                extra={
                    "metric": metric_name,
                    "baseline": round(baseline_val, 4),
                    "today": round(today_val, 4),
                    "drop": round(drop, 4),
                },
            )
            alert_count += 1

    return alert_count


# ── cleanup_orphaned_files ────────────────────────────────────────────────────

@celery_app.task(
    name="app.workers.maintenance_tasks.cleanup_orphaned_files",
    queue="default",
    acks_late=True,
)
def cleanup_orphaned_files() -> dict:
    """
    Purge orphaned files older than 30 days from S3.
    A file is orphaned if it has no corresponding documents record.
    """
    return _run_async(_cleanup_orphaned_files_async())


async def _cleanup_orphaned_files_async() -> dict:
    from sqlalchemy import select
    from app.core.database import AsyncSessionLocal
    from app.models.document import Document

    cutoff = datetime.now(timezone.utc) - timedelta(days=30)

    async with AsyncSessionLocal() as db:
        # Get all known file paths from DB
        result = await db.execute(select(Document.file_path))
        known_paths: set[str] = {row[0] for row in result.all() if row[0]}

    # S3 cleanup
    deleted_count = await _cleanup_s3_orphans(known_paths, cutoff)

    logger.info("File cleanup complete", extra={"deleted": deleted_count})
    return {"deleted": deleted_count}


async def _cleanup_s3_orphans(known_paths: set[str], cutoff: datetime) -> int:
    """Delete orphaned S3 objects older than cutoff."""
    import boto3
    from app.core.config import settings

    deleted = 0
    try:
        session_kwargs = {}
        if settings.aws_profile:
            session_kwargs["profile_name"] = settings.aws_profile
        session = boto3.Session(**session_kwargs)
        s3 = session.client("s3", region_name=settings.aws_region)

        paginator = s3.get_paginator("list_objects_v2")
        for page in paginator.paginate(Bucket=settings.s3_bucket):
            for obj in page.get("Contents", []):
                key = obj["Key"]
                last_modified = obj["LastModified"]
                if last_modified >= cutoff:
                    continue
                if key not in known_paths:
                    s3.delete_object(Bucket=settings.s3_bucket, Key=key)
                    deleted += 1
                    logger.info("Deleted orphaned S3 object", extra={"key": key})
    except Exception as exc:
        logger.error("S3 cleanup failed", extra={"error": str(exc)})

    return deleted
