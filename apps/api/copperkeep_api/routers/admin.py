"""Adult-only surface: accounts, guardianship, unlocks, and the review scheduler."""

from __future__ import annotations

import logging
import secrets
from datetime import UTC, datetime
from uuid import UUID

import asyncpg
from fastapi import APIRouter, Depends, Header, HTTPException, status

from .. import db
from ..config import settings
from ..content import index
from ..deps import Principal, can_manage, optional_principal, require_admin, require_adult
from ..people import deletion_refusal, demotion_refusal
from ..schemas import (
    CreateAdult,
    CreateCohort,
    CreateLearner,
    EventIn,
    Guardianship,
    PersonOut,
    ResetPin,
    SetPassword,
    UpdatePerson,
)
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
            await _username_free(conn, principal.org_id, body.username)
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
    _audit(principal, "create-learner", learner_id)
    return {"learnerId": str(learner_id)}


@router.post("/learners/{learner_id}/unlock", status_code=status.HTTP_204_NO_CONTENT)
async def unlock(learner_id: UUID, principal: Principal = Depends(require_adult)) -> None:
    """The only way out of a hard lock. Never a timer, never self-service."""
    await can_manage(principal, learner_id)
    await db.pool().execute(
        "DELETE FROM auth_attempts WHERE org_id = $1 AND user_id = $2",
        principal.org_id,
        learner_id,
    )
    _audit(principal, "unlock", learner_id)


@router.post("/learners/{learner_id}/pin", status_code=status.HTTP_204_NO_CONTENT)
async def reset_pin(
    learner_id: UUID, body: ResetPin, principal: Principal = Depends(require_adult)
) -> None:
    """The adult's unconditional reset capability.

    A body, not a query parameter — a PIN in a URL ends up in every access log and proxy
    trace between here and the browser.
    """
    await can_manage(principal, learner_id)
    await db.pool().execute(
        "UPDATE users SET pin_hash = $3 WHERE org_id = $1 AND id = $2",
        principal.org_id,
        learner_id,
        hash_secret(body.pin),
    )
    _audit(principal, "reset-pin", learner_id)


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
    await can_manage(principal, learner_id)

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
                    await apply_to_skills(conn, principal.org_id, learner_id, event, step, touched)
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


# --- accounts ------------------------------------------------------------------------


def _audit(principal: Principal, action: str, target: UUID) -> None:
    """Who did what to whom. Never the secret involved."""
    log.info("admin action %s by %s on %s", action, principal.user_id, target)


async def _username_free(conn: asyncpg.Connection, org_id: UUID, username: str) -> None:
    taken = await conn.fetchval(
        "SELECT 1 FROM users WHERE org_id = $1 AND lower(username) = lower($2)", org_id, username
    )
    if taken:
        raise HTTPException(status.HTTP_409_CONFLICT, f"the username {username} is taken")


async def _admin_count(conn: asyncpg.Connection, org_id: UUID) -> int:
    return await conn.fetchval("SELECT count(*) FROM users WHERE org_id = $1 AND is_admin", org_id)


@router.get("/users", response_model=list[PersonOut])
async def list_users(principal: Principal = Depends(require_adult)) -> list[PersonOut]:
    """The org admin sees everyone; any other adult sees themself and their learners."""
    rows = await db.pool().fetch(
        """
        SELECT u.id, u.username, u.display_name, u.role, u.is_admin, u.reading_tier,
               u.created_at,
               (SELECT max(occurred_at) FROM progress_events e
                 WHERE e.org_id = u.org_id AND e.user_id = u.id) AS last_active,
               COALESCE(a.locked_until > now(), false) AS locked,
               COALESCE(a.failures, 0) AS failed_attempts,
               CASE WHEN u.role = 'learner' THEN
                   ARRAY(SELECT adult_user_id FROM guardianship g
                          WHERE g.org_id = u.org_id AND g.learner_user_id = u.id)
               ELSE
                   ARRAY(SELECT learner_user_id FROM guardianship g
                          WHERE g.org_id = u.org_id AND g.adult_user_id = u.id)
               END AS linked
        FROM users u
        LEFT JOIN auth_attempts a ON a.org_id = u.org_id AND a.user_id = u.id
        WHERE u.org_id = $1
          AND ($3 OR u.id = $2 OR u.id IN (
                SELECT learner_user_id FROM guardianship
                WHERE org_id = $1 AND adult_user_id = $2))
        ORDER BY u.role, lower(u.display_name)
        """,
        principal.org_id,
        principal.user_id,
        principal.is_admin,
    )
    return [PersonOut(**dict(r)) for r in rows]


@router.post("/adults", status_code=status.HTTP_201_CREATED)
async def create_adult(
    body: CreateAdult, principal: Principal = Depends(require_admin)
) -> dict[str, str]:
    async with db.pool().acquire() as conn:
        async with conn.transaction():
            await _username_free(conn, principal.org_id, body.username)
            adult_id = await conn.fetchval(
                """
                INSERT INTO users (org_id, username, display_name, role, password_hash,
                                   reading_tier, theme, is_admin)
                VALUES ($1, $2, $3, 'adult', $4, 'adult', 'auto', $5) RETURNING id
                """,
                principal.org_id,
                body.username,
                body.display_name,
                hash_secret(body.password),
                body.is_admin,
            )
    _audit(principal, "create-adult", adult_id)
    return {"userId": str(adult_id)}


