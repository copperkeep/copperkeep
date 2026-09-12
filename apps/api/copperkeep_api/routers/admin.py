"""Adult-only surface: roster management, unlocks, and the review scheduler."""

from __future__ import annotations

import logging
import secrets
from datetime import UTC, datetime
from uuid import UUID

from fastapi import APIRouter, Depends, Header, HTTPException, status

from .. import db
from ..config import settings
from ..content import index
from ..deps import Principal, guardianship_or_self, optional_principal, require_adult
from ..schemas import CreateCohort, CreateLearner, EventIn, ResetPin
from ..security import hash_secret
from .learn import apply_review, apply_to_skills

log = logging.getLogger(__name__)
router = APIRouter(prefix="/v1/admin", tags=["admin"])


@router.post("/learners", status_code=status.HTTP_201_CREATED)
async def create_learner(
    body: CreateLearner, principal: Principal = Depends(require_adult)
) -> dict[str, str]:
    async with db.pool().acquire() as conn:
        async with conn.transaction():
            learner_id = await conn.fetchval(
                """
                INSERT INTO users (org_id, username, display_name, role, pin_hash, reading_tier)
                VALUES ($1, $2, $3, 'learner', $4, $5) RETURNING id
                """,
                principal.org_id,
                body.username,
                body.display_name,
                hash_secret(body.pin),
                body.reading_tier,
            )
            await conn.execute(
                """
                INSERT INTO guardianship (org_id, adult_user_id, learner_user_id, relationship)
                VALUES ($1, $2, $3, 'owner')
                """,
                principal.org_id,
                principal.user_id,
                learner_id,
            )
    return {"learnerId": str(learner_id)}


@router.post("/learners/{learner_id}/unlock", status_code=status.HTTP_204_NO_CONTENT)
async def unlock(learner_id: UUID, principal: Principal = Depends(require_adult)) -> None:
    """The only way out of a hard lock. Never a timer, never self-service."""
    await guardianship_or_self(principal, learner_id)
    await db.pool().execute(
        "DELETE FROM auth_attempts WHERE org_id = $1 AND user_id = $2",
        principal.org_id,
        learner_id,
    )


@router.post("/learners/{learner_id}/pin", status_code=status.HTTP_204_NO_CONTENT)
async def reset_pin(
    learner_id: UUID, body: ResetPin, principal: Principal = Depends(require_adult)
) -> None:
    """The adult's unconditional reset capability.

    A body, not a query parameter — a PIN in a URL ends up in every access log and proxy
    trace between here and the browser.
    """
    await guardianship_or_self(principal, learner_id)
    await db.pool().execute(
        "UPDATE users SET pin_hash = $3 WHERE org_id = $1 AND id = $2",
        principal.org_id,
        learner_id,
        hash_secret(body.pin),
    )


@router.post("/cohorts", status_code=status.HTTP_201_CREATED)
async def create_cohort(
    body: CreateCohort, principal: Principal = Depends(require_adult)
) -> dict[str, str]:
    name = body.name
    join_code = secrets.token_hex(3).upper()
    cohort_id = await db.pool().fetchval(
        """
        INSERT INTO cohorts (org_id, name, join_code, created_by)
        VALUES ($1, $2, $3, $4) RETURNING id
        """,
        principal.org_id,
        name,
        join_code,
        principal.user_id,
    )
    return {"cohortId": str(cohort_id), "joinCode": join_code}


@router.post("/learners/{learner_id}/recompute")
async def recompute(
    learner_id: UUID, principal: Principal = Depends(require_adult)
) -> dict[str, int]:
    """Rebuild skill_state from the event log.

    This is the payoff of the append-only design: a BKT parameter change or an ontology
    split is a replay, not a migration. Historical events keep their original skill IDs;
    the transition mapping is applied here, at projection time.
    """
    await guardianship_or_self(principal, learner_id)

    applied = 0
    async with db.pool().acquire() as conn:
        async with conn.transaction():
            await conn.execute(
                "DELETE FROM skill_state WHERE org_id = $1 AND user_id = $2",
                principal.org_id,
                learner_id,
            )
            rows = await conn.fetch(
                """
                SELECT * FROM progress_events
                WHERE org_id = $1 AND user_id = $2
                ORDER BY occurred_at, id
                """,
                principal.org_id,
                learner_id,
            )
            touched: set[str] = set()
            for row in rows:
                event = EventIn(
                    event_type=row["event_type"],
                    course_id=row["course_id"],
                    step_id=row["step_id"],
                    skill_ids=list(row["skill_ids"]),
                    correct=row["correct"],
                    failure_kind=row["failure_kind"],
                    hint_source=row["hint_source"],
                    occurred_at=row["occurred_at"],
                )
                step = index.step(event.step_id) if event.step_id else None
                if event.event_type in ("attempt", "step_completed") and step is not None:
                    await apply_to_skills(
                        conn, principal.org_id, learner_id, event, step, touched
                    )
                    applied += 1
                elif event.event_type in ("review_passed", "review_failed"):
                    await apply_review(conn, principal.org_id, learner_id, event, touched)
                    applied += 1

    return {"eventsReplayed": len(rows), "eventsApplied": applied}


@router.post("/reviews/schedule")
async def schedule_reviews(
    principal: Principal | None = Depends(optional_principal),
    x_copperkeep_admin_token: str | None = Header(default=None),
) -> dict[str, int]:
    """Emits a review_due event for every skill whose interval has elapsed.

    Called by a CronJob (a Compose sidecar with cron), never an in-process timer —
    that would fire once per replica.
    """
    if x_copperkeep_admin_token is not None:
        if not settings.admin_token or not secrets.compare_digest(
            x_copperkeep_admin_token, settings.admin_token
        ):
            raise HTTPException(status.HTTP_403_FORBIDDEN, "invalid admin token")
    elif principal is None or principal.role != "adult":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "adult role required")

    due = await db.pool().fetch(
        """
        SELECT org_id, user_id, skill_id FROM skill_state
        WHERE mastered_at IS NOT NULL AND NOT decayed
          AND next_review_at IS NOT NULL AND next_review_at <= now()
        """
    )
    now = datetime.now(UTC)
    for row in due:
        await db.pool().execute(
            """
            INSERT INTO progress_events (org_id, user_id, event_type, skill_ids, occurred_at)
            SELECT $1, $2, 'review_due', ARRAY[$3], $4
            WHERE NOT EXISTS (
                SELECT 1 FROM progress_events
                WHERE org_id = $1 AND user_id = $2 AND event_type = 'review_due'
                  AND skill_ids = ARRAY[$3] AND occurred_at > now() - interval '1 day'
            )
            """,
            row["org_id"],
            row["user_id"],
            row["skill_id"],
            now,
        )
    log.info("review scheduler queued %d items", len(due))
    return {"queued": len(due)}
