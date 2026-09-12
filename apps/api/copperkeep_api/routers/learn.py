"""Progress ingestion, the mastery evaluator, and everything the learner surface reads.

Execution is client-side, so every claim arriving here is untrusted. This module is
where that is dealt with: the step must exist in the loaded content version, its
prerequisites must be held, a `step_completed` must be backed by a stored submission,
and the timing must be physically plausible. Reject and log rather than silently accept.

What that closes is tampering with the mastery model. It does not close a forged test
result — no server-side execution exists to verify one (§8).
"""

from __future__ import annotations

import json
import logging
from datetime import UTC, datetime, timedelta
from typing import Any

import httpx
from fastapi import APIRouter, Depends, HTTPException, Response, status

from .. import db, metrics
from ..bkt import MasteryInput, Observation, gate_response, is_mastered, is_opportunity, update
from ..config import settings
from ..content import StepDef, index
from ..deps import Principal, current_principal, enforce_write_quota
from ..schemas import (
    EventBatch,
    EventBatchResponse,
    EventIn,
    HintRequest,
    HintResponse,
    ReviewItem,
    SkillStateOut,
    SubmissionIn,
    SubmissionResponse,
)
from ..security import normalized_code_hash
from ..tutor_client import request_guidance

log = logging.getLogger(__name__)
router = APIRouter(prefix="/v1", tags=["learn"])

_MAX_CLOCK_SKEW = timedelta(minutes=2)
_MAX_EVENT_AGE = timedelta(days=7)
_MIN_SECONDS_ON_STEP = 2.0


async def _mastered_skills(org_id, user_id) -> set[str]:
    rows = await db.pool().fetch(
        """
        SELECT skill_id FROM skill_state
        WHERE org_id = $1 AND user_id = $2 AND mastered_at IS NOT NULL AND NOT decayed
        """,
        org_id,
        user_id,
    )
    return {r["skill_id"] for r in rows}


def _validate(event: EventIn, step: StepDef | None, held: set[str]) -> str | None:
    """Returns a rejection reason, or None when the event may be applied."""
    now = datetime.now(UTC)
    occurred = event.occurred_at
    if occurred.tzinfo is None:
        occurred = occurred.replace(tzinfo=UTC)

    if occurred > now + _MAX_CLOCK_SKEW:
        return "occurred_in_future"
    if occurred < now - _MAX_EVENT_AGE:
        return "too_old"

    if event.event_type in ("step_started", "attempt", "step_completed", "hint_shown"):
        if step is None:
            return "unknown_step"
        missing = [s for s in step.prerequisites if s not in held]
        if missing and event.event_type in ("attempt", "step_completed"):
            return "prerequisites_not_held"

    if event.event_type == "step_completed" and event.submission_id is None:
        return "submission_required"

    if event.event_type == "attempt" and event.correct is None:
        return "correct_required"

    return None