@router.patch("/users/{user_id}", response_model=PersonOut)
async def update_user(
    user_id: UUID, body: UpdatePerson, principal: Principal = Depends(require_adult)
) -> PersonOut:
    await can_manage(principal, user_id)
    if body.is_admin is not None and not principal.is_admin:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "only the org admin can change admins")

    async with db.pool().acquire() as conn:
        async with conn.transaction():
            target = await conn.fetchrow(
                "SELECT role, is_admin, username FROM users WHERE org_id = $1 AND id = $2",
                principal.org_id,
                user_id,
            )
            if body.is_admin and target["role"] != "adult":
                raise HTTPException(status.HTTP_400_BAD_REQUEST, "only adults can be admins")
            refusal = demotion_refusal(
                target["is_admin"], body.is_admin, await _admin_count(conn, principal.org_id)
            )
            if refusal:
                raise HTTPException(status.HTTP_409_CONFLICT, refusal)
            if body.username and body.username.lower() != target["username"].lower():
                await _username_free(conn, principal.org_id, body.username)
            await conn.execute(
                """
                UPDATE users SET
                    display_name = COALESCE($3, display_name),
                    username     = COALESCE($4, username),
                    reading_tier = COALESCE($5, reading_tier),
                    is_admin     = COALESCE($6, is_admin)
                WHERE org_id = $1 AND id = $2
                """,
                principal.org_id,
                user_id,
                body.display_name,
                body.username,
                body.reading_tier,
                body.is_admin,
            )
    _audit(principal, "update", user_id)
    return await _person(principal, user_id)


async def _person(principal: Principal, user_id: UUID) -> PersonOut:
    people = await list_users(principal)
    for person in people:
        if person.id == user_id:
            return person
    raise HTTPException(status.HTTP_404_NOT_FOUND, "no such user")


@router.post("/users/{user_id}/password", status_code=status.HTTP_204_NO_CONTENT)
async def set_password(
    user_id: UUID, body: SetPassword, principal: Principal = Depends(require_adult)
) -> None:
    """An adult's password: the admin can reset anyone's, and anyone can change their
    own. Every other session of that account ends, so a leaked password stops working
    everywhere at once."""
    if user_id != principal.user_id and not principal.is_admin:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "only the org admin can do that")
    role = await db.pool().fetchval(
        "SELECT role FROM users WHERE org_id = $1 AND id = $2", principal.org_id, user_id
    )
    if role is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "no such user")
    if role != "adult":
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "learners use a PIN")
    async with db.pool().acquire() as conn:
        async with conn.transaction():
            await conn.execute(
                "UPDATE users SET password_hash = $3 WHERE org_id = $1 AND id = $2",
                principal.org_id,
                user_id,
                hash_secret(body.password),
            )
            await conn.execute(
                """
                UPDATE sessions SET revoked_at = now()
                WHERE org_id = $1 AND user_id = $2 AND id <> $3 AND revoked_at IS NULL
                """,
                principal.org_id,
                user_id,
                principal.session_id,
            )
    _audit(principal, "set-password", user_id)


async def _check_link(principal: Principal, body: Guardianship) -> None:
    roles = await db.pool().fetch(
        "SELECT id, role FROM users WHERE org_id = $1 AND id = ANY($2::uuid[])",
        principal.org_id,
        [body.adult_id, body.learner_id],
    )
    by_id = {r["id"]: r["role"] for r in roles}
    if by_id.get(body.adult_id) != "adult" or by_id.get(body.learner_id) != "learner":
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "link an adult to a learner")


@router.put("/guardianship", status_code=status.HTTP_204_NO_CONTENT)
async def link(body: Guardianship, principal: Principal = Depends(require_admin)) -> None:
    await _check_link(principal, body)
    await db.pool().execute(
        """
        INSERT INTO guardianship (org_id, adult_user_id, learner_user_id, relationship)
        VALUES ($1, $2, $3, 'guardian') ON CONFLICT DO NOTHING
        """,
        principal.org_id,
        body.adult_id,
        body.learner_id,
    )
    _audit(principal, "link", body.learner_id)


@router.delete("/guardianship", status_code=status.HTTP_204_NO_CONTENT)
async def unlink(body: Guardianship, principal: Principal = Depends(require_admin)) -> None:
    await db.pool().execute(
        """
        DELETE FROM guardianship
        WHERE org_id = $1 AND adult_user_id = $2 AND learner_user_id = $3
        """,
        principal.org_id,
        body.adult_id,
        body.learner_id,
    )
    _audit(principal, "unlink", body.learner_id)


@router.delete("/users/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_user(user_id: UUID, principal: Principal = Depends(require_admin)) -> None:
    """Removes the account and, by cascade, everything they did. Irreversible — the
    client asks for the username typed out before calling this."""
    async with db.pool().acquire() as conn:
        async with conn.transaction():
            target_is_admin = await conn.fetchval(
                "SELECT is_admin FROM users WHERE org_id = $1 AND id = $2",
                principal.org_id,
                user_id,
            )
            if target_is_admin is None:
                raise HTTPException(status.HTTP_404_NOT_FOUND, "no such user")
            refusal = deletion_refusal(
                principal.user_id,
                user_id,
                target_is_admin,
                await _admin_count(conn, principal.org_id),
            )
            if refusal:
                raise HTTPException(status.HTTP_409_CONFLICT, refusal)
            await conn.execute(
                "DELETE FROM users WHERE org_id = $1 AND id = $2", principal.org_id, user_id
            )
    _audit(principal, "delete", user_id)
