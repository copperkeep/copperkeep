from __future__ import annotations

from datetime import datetime
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, Field

EventType = Literal[
    "step_started",
    "attempt",
    "hint_shown",
    "step_completed",
    "review_due",
    "review_passed",
    "review_failed",
]
FailureKind = Literal["parse", "runtime", "semantic", "timeout"]
ReadingTier = Literal["grade3", "grade7", "adult"]


class LoginRequest(BaseModel):
    org: str = "home"
    username: str = Field(max_length=64)
    method: Literal["pin", "password", "picture", "qr"] = "pin"
    secret: str = Field(max_length=256)
    device_label: str | None = Field(default=None, max_length=64)


class LoginResponse(BaseModel):
    user_id: UUID
    display_name: str
    role: Literal["adult", "learner"]
    reading_tier: ReadingTier
    theme: Literal["auto", "light", "dark"]


class MeResponse(LoginResponse):
    org: str
    content_version: str | None
    owned_learners: list[dict[str, Any]] = []


class EventIn(BaseModel):
    event_type: EventType
    course_id: str | None = Field(default=None, max_length=128)
    step_id: str | None = Field(default=None, max_length=256)
    skill_ids: list[str] = Field(default_factory=list, max_length=16)
    correct: bool | None = None
    failure_kind: FailureKind | None = None
    hint_source: Literal["authored", "ai"] | None = None
    submission_id: UUID | None = None
    payload: dict[str, Any] = Field(default_factory=dict)
    occurred_at: datetime


class EventBatch(BaseModel):
    """Batched so a burst of client telemetry is one request, not twenty."""

    events: list[EventIn] = Field(max_length=50)


class SkillStateOut(BaseModel):
    skill_id: str
    title: str
    p_known: float
    opportunities: int
    mastered: bool
    unlocked: bool
    review_due: bool
    gate: str | None = None


class EventBatchResponse(BaseModel):
    accepted: int
    rejected: list[dict[str, Any]] = []
    skill_state: list[SkillStateOut] = []


class EvalCase(BaseModel):
    id: str = Field(max_length=128)
    passed: bool
    expected: str | None = Field(default=None, max_length=4096)
    actual: str | None = Field(default=None, max_length=4096)
    message: str = Field(default="", max_length=1024)


class EvalResultIn(BaseModel):
    passed: bool
    failure_kind: FailureKind | None = None
    cases: list[EvalCase] = Field(default_factory=list, max_length=64)
    duration_ms: int = 0


class SubmissionIn(BaseModel):
    step_id: str = Field(max_length=256)
    code: str
    eval_result: EvalResultIn


class SubmissionResponse(BaseModel):
    submission_id: UUID


class HintRequest(BaseModel):
    step_id: str = Field(max_length=256)
    code: str
    authored_hints_shown: list[str] = Field(default_factory=list, max_length=8)
    failures: list[dict[str, Any]] = Field(default_factory=list, max_length=8)


class HintResponse(BaseModel):
    observation: str
    nudge: str
    source: Literal["ai"] = "ai"


class ReviewItem(BaseModel):
    skill_id: str
    title: str
    due_at: datetime
    stage: int


class ReportResponse(BaseModel):
    learner_id: UUID
    display_name: str
    window_days: int
    skills_mastered: list[str]
    minutes_on_task: int
    stuck_on: list[dict[str, Any]]
    review_performance: dict[str, int]
    syntax_trouble: int
    questions_to_ask: list[str]


class CreateLearner(BaseModel):
    username: str = Field(max_length=64)
    display_name: str = Field(max_length=64)
    pin: str = Field(min_length=4, max_length=8)
    reading_tier: ReadingTier = "grade3"
