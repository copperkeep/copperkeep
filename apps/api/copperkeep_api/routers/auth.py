from __future__ import annotations

from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Response, status

from .. import db, metrics
from ..config import settings
from ..content import index
from ..deps import SESSION_COOKIE, Principal, current_principal
from ..schemas import LoginRequest, LoginResponse, MeResponse
from ..security import new_session_token, session_token_hash, verify_secret

router = APIRouter(prefix="/v1", tags=["auth"])

_HARD_LOCK = timedelta(days=36_500)
_MAX_BACKOFF_SECONDS = 15 * 60

_CREDENTIAL_COLUMN = {
    "pin": "pin_hash",
    "password": "password_hash",
    "picture": "picture_seq_hash",
}


async def _record_failure(org_id, user_id, role: str) -> None:
    """Exponential backoff, then a hard lock for learners only.

    Adults back off but never hard-lock — there may be no one above them to unlock it.
    Recovery codes are the bypass, which is what they are for.
    """
    row = await db.pool().fetchrow(
        """
        INSERT INTO auth_attempts (org_id, user_id, window_start, failures)
        VALUES ($1, $2, now(), 1)
        ON CONFLICT (org_id, user_id) DO UPDATE
            SET failures = auth_attempts.failures + 1, window_start = now()
        RETURNING failures
        """,
        org_id,
        user_id,
    )
    failures = row["failures"]
    metrics.auth_failures.labels(role=role).inc()

    if role == "learner" and failures >= settings.auth_hard_lock_after:
        locked_until = datetime.now(UTC) + _HARD_LOCK
    elif failures >= settings.auth_backoff_after:
        seconds = min(2 ** (failures - settings.auth_backoff_after + 1), _MAX_BACKOFF_SECONDS)
        locked_until = datetime.now(UTC) + timedelta(seconds=seconds)
    else:
        return

    await db.pool().execute(
        "UPDATE auth_attempts SET locked_until = $3 WHERE org_id = $1 AND user_id = $2",
        org_id,
        user_id,
        locked_until,
    )


@router.post("/auth/login", response_model=LoginResponse)
async def login(body: LoginRequest, response: Response) -> LoginResponse:
    user = await db.pool().fetchrow(
        """
        SELECT u.*, o.id AS oid FROM users u
        JOIN orgs o ON o.id = u.org_id
        WHERE o.slug = $1 AND u.username = $2
        """,
        body.org,
        body.username,
    )
    # Same response shape whether the account exists or not — a learner enumerating
    # classmates learns nothing from the status code.
    if user is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "invalid credentials")

    locked_until = await db.pool().fetchval(
        "SELECT locked_until FROM auth_attempts WHERE org_id = $1 AND user_id = $2",
        user["org_id"],
        user["id"],
    )
    if locked_until and locked_until > datetime.now(UTC):
        raise HTTPException(
            status.HTTP_429_TOO_MANY_REQUESTS,
            "account temporarily locked — ask an adult to unlock it",
        )

    if body.method == "qr":
        ok = False
        for cred in await db.pool().fetch(
            """
            SELECT secret_hash_or_pubkey FROM device_credentials
            WHERE org_id = $1 AND user_id = $2 AND kind = 'qr_token' AND revoked_at IS NULL
            """,
            user["org_id"],
            user["id"],
        ):
            if verify_secret(body.secret, cred["secret_hash_or_pubkey"]):
                ok = True
                break
    else:
        column = _CREDENTIAL_COLUMN[body.method]
        ok = verify_secret(body.secret, user[column])

    if not ok:
        await _record_failure(user["org_id"], user["id"], user["role"])
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "invalid credentials")

    await db.pool().execute(
        "DELETE FROM auth_attempts WHERE org_id = $1 AND user_id = $2",
        user["org_id"],
        user["id"],
    )

    token = new_session_token()
    await db.pool().execute(
        """
        INSERT INTO sessions (org_id, user_id, token_hash, device_label, expires_at)
        VALUES ($1, $2, $3, $4, now() + ($5 || ' hours')::interval)
        """,
        user["org_id"],
        user["id"],
        session_token_hash(token),
        body.device_label,
        str(settings.session_ttl_hours),
    )
    response.set_cookie(
        SESSION_COOKIE,
        token,
        httponly=True,
        secure=settings.cookie_secure,
        samesite="strict",
        max_age=settings.session_ttl_hours * 3600,
        path="/",
    )
    return LoginResponse(
        user_id=user["id"],
        display_name=user["display_name"],
        role=user["role"],
        reading_tier=user["reading_tier"],
        theme=user["theme"],
    )


@router.post("/auth/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(response: Response, principal: Principal = Depends(current_principal)) -> None:
    await db.pool().execute(
        "UPDATE sessions SET revoked_at = now() WHERE id = $1", principal.session_id
    )
    response.delete_cookie(SESSION_COOKIE, path="/")


@router.get("/me", response_model=MeResponse)
async def me(principal: Principal = Depends(current_principal)) -> MeResponse:
    learners = await db.pool().fetch(
        """
        SELECT u.id, u.display_name, u.reading_tier FROM guardianship g
        JOIN users u ON u.id = g.learner_user_id
        WHERE g.org_id = $1 AND g.adult_user_id = $2
        ORDER BY u.display_name
        """,
        principal.org_id,
        principal.user_id,
    )
    return MeResponse(
        user_id=principal.user_id,
        org=principal.org_slug,
        display_name=principal.display_name,
        role=principal.role,
        reading_tier=principal.reading_tier,
        theme=principal.theme,
        content_version=index.content_version,
        owned_learners=[
            {"id": str(r["id"]), "displayName": r["display_name"], "readingTier": r["reading_tier"]}
            for r in learners
        ],
    )
