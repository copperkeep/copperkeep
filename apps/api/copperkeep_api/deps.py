from __future__ import annotations

from dataclasses import dataclass
from uuid import UUID

from fastapi import Depends, HTTPException, Request, status

from . import db
from .config import settings
from .security import session_token_hash

SESSION_COOKIE = "ck_session"


@dataclass(frozen=True)
class Principal:
    user_id: UUID
    org_id: UUID
    org_slug: str
    username: str
    display_name: str
    role: str
    reading_tier: str
    theme: str
    session_id: UUID


async def current_principal(request: Request) -> Principal:
    token = request.cookies.get(SESSION_COOKIE)
    if not token:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "not signed in")

    row = await db.pool().fetchrow(
        """
        SELECT s.id AS session_id, u.id AS user_id, u.org_id, o.slug AS org_slug,
               u.username, u.display_name, u.role, u.reading_tier, u.theme
        FROM sessions s
        JOIN users u ON u.id = s.user_id
        JOIN orgs o ON o.id = u.org_id
        WHERE s.token_hash = $1 AND s.revoked_at IS NULL AND s.expires_at > now()
        """,
        session_token_hash(token),
    )
    if row is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "session expired")

    return Principal(
        user_id=row["user_id"],
        org_id=row["org_id"],
        org_slug=row["org_slug"],
        username=row["username"],
        display_name=row["display_name"],
        role=row["role"],
        reading_tier=row["reading_tier"],
        theme=row["theme"],
        session_id=row["session_id"],
    )


async def optional_principal(request: Request) -> Principal | None:
    try:
        return await current_principal(request)
    except HTTPException:
        return None


async def require_adult(principal: Principal = Depends(current_principal)) -> Principal:
    if principal.role != "adult":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "adult role required")
    return principal


async def enforce_write_quota(principal: Principal, cost: int = 1) -> None:
    """Per-session write ceiling. One DevTools fetch() loop must not starve the class."""
    allowed = await db.pool().fetchval(
        """
        INSERT INTO write_quota (org_id, user_id, window_start, writes)
        VALUES ($1, $2, date_trunc('minute', now()), $3)
        ON CONFLICT (org_id, user_id) DO UPDATE SET
            window_start = CASE
                WHEN write_quota.window_start < date_trunc('minute', now())
                THEN date_trunc('minute', now()) ELSE write_quota.window_start END,
            writes = CASE
                WHEN write_quota.window_start < date_trunc('minute', now())
                THEN $3 ELSE write_quota.writes + $3 END
        RETURNING writes
        """,
        principal.org_id,
        principal.user_id,
        cost,
    )
    if allowed > settings.event_writes_per_minute:
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "write quota exceeded")


async def guardianship_or_self(principal: Principal, learner_id: UUID) -> None:
    if principal.user_id == learner_id:
        return
    if principal.role != "adult":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "not permitted")
    linked = await db.pool().fetchval(
        """
        SELECT 1 FROM guardianship
        WHERE org_id = $1 AND adult_user_id = $2 AND learner_user_id = $3
        """,
        principal.org_id,
        principal.user_id,
        learner_id,
    )
    if not linked:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "not this learner's guardian")
