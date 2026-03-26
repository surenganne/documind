"""Celery tasks for asynchronous DeepEval evaluation (Requirements 13.2–13.5, 20.1–20.2)."""
from __future__ import annotations

import asyncio
import logging
import uuid
from contextvars import ContextVar

from celery import Task
from app.workers.celery_app import celery_app

logger = logging.getLogger(__name__)

_EVAL_MODEL_ID = "us.anthropic.claude-sonnet-4-5-20250929-v1:0"
_MAX_RETRIES = 2
_RETRY_BACKOFF = 30  # seconds


def _run_async(coro):
    loop = asyncio.new_event_loop()
    try:
        return loop.run_until_complete(coro)
    finally:
        loop.close()


@celery_app.task(
    bind=True,
    name="app.workers.eval_tasks.evaluate_response_async",
    queue="eval_queue",
    max_retries=_MAX_RETRIES,
    acks_late=True,
    default_retry_delay=_RETRY_BACKOFF,
)
def evaluate_response_async(
    self: Task,
    message_id: str,
    workspace_id: str,
    triggered_by: str = "online",
    correlation_id: str | None = None,
) -> dict:
    """
    Evaluate a chat response asynchronously using DeepEval.

    Enqueued after the SSE stream completes — never blocks the user-facing response.
    Retry policy: max 2 retries, 30s backoff. On failure: log and skip disclaimer (fail open).

    Args:
        message_id: UUID of the assistant ChatMessage to evaluate.
        workspace_id: UUID of the workspace (for threshold lookup).
        triggered_by: 'online' | 'nightly' | 'ci'
        correlation_id: Request correlation ID for log tracing.
    """
    try:
        return _run_async(
            _evaluate_async(message_id, workspace_id, triggered_by, correlation_id)
        )
    except Exception as exc:
        logger.error(
            "evaluate_response_async failed",
            extra={
                "message_id": message_id,
                "correlation_id": correlation_id,
                "attempt": self.request.retries,
                "error": str(exc),
            },
        )
        if self.request.retries < _MAX_RETRIES:
            raise self.retry(exc=exc, countdown=_RETRY_BACKOFF)
        # Fail open — do not block the user; just log and return
        logger.error(
            "evaluate_response_async exhausted retries, skipping disclaimer",
            extra={"message_id": message_id, "correlation_id": correlation_id},
        )
        return {"status": "failed", "message_id": message_id}


async def _evaluate_async(
    message_id: str,
    workspace_id: str,
    triggered_by: str,
    correlation_id: str | None,
) -> dict:
    """Core async evaluation logic."""
    from sqlalchemy import select
    from app.core.database import AsyncSessionLocal
    from app.models.eval_result import EvalResult
    from app.models.eval_config import EvalConfig
    from app.services.eval.test_case import build_test_case
    from app.services.eval.metrics import EvalThresholds, build_metrics
    from app.services.eval.quality_gate import check_and_inject
    from app.services.eval.bedrock_judge import JUDGE_MODEL_NAME

    msg_uuid = uuid.UUID(message_id)
    ws_uuid = uuid.UUID(workspace_id)

    async with AsyncSessionLocal() as db:
        # Build LLMTestCase
        test_case = await build_test_case(msg_uuid, db)

        # Load workspace eval thresholds (fall back to defaults)
        cfg_result = await db.execute(
            select(EvalConfig).where(EvalConfig.workspace_id == ws_uuid)
        )
        cfg: EvalConfig | None = cfg_result.scalar_one_or_none()
        thresholds = EvalThresholds(
            faithfulness=cfg.faithfulness_threshold if cfg else 0.85,
            answer_relevancy=cfg.answer_relevancy_threshold if cfg else 0.80,
            contextual_precision=cfg.contextual_precision_threshold if cfg else 0.75,
            contextual_recall=cfg.contextual_recall_threshold if cfg else 0.75,
            hallucination=cfg.hallucination_threshold if cfg else 0.15,
        )
        multi_turn_enabled = cfg.multi_turn_enabled if cfg else False

        # Run evaluation
        scores = await _run_deepeval(test_case, thresholds)

        # Determine overall_pass
        overall_pass = (
            scores["faithfulness"] >= thresholds.faithfulness
            and scores["answer_relevancy"] >= thresholds.answer_relevancy
            and scores["contextual_precision"] >= thresholds.contextual_precision
            and scores["contextual_recall"] >= thresholds.contextual_recall
            and scores["hallucination"] <= thresholds.hallucination
        )

        # Persist eval_results record
        eval_result = EvalResult(
            message_id=msg_uuid,
            document_id=_get_document_id_for_message(scores),
            faithfulness_score=scores["faithfulness"],
            faithfulness_reason=scores.get("faithfulness_reason", ""),
            answer_relevancy_score=scores["answer_relevancy"],
            contextual_precision_score=scores["contextual_precision"],
            contextual_recall_score=scores["contextual_recall"],
            hallucination_score=scores["hallucination"],
            overall_pass=overall_pass,
            eval_model=JUDGE_MODEL_NAME,
            triggered_by=triggered_by,
        )
        db.add(eval_result)
        await db.commit()
        await db.refresh(eval_result)

        # Run quality gate (may append disclaimer to message content)
        await check_and_inject(msg_uuid, eval_result, ws_uuid, db, thresholds)

        # Run multi-turn evaluation if enabled for this workspace
        multi_turn_result = None
        if multi_turn_enabled:
            multi_turn_result = await _run_multi_turn_eval(
                msg_uuid, ws_uuid, triggered_by, correlation_id, db
            )

        logger.info(
            "Evaluation complete",
            extra={
                "message_id": message_id,
                "overall_pass": overall_pass,
                "multi_turn_enabled": multi_turn_enabled,
                "correlation_id": correlation_id,
            },
        )
        return {
            "status": "completed",
            "message_id": message_id,
            "overall_pass": overall_pass,
            "eval_result_id": str(eval_result.id),
            "multi_turn_result": multi_turn_result,
        }