async def apply_to_skills(
    conn, org_id, user_id, event: EventIn, step: StepDef, touched: set[str]
) -> None:
    if event.correct is None:
        # An event that makes no claim about correctness carries no evidence. Guarding
        # here rather than trusting callers is what keeps a missing field from silently
        # becoming "wrong".
        return

    obs = Observation(
        correct=bool(event.correct),
        step_type=step.type,
        failure_kind=event.failure_kind,
        option_count=step.option_count,
        hint_source=event.hint_source,
    )
    if not is_opportunity(obs):
        # A missing colon is logged, but it moves neither the estimate nor the ladder.
        return

    for skill_id in step.skills:
        for resolved in index.resolve(skill_id):
            params = index.skill(resolved).params
            row = await conn.fetchrow(
                """
                SELECT * FROM skill_state
                WHERE org_id = $1 AND user_id = $2 AND skill_id = $3
                FOR UPDATE
                """,
                org_id,
                user_id,
                resolved,
            )
            if row is None:
                await conn.execute(
                    """
                    INSERT INTO skill_state (org_id, user_id, skill_id, p_known)
                    VALUES ($1, $2, $3, $4)
                    ON CONFLICT DO NOTHING
                    """,
                    org_id,
                    user_id,
                    resolved,
                    params.p_init,
                )
                row = await conn.fetchrow(
                    """
                    SELECT * FROM skill_state
                    WHERE org_id = $1 AND user_id = $2 AND skill_id = $3
                    FOR UPDATE
                    """,
                    org_id,
                    user_id,
                    resolved,
                )

            p_known = update(float(row["p_known"]), obs, params)
            step_types = set(row["step_types"]) | {step.type}
            consecutive = 0 if obs.correct else row["consecutive_fails"] + 1
            ai_assisted = row["ai_assisted"] or (obs.hint_source == "ai")
            transfer_passed = row["transfer_passed"] or (
                obs.correct and resolved in step.transfer_for
            )

            mastered_at = row["mastered_at"]
            newly_mastered = mastered_at is None and is_mastered(
                MasteryInput(
                    p_known=p_known,
                    opportunities=row["opportunities"] + 1,
                    distinct_step_types=len(step_types),
                    ai_assisted=ai_assisted,
                    transfer_passed=transfer_passed,
                ),
                threshold=settings.mastery_threshold,
                min_opportunities=settings.mastery_min_opportunities,
                min_step_types=settings.mastery_min_step_types,
            )
            if newly_mastered:
                mastered_at = datetime.now(UTC)
                metrics.skills_mastered.inc()

            next_review = row["next_review_at"]
            if newly_mastered:
                next_review = datetime.now(UTC) + timedelta(
                    days=settings.review_intervals_days[0]
                )

            await conn.execute(
                """
                UPDATE skill_state SET
                    p_known = $4, opportunities = opportunities + 1, step_types = $5,
                    consecutive_fails = $6, ai_assisted = $7, transfer_passed = $8,
                    mastered_at = $9, next_review_at = $10, last_seen_at = now(),
                    decayed = false
                WHERE org_id = $1 AND user_id = $2 AND skill_id = $3
                """,
                org_id,
                user_id,
                resolved,
                p_known,
                sorted(step_types),
                consecutive,
                ai_assisted,
                transfer_passed,
                mastered_at,
                next_review,
            )
            touched.add(resolved)


async def apply_review(conn, org_id, user_id, event: EventIn, touched: set[str]) -> None:
    """Skills decay. Failing a review un-masters the skill and schedules re-teaching."""
    for skill_id in event.skill_ids:
        for resolved in index.resolve(skill_id):
            row = await conn.fetchrow(
                """
                SELECT * FROM skill_state WHERE org_id = $1 AND user_id = $2 AND skill_id = $3
                FOR UPDATE
                """,
                org_id,
                user_id,
                resolved,
            )
            if row is None:
                continue

            if event.event_type == "review_passed":
                stage = min(row["review_stage"] + 1, len(settings.review_intervals_days) - 1)
                next_review = datetime.now(UTC) + timedelta(
                    days=settings.review_intervals_days[stage]
                )
                await conn.execute(
                    """
                    UPDATE skill_state SET review_stage = $4, next_review_at = $5,
                        last_seen_at = now(), decayed = false
                    WHERE org_id = $1 AND user_id = $2 AND skill_id = $3
                    """,
                    org_id,
                    user_id,
                    resolved,
                    stage,
                    next_review,
                )
            elif event.event_type == "review_failed":
                await conn.execute(
                    """
                    UPDATE skill_state SET mastered_at = NULL, decayed = true,
                        review_stage = 0, next_review_at = NULL, p_known = LEAST(p_known, 0.5),
                        last_seen_at = now()
                    WHERE org_id = $1 AND user_id = $2 AND skill_id = $3
                    """,
                    org_id,
                    user_id,
                    resolved,
                )
            touched.add(resolved)


