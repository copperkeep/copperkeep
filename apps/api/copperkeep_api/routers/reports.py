"""The parent / instructor projection.

Deliberately not a grade, a percentile, or a leaderboard. The most useful thing on the
page is the last field — two or three questions to ask out loud — and it is the easiest
one to leave out.
"""

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends

from .. import db
from ..content import index
from ..deps import Principal, current_principal, guardianship_or_self
from ..schemas import ReportResponse

router = APIRouter(prefix="/v1", tags=["reports"])

# Any gap longer than this is the learner walking away, not working.
_IDLE_CUTOFF_SECONDS = 300


@router.get("/reports/{learner_id}", response_model=ReportResponse)
async def report(
    learner_id: UUID,
    window_days: int = 7,
    principal: Principal = Depends(current_principal),
) -> ReportResponse:
    await guardianship_or_self(principal, learner_id)

    learner = await db.pool().fetchrow(
        "SELECT display_name FROM users WHERE id = $1 AND org_id = $2",
        learner_id,
        principal.org_id,
    )
    name = learner["display_name"] if learner else "Learner"

    mastered = await db.pool().fetch(
        """
        SELECT skill_id FROM skill_state
        WHERE org_id = $1 AND user_id = $2 AND mastered_at IS NOT NULL
          AND mastered_at > now() - ($3 || ' days')::interval
        ORDER BY mastered_at
        """,
        principal.org_id,
        learner_id,
        str(window_days),
    )

    seconds = await db.pool().fetchval(
        """
        SELECT COALESCE(SUM(LEAST(gap, $4)), 0) FROM (
            SELECT EXTRACT(EPOCH FROM occurred_at - LAG(occurred_at)
                   OVER (ORDER BY occurred_at)) AS gap
            FROM progress_events
            WHERE org_id = $1 AND user_id = $2
              AND occurred_at > now() - ($3 || ' days')::interval
        ) gaps WHERE gap IS NOT NULL
        """,
        principal.org_id,
        learner_id,
        str(window_days),
        _IDLE_CUTOFF_SECONDS,
    )

    # Where they got stuck is a skill, never a lesson.
    stuck = await db.pool().fetch(
        """
        SELECT skill_id, consecutive_fails FROM skill_state
        WHERE org_id = $1 AND user_id = $2 AND consecutive_fails >= 2
        ORDER BY consecutive_fails DESC LIMIT 5
        """,
        principal.org_id,
        learner_id,
    )

    reviews = await db.pool().fetch(
        """
        SELECT event_type, count(*) AS n FROM progress_events
        WHERE org_id = $1 AND user_id = $2
          AND event_type IN ('review_passed', 'review_failed')
          AND occurred_at > now() - ($3 || ' days')::interval
        GROUP BY event_type
        """,
        principal.org_id,
        learner_id,
        str(window_days),
    )

    # Syntax trouble is worth surfacing to a parent even though it never moves a gate.
    syntax_trouble = await db.pool().fetchval(
        """
        SELECT count(*) FROM progress_events
        WHERE org_id = $1 AND user_id = $2 AND failure_kind = 'parse'
          AND occurred_at > now() - ($3 || ' days')::interval
        """,
        principal.org_id,
        learner_id,
        str(window_days),
    )

    recent = [r["skill_id"] for r in mastered][-3:]
    questions = []
    for skill_id in recent:
        skill = index.skill(skill_id)
        if skill.report_question:
            questions.append(skill.report_question.replace("{name}", name))
        else:
            questions.append(f"Ask {name} to show you what “{skill.title}” does.")

    return ReportResponse(
        learner_id=learner_id,
        display_name=name,
        window_days=window_days,
        skills_mastered=[r["skill_id"] for r in mastered],
        minutes_on_task=int(float(seconds) // 60),
        stuck_on=[
            {"skillId": r["skill_id"], "consecutiveFailures": r["consecutive_fails"]}
            for r in stuck
        ],
        review_performance={r["event_type"]: r["n"] for r in reviews},
        syntax_trouble=syntax_trouble or 0,
        questions_to_ask=questions,
    )
