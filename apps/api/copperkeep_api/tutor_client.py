"""Client for the optional `tutor` service, plus the validator that makes it safe.

The prompt is a request; the validator is the guarantee. A hint that fails any rule
below is discarded and the learner falls back to the authored ladder silently — so a
model that ignores its instructions degrades to authored content rather than leaking a
solution (§19.4).

The learner supplies none of the payload, and nothing identifying travels with it: no
display name, no user ID, no history, nothing about any other learner. That is what
keeps the privacy story intact even against a cloud endpoint.
"""

from __future__ import annotations

import ast
import logging
import re
from typing import Any

import httpx

from . import metrics
from .config import settings

log = logging.getLogger(__name__)

WORD_CEILING = {"grade3": 35, "grade7": 60, "adult": 80}
_CODE_FENCE = re.compile(r"```|~~~")


def _parses_as_python(line: str) -> bool:
    """True when a whole line is a statement the learner could paste and run.

    Prose that merely mentions `range(10)` inside a sentence does not parse and is
    fine — the authored ladder says exactly that. A line that stands alone as code is
    the answer, and the answer is what this rule exists to keep out.
    """
    stripped = line.strip()
    if not stripped:
        return False
    candidate = f"{stripped} pass" if stripped.endswith(":") else stripped
    try:
        tree = ast.parse(candidate)
    except SyntaxError:
        return False
    if len(tree.body) == 1 and isinstance(tree.body[0], ast.Expr):
        # A lone word or number is prose, not code.
        value = tree.body[0].value
        if isinstance(value, ast.Name | ast.Constant):
            return False
    return True


def validate(hint: dict[str, Any], reading_tier: str) -> bool:
    """Every rule here is a reason to fall back, and every rejection is a metric —
    a rising rejection rate on a step means that step needs better authored hints."""
    observation = str(hint.get("observation", ""))
    nudge = str(hint.get("nudge", ""))
    text = f"{observation} {nudge}"

    if hint.get("confidence") != "high":
        metrics.hint_rejections.labels(rule="low_confidence").inc()
        return False
    if not observation or not nudge:
        metrics.hint_rejections.labels(rule="incomplete").inc()
        return False
    if _CODE_FENCE.search(text):
        metrics.hint_rejections.labels(rule="code_fence").inc()
        return False
    if any(
        _parses_as_python(line)
        for field in (observation, nudge)
        for line in field.splitlines()
    ):
        metrics.hint_rejections.labels(rule="contains_code").inc()
        return False
    if len(text.split()) > WORD_CEILING.get(reading_tier, 80):
        metrics.hint_rejections.labels(rule="too_long").inc()
        return False
    return True


async def request_guidance(
    *,
    reading_tier: str,
    skills: list[str],
    learner_code: str,
    failures: list[dict[str, Any]],
    authored_hints_shown: list[str],
) -> dict[str, Any] | None:
    """Returns a validated hint, or None to fall back to the authored ladder."""
    payload = {
        "language": "python",
        "readingTier": reading_tier,
        "skills": skills,
        "learnerCode": learner_code,
        "failures": failures,
        # Without these the model rephrases what the learner just read and ignored.
        "authoredHintsAlreadyShown": authored_hints_shown,
    }

    async with httpx.AsyncClient(timeout=settings.tutor_timeout_seconds) as client:
        response = await client.post(
            f"{settings.tutor_base_url.rstrip('/')}/guidance", json=payload
        )
    if response.status_code == 204:
        return None
    response.raise_for_status()
    hint = response.json()

    if not validate(hint, reading_tier):
        log.info("generated hint rejected by the validator")
        return None
    return {"observation": hint["observation"], "nudge": hint["nudge"]}
