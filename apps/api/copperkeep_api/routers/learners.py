"""An adult's view of one learner's progress: skills, lessons, activity and code.

Every endpoint is gated by `can_manage` — the learner themself, the org admin, or an
adult linked to them. Nothing here writes.
"""

from __future__ import annotations

import json
from dataclasses import asdict
from uuid import UUID

from fastapi import APIRouter, Depends, Query

from .. import db
from ..content import index
from ..deps import Principal, can_manage, current_principal
from ..people import lesson_rollup
from ..schemas import ActivityOut, LessonProgressOut, SkillStateOut, SubmissionOut
from .learn import skill_map

router = APIRouter(prefix="/v1/learners", tags=["learners"])


@router.get("/{learner_id}/skills", response_model=list[SkillStateOut])
async def skills(
    learner_id: UUID, principal: Principal = Depends(current_principal)
) -> list[SkillStateOut]:
    await can_manage(principal, learner_id)
    return await skill_map(principal.org_id, learner_id)


@router.get("/{learner_id}/progress", response_model=list[LessonProgressOut])
async def progress(
    learner_id: UUID, principal: Principal = Depends(current_principal)
) -> list[LessonProgressOut]:
    """Lessons the learner has touched, with how many of their steps are done."""
    await can_manage(principal, learner_id)
    rows = await db.pool().fetch(
        """
        SELECT step_id,
               bool_or(event_type = 'step_completed') AS completed,
               max(occurred_at) AS last_seen
        FROM progress_events
        WHERE org_id = $1 AND user_id = $2 AND step_id IS NOT NULL
        GROUP BY step_id
        """,
        principal.org_id,
        learner_id,
    )
    completed = {r["step_id"] for r in rows if r["completed"]}
    last_seen = {r["step_id"]: r["last_seen"] for r in rows}
    return [
        LessonProgressOut(**asdict(lesson))
        for lesson in lesson_rollup(index.steps.values(), completed, last_seen)
    ]


@router.get("/{learner_id}/activity", response_model=list[ActivityOut])
async def activity(
    learner_id: UUID,
    limit: int = Query(default=50, ge=1, le=500),
    principal: Principal = Depends(current_principal),
) -> list[ActivityOut]:
    await can_manage(principal, learner_id)
    rows = await db.pool().fetch(
        """
        SELECT event_type, course_id, step_id, correct, failure_kind, hint_source, occurred_at
        FROM progress_events
        WHERE org_id = $1 AND user_id = $2
        ORDER BY occurred_at DESC, id DESC
        LIMIT $3
        """,
        principal.org_id,
        learner_id,
        limit,
    )
    return [ActivityOut(**dict(r)) for r in rows]


@router.get("/{learner_id}/submissions", response_model=list[SubmissionOut])
async def submissions(
    learner_id: UUID,
    step_id: str | None = Query(default=None, max_length=256),
    limit: int = Query(default=20, ge=1, le=200),
    principal: Principal = Depends(current_principal),
) -> list[SubmissionOut]:
    """The code a learner actually wrote, newest first — how they got stuck is usually
    more useful to a parent than whether they did."""
    await can_manage(principal, learner_id)
    rows = await db.pool().fetch(
        """
        SELECT id, step_id, code, eval_result, occurred_at FROM submissions
        WHERE org_id = $1 AND user_id = $2 AND ($3::text IS NULL OR step_id = $3)
        ORDER BY occurred_at DESC
        LIMIT $4
        """,
        principal.org_id,
        learner_id,
        step_id,
        limit,
    )
    out = []
    for r in rows:
        result = r["eval_result"]
        if isinstance(result, str):
            result = json.loads(result)
        out.append(
            SubmissionOut(
                id=r["id"],
                step_id=r["step_id"],
                code=r["code"],
                passed=result.get("passed"),
                eval_result=result,
                occurred_at=r["occurred_at"],
            )
        )
    return out