@router.post("/events", response_model=EventBatchResponse)
async def ingest_events(
    batch: EventBatch, principal: Principal = Depends(current_principal)
) -> EventBatchResponse:
    await enforce_write_quota(principal, cost=len(batch.events))

    held = await _mastered_skills(principal.org_id, principal.user_id)
    rejected: list[dict[str, Any]] = []
    touched: set[str] = set()
    accepted = 0

    # Within a batch, a learner's events are applied in occurred_at order. Out-of-order
    # arrival across batches is tolerated (the state is recomputable) but logged.
    ordered = sorted(batch.events, key=lambda e: e.occurred_at)

    with metrics.event_batch_seconds.time():
        async with db.pool().acquire() as conn:
            async with conn.transaction():
                for event in ordered:
                    step = index.step(event.step_id) if event.step_id else None
                    reason = _validate(event, step, held)

                    if reason is None and event.event_type == "step_completed":
                        owned = await conn.fetchval(
                            """
                            SELECT 1 FROM submissions
                            WHERE id = $1 AND org_id = $2 AND user_id = $3 AND step_id = $4
                            """,
                            event.submission_id,
                            principal.org_id,
                            principal.user_id,
                            event.step_id,
                        )
                        if not owned:
                            reason = "submission_not_found"
                        else:
                            started = await conn.fetchval(
                                """
                                SELECT max(occurred_at) FROM progress_events
                                WHERE org_id = $1 AND user_id = $2 AND step_id = $3
                                  AND event_type = 'step_started'
                                """,
                                principal.org_id,
                                principal.user_id,
                                event.step_id,
                            )
                            if (
                                started
                                and (event.occurred_at - started).total_seconds()
                                < _MIN_SECONDS_ON_STEP
                            ):
                                reason = "implausible_elapsed_time"

                    if reason is not None:
                        metrics.events_rejected.labels(reason=reason).inc()
                        log.info(
                            "event rejected user=%s step=%s reason=%s",
                            principal.user_id,
                            event.step_id,
                            reason,
                        )
                        rejected.append({"stepId": event.step_id, "reason": reason})
                        continue

                    skill_ids = sorted(step.skills) if step else event.skill_ids
                    await conn.execute(
                        """
                        INSERT INTO progress_events (
                            org_id, user_id, event_type, course_id, step_id, skill_ids,
                            correct, failure_kind, hint_source, payload, content_version,
                            occurred_at)
                        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
                        """,
                        principal.org_id,
                        principal.user_id,
                        event.event_type,
                        step.course_id if step else event.course_id,
                        event.step_id,
                        skill_ids,
                        event.correct,
                        event.failure_kind,
                        event.hint_source,
                        json.dumps(event.payload),
                        index.content_version,
                        event.occurred_at,
                    )
                    metrics.events_ingested.labels(event_type=event.event_type).inc()
                    accepted += 1

                    # Only an attempt is evidence. A step_completed is the bookkeeping
                    # that follows one, so applying BKT to both counted every success
                    # twice — and since it carries no `correct` field, the second
                    # application scored a solved step as a WRONG answer at full weight.
                    if event.event_type == "attempt" and step is not None:
                        await apply_to_skills(
                            conn, principal.org_id, principal.user_id, event, step, touched
                        )
                    elif event.event_type in ("review_passed", "review_failed"):
                        await apply_review(
                            conn, principal.org_id, principal.user_id, event, touched
                        )

    return EventBatchResponse(
        accepted=accepted,
        rejected=rejected,
        skill_state=await _skill_state(principal, only=touched or None),
    )


async def _skill_state(principal: Principal, only: set[str] | None = None) -> list[SkillStateOut]:
    rows = await db.pool().fetch(
        """
        SELECT skill_id, p_known, opportunities, mastered_at, next_review_at,
               consecutive_fails, decayed
        FROM skill_state WHERE org_id = $1 AND user_id = $2
        """,
        principal.org_id,
        principal.user_id,
    )
    mastered = {r["skill_id"] for r in rows if r["mastered_at"] is not None and not r["decayed"]}
    now = datetime.now(UTC)

    out: list[SkillStateOut] = []
    for row in rows:
        if only is not None and row["skill_id"] not in only:
            continue
        skill = index.skill(row["skill_id"])
        out.append(
            SkillStateOut(
                skill_id=row["skill_id"],
                title=skill.title,
                p_known=float(row["p_known"]),
                opportunities=row["opportunities"],
                mastered=row["skill_id"] in mastered,
                unlocked=all(p in mastered for p in skill.prerequisites),
                review_due=bool(row["next_review_at"] and row["next_review_at"] <= now),
                gate=gate_response(row["consecutive_fails"]),
            )
        )
    return out


@router.get("/skills", response_model=list[SkillStateOut])
async def skills(principal: Principal = Depends(current_principal)) -> list[SkillStateOut]:
    """The only source of truth for the skill map.

    Skills the learner has never touched are returned too, so the map can render the
    locked and available states rather than an empty graph.
    """
    known = {s.skill_id: s for s in await _skill_state(principal)}
    mastered = {sid for sid, s in known.items() if s.mastered}

    out = list(known.values())
    for skill_id, skill in index.skills.items():
        if skill_id in known:
            continue
        out.append(
            SkillStateOut(
                skill_id=skill_id,
                title=skill.title,
                p_known=skill.params.p_init,
                opportunities=0,
                mastered=False,
                unlocked=all(p in mastered for p in skill.prerequisites),
                review_due=False,
            )
        )
    return sorted(out, key=lambda s: s.skill_id)


