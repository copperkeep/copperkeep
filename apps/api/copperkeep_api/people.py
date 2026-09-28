"""Rules for the adult-facing account and progress views, kept free of I/O so they can
be tested without a database."""

from __future__ import annotations

from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from datetime import datetime

from .content import StepDef


@dataclass(frozen=True)
class LessonProgress:
    course_id: str
    lesson_id: str
    steps_total: int
    steps_completed: int
    last_activity: datetime | None


def lesson_rollup(
    steps: Iterable[StepDef],
    completed: set[str],
    last_seen: Mapping[str, datetime],
) -> list[LessonProgress]:
    """Per-lesson counts from the content index and the steps a learner completed.

    Only lessons the learner has touched are returned: the web app already holds every
    course tree and renders the rest as not started. `completed` and `last_seen` are
    keyed by step id; a completion for a step no longer in the content is ignored.
    """
    totals: dict[tuple[str, str], int] = {}
    done: dict[tuple[str, str], int] = {}
    latest: dict[tuple[str, str], datetime] = {}
    for step in steps:
        key = (step.course_id, step.lesson_id)
        totals[key] = totals.get(key, 0) + 1
        if step.id in completed:
            done[key] = done.get(key, 0) + 1
        seen = last_seen.get(step.id)
        if seen is not None and (key not in latest or seen > latest[key]):
            latest[key] = seen

    return [
        LessonProgress(
            course_id=course_id,
            lesson_id=lesson_id,
            steps_total=totals[(course_id, lesson_id)],
            steps_completed=done.get((course_id, lesson_id), 0),
            last_activity=latest.get((course_id, lesson_id)),
        )
        for (course_id, lesson_id) in totals
        if (course_id, lesson_id) in latest or (course_id, lesson_id) in done
    ]


def deletion_refusal(
    actor_id: object, target_id: object, target_is_admin: bool, admin_count: int
) -> str | None:
    """Why an account may not be removed, or None if it may. Removing yourself would
    end your own session mid-request; removing the last admin would leave an org that
    nobody can manage."""
    if actor_id == target_id:
        return "you cannot remove your own account"
    if target_is_admin and admin_count <= 1:
        return "this is the only admin — make someone else an admin first"
    return None


def demotion_refusal(
    target_is_admin: bool, make_admin: bool | None, admin_count: int
) -> str | None:
    """The same last-admin rule, for taking the admin flag away."""
    if make_admin is False and target_is_admin and admin_count <= 1:
        return "this is the only admin — make someone else an admin first"
    return None
