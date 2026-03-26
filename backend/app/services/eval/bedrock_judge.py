"""DeepEval judge model singleton backed by AWS Bedrock Claude Sonnet 4.5."""
from __future__ import annotations

import logging

logger = logging.getLogger(__name__)

_JUDGE_MODEL_ID = "us.anthropic.claude-sonnet-4-5-20250929-v1:0"
_JUDGE_REGION = "us-east-1"

try:
    from deepeval.models import AmazonBedrockModel

    bedrock_judge = AmazonBedrockModel(
        model=_JUDGE_MODEL_ID,
        region=_JUDGE_REGION,
        generation_kwargs={"temperature": 0, "max_tokens": 1000},
    )
    JUDGE_MODEL_NAME = _JUDGE_MODEL_ID
except ImportError:
    # deepeval not installed — provide a stub so imports don't fail in non-eval contexts
    logger.warning("deepeval not installed; bedrock_judge is a stub")
    bedrock_judge = None  # type: ignore[assignment]
    JUDGE_MODEL_NAME = _JUDGE_MODEL_ID