@router.get("/reviews/due", response_model=list[ReviewItem])
async def reviews_due(principal: Principal = Depends(current_principal)) -> list[ReviewItem]:
    rows = await db.pool().fetch(
        """
        SELECT skill_id, next_review_at, review_stage FROM skill_state
        WHERE org_id = $1 AND user_id = $2 AND mastered_at IS NOT NULL
          AND next_review_at IS NOT NULL AND next_review_at <= now()
        ORDER BY next_review_at
        """,
        principal.org_id,
        principal.user_id,
    )
    return [
        ReviewItem(
            skill_id=r["skill_id"],
            title=index.skill(r["skill_id"]).title,
            due_at=r["next_review_at"],
            stage=r["review_stage"],
        )
        for r in rows
    ]


@router.post("/submissions", response_model=SubmissionResponse)
async def create_submission(
    body: SubmissionIn, principal: Principal = Depends(current_principal)
) -> SubmissionResponse:
    if len(body.code.encode()) > settings.submission_max_bytes:
        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, "submission too large")
    if index.step(body.step_id) is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "unknown step")

    await enforce_write_quota(principal)
    submission_id = await db.pool().fetchval(
        """
        INSERT INTO submissions (org_id, user_id, step_id, code, eval_result, content_version)
        VALUES ($1, $2, $3, $4, $5, $6) RETURNING id
        """,
        principal.org_id,
        principal.user_id,
        body.step_id,
        body.code,
        json.dumps(body.eval_result.model_dump()),
        index.content_version,
    )
    return SubmissionResponse(submission_id=submission_id)


@router.post("/hint", response_model=HintResponse, responses={204: {"description": "no hint"}})
async def hint(body: HintRequest, principal: Principal = Depends(current_principal)):
    """Guidance fires only after the authored ladder is exhausted, once per step, and
    never on a review item. A rejected or unavailable hint returns 204 and the learner
    falls back to the authored ladder silently (§19.4)."""
    if not settings.tutor_enabled:
        return Response(status_code=status.HTTP_204_NO_CONTENT)

    step = index.step(body.step_id)
    if step is None or step.ai_guidance == "suppress":
        return Response(status_code=status.HTTP_204_NO_CONTENT)
    if step.type in ("predict", "parsons"):
        return Response(status_code=status.HTTP_204_NO_CONTENT)

    already = await db.pool().fetchval(
        """
        SELECT 1 FROM progress_events
        WHERE org_id = $1 AND user_id = $2 AND step_id = $3
          AND event_type = 'hint_shown' AND hint_source = 'ai'
        LIMIT 1
        """,
        principal.org_id,
        principal.user_id,
        body.step_id,
    )
    if already:
        return Response(status_code=status.HTTP_204_NO_CONTENT)

    code_hash = normalized_code_hash(body.code)
    cached = await db.pool().fetchval(
        """
        SELECT hint FROM ai_hint_cache
        WHERE content_version = $1 AND step_id = $2 AND code_hash = $3
        """,
        index.content_version,
        body.step_id,
        code_hash,
    )
    if cached:
        payload = json.loads(cached) if isinstance(cached, str) else cached
        return HintResponse(observation=payload["observation"], nudge=payload["nudge"])

    try:
        generated = await request_guidance(
            reading_tier=principal.reading_tier,
            skills=sorted(step.skills),
            learner_code=body.code,
            failures=body.failures,
            authored_hints_shown=body.authored_hints_shown,
        )
    except (httpx.HTTPError, TimeoutError) as exc:
        log.info("tutor unavailable, falling back to the authored ladder: %s", exc)
        return Response(status_code=status.HTTP_204_NO_CONTENT)

    if generated is None:
        return Response(status_code=status.HTTP_204_NO_CONTENT)

    await db.pool().execute(
        """
        INSERT INTO ai_hint_cache (content_version, step_id, code_hash, hint)
        VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING
        """,
        index.content_version,
        body.step_id,
        code_hash,
        json.dumps(generated),
    )
    return HintResponse(observation=generated["observation"], nudge=generated["nudge"])