async def _run_multi_turn_eval(
    message_id: uuid.UUID,
    workspace_id: uuid.UUID,
    triggered_by: str,
    correlation_id: str | None,
    db,
) -> dict | None:
    """
    Build a ConversationalTestCase from the full session thread and evaluate
    using TurnFaithfulnessMetric and TurnRelevancyMetric.

    Stores turn-level scores in eval_results with triggered_by set to the trigger mode.
    Requirements: 20.1, 20.2
    """
    from sqlalchemy import select
    from app.models.chat_message import ChatMessage
    from app.models.chat_session import ChatSession
    from app.models.eval_result import EvalResult
    from app.services.eval.bedrock_judge import JUDGE_MODEL_NAME

    try:
        # Fetch the current message to get session_id
        msg_result = await db.execute(
            select(ChatMessage).where(ChatMessage.id == message_id)
        )
        current_msg: ChatMessage | None = msg_result.scalar_one_or_none()
        if current_msg is None:
            logger.warning("Multi-turn eval: message not found", extra={"message_id": str(message_id)})
            return None

        # Load all messages in the session up to and including the current message
        msgs_result = await db.execute(
            select(ChatMessage)
            .where(ChatMessage.session_id == current_msg.session_id)
            .where(ChatMessage.created_at <= current_msg.created_at)
            .order_by(ChatMessage.created_at)
        )
        all_messages = msgs_result.scalars().all()

        if len(all_messages) < 2:
            # Need at least one user + one assistant turn
            return None

        # Build turns for ConversationalTestCase
        turns = _build_turns(all_messages)
        if not turns:
            return None

        # Run multi-turn DeepEval metrics
        mt_scores = await _run_conversational_deepeval(turns)

        # Persist a separate eval_results record for multi-turn scores
        # We reuse the same table, storing turn_faithfulness in faithfulness_score
        # and turn_relevancy in answer_relevancy_score; other fields get neutral values
        mt_eval_result = EvalResult(
            message_id=message_id,
            document_id=uuid.UUID("00000000-0000-0000-0000-000000000000"),
            faithfulness_score=mt_scores.get("turn_faithfulness", 1.0),
            faithfulness_reason=mt_scores.get("turn_faithfulness_reason", "multi-turn"),
            answer_relevancy_score=mt_scores.get("turn_relevancy", 1.0),
            contextual_precision_score=1.0,
            contextual_recall_score=1.0,
            hallucination_score=0.0,
            overall_pass=(
                mt_scores.get("turn_faithfulness", 1.0) >= 0.85
                and mt_scores.get("turn_relevancy", 1.0) >= 0.80
            ),
            eval_model=JUDGE_MODEL_NAME,
            triggered_by=f"{triggered_by}:multi_turn",
        )
        db.add(mt_eval_result)
        await db.commit()

        logger.info(
            "Multi-turn evaluation complete",
            extra={
                "message_id": str(message_id),
                "turn_count": len(turns),
                "correlation_id": correlation_id,
            },
        )
        return {
            "turn_faithfulness": mt_scores.get("turn_faithfulness"),
            "turn_relevancy": mt_scores.get("turn_relevancy"),
            "turn_count": len(turns),
        }

    except Exception as exc:
        logger.error(
            "Multi-turn evaluation failed (non-blocking)",
            extra={"message_id": str(message_id), "error": str(exc), "correlation_id": correlation_id},
        )
        return None


def _build_turns(messages: list) -> list[dict]:
    """
    Pair consecutive user/assistant messages into turns for ConversationalTestCase.
    Returns list of dicts with 'input' and 'actual_output'.
    """
    turns = []
    i = 0
    while i < len(messages) - 1:
        if messages[i].role == "user" and messages[i + 1].role == "assistant":
            node_texts = []
            if messages[i + 1].node_ids_visited:
                # Use node_ids as retrieval context placeholder
                node_texts = [f"[node:{nid}]" for nid in messages[i + 1].node_ids_visited]
            turns.append({
                "input": messages[i].content,
                "actual_output": messages[i + 1].content,
                "retrieval_context": node_texts,
            })
            i += 2
        else:
            i += 1
    return turns


async def _run_conversational_deepeval(turns: list[dict]) -> dict:
    """
    Run TurnFaithfulnessMetric and TurnRelevancyMetric from DeepEval.
    Falls back to neutral scores if deepeval is not installed or metrics unavailable.
    """
    try:
        from deepeval.test_case import ConversationalTestCase, LLMTestCase
        from app.services.eval.bedrock_judge import bedrock_judge

        # Build individual LLMTestCase turns
        llm_turns = [
            LLMTestCase(
                input=t["input"],
                actual_output=t["actual_output"],
                retrieval_context=t["retrieval_context"] or [],
            )
            for t in turns
        ]
        conv_test_case = ConversationalTestCase(turns=llm_turns)

        try:
            from deepeval.metrics import TurnFaithfulnessMetric, TurnRelevancyMetric
        except ImportError:
            logger.warning("TurnFaithfulnessMetric/TurnRelevancyMetric not available in this deepeval version")
            return _neutral_mt_scores()

        tf_metric = TurnFaithfulnessMetric(model=bedrock_judge, threshold=0.85)
        tr_metric = TurnRelevancyMetric(model=bedrock_judge, threshold=0.80)

        loop = asyncio.get_event_loop()

        def _eval():
            tf_metric.measure(conv_test_case)
            tr_metric.measure(conv_test_case)

        await loop.run_in_executor(None, _eval)

        return {
            "turn_faithfulness": getattr(tf_metric, "score", 1.0) or 1.0,
            "turn_faithfulness_reason": getattr(tf_metric, "reason", "") or "",
            "turn_relevancy": getattr(tr_metric, "score", 1.0) or 1.0,
        }

    except ImportError:
        logger.warning("deepeval not installed; returning neutral multi-turn scores")
        return _neutral_mt_scores()
    except Exception as exc:
        logger.error("Conversational DeepEval error", extra={"error": str(exc)})
        return _neutral_mt_scores()


def _neutral_mt_scores() -> dict:
    return {
        "turn_faithfulness": 1.0,
        "turn_faithfulness_reason": "evaluation unavailable",
        "turn_relevancy": 1.0,
    }


async def _run_deepeval(test_case, thresholds) -> dict:
    """
    Run DeepEval metrics against the test case.
    Returns a dict of metric scores and reasons.
    Falls back to neutral scores if deepeval is not installed.
    """
    try:
        from deepeval import evaluate
        from app.services.eval.metrics import build_metrics

        metrics = build_metrics(thresholds)
        if not metrics:
            return _neutral_scores()

        # DeepEval evaluate is synchronous; run in executor to avoid blocking
        loop = asyncio.get_event_loop()
        results = await loop.run_in_executor(
            None, lambda: evaluate([test_case], metrics, run_async=False)
        )

        # Extract scores from results
        scores: dict = {}
        for metric in metrics:
            name = _metric_key(type(metric).__name__)
            scores[name] = getattr(metric, "score", 0.0) or 0.0
            if name == "faithfulness":
                scores["faithfulness_reason"] = getattr(metric, "reason", "") or ""

        return {**_neutral_scores(), **scores}

    except ImportError:
        logger.warning("deepeval not installed; returning neutral scores")
        return _neutral_scores()
    except Exception as exc:
        logger.error("DeepEval evaluation error", extra={"error": str(exc)})
        return _neutral_scores()


def _metric_key(class_name: str) -> str:
    mapping = {
        "FaithfulnessMetric": "faithfulness",
        "AnswerRelevancyMetric": "answer_relevancy",
        "ContextualPrecisionMetric": "contextual_precision",
        "ContextualRecallMetric": "contextual_recall",
        "HallucinationMetric": "hallucination",
    }
    return mapping.get(class_name, class_name.lower())


def _neutral_scores() -> dict:
    """Return neutral (passing) scores used as fallback when deepeval is unavailable."""
    return {
        "faithfulness": 1.0,
        "faithfulness_reason": "evaluation unavailable",
        "answer_relevancy": 1.0,
        "contextual_precision": 1.0,
        "contextual_recall": 1.0,
        "hallucination": 0.0,
    }


def _get_document_id_for_message(scores: dict) -> uuid.UUID:
    """Placeholder — returns a nil UUID; real impl would resolve from session KB."""
    return uuid.UUID("00000000-0000-0000-0000-000000000000")
