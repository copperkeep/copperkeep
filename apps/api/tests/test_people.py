from datetime import UTC, datetime, timedelta

from copperkeep_api.content import StepDef
from copperkeep_api.people import deletion_refusal, demotion_refusal, lesson_rollup

T0 = datetime(2026, 9, 27, 12, 0, tzinfo=UTC)


def step(step_id: str, lesson: str, course: str = "python-a") -> StepDef:
    return StepDef(id=step_id, course_id=course, lesson_id=lesson, type="free-code", skills={})


STEPS = [
    step("a1", "say-hello"),
    step("a2", "say-hello"),
    step("a3", "say-hello"),
    step("b1", "for-range"),
    step("b2", "for-range"),
    step("c1", "scope", course="python-b"),
]


def test_rollup_counts_completed_steps_per_lesson():
    rows = lesson_rollup(STEPS, {"a1", "a2"}, {"a1": T0, "a2": T0 + timedelta(minutes=3)})
    assert len(rows) == 1
    (hello,) = rows
    assert (hello.lesson_id, hello.steps_total, hello.steps_completed) == ("say-hello", 3, 2)
    assert hello.last_activity == T0 + timedelta(minutes=3)


def test_rollup_includes_a_started_but_unfinished_lesson():
    rows = lesson_rollup(STEPS, set(), {"b1": T0})
    assert [(r.lesson_id, r.steps_completed) for r in rows] == [("for-range", 0)]


def test_rollup_omits_untouched_lessons_and_unknown_steps():
    rows = lesson_rollup(STEPS, {"retired-step"}, {"retired-step": T0})
    assert rows == []


def test_rollup_keeps_courses_apart():
    rows = lesson_rollup(STEPS, {"c1"}, {"c1": T0})
    assert [(r.course_id, r.lesson_id, r.steps_completed) for r in rows] == [
        ("python-b", "scope", 1)
    ]


def test_you_cannot_remove_yourself():
    assert deletion_refusal("me", "me", target_is_admin=True, admin_count=2)


def test_the_last_admin_cannot_be_removed():
    assert deletion_refusal("me", "them", target_is_admin=True, admin_count=1)


def test_a_second_admin_or_a_learner_can_be_removed():
    assert deletion_refusal("me", "them", target_is_admin=True, admin_count=2) is None
    assert deletion_refusal("me", "kid", target_is_admin=False, admin_count=1) is None


def test_the_last_admin_cannot_be_demoted():
    assert demotion_refusal(target_is_admin=True, make_admin=False, admin_count=1)
    assert demotion_refusal(target_is_admin=True, make_admin=False, admin_count=2) is None
    assert demotion_refusal(target_is_admin=True, make_admin=None, admin_count=1) is None
    assert demotion_refusal(target_is_admin=False, make_admin=True, admin_count=1) is None


def test_every_adult_view_route_is_registered():
    from copperkeep_api.main import app

    # The OpenAPI schema, not app.routes: newer FastAPI wraps included routers.
    routes = {
        (method.upper(), path) for path, ops in app.openapi()["paths"].items() for method in ops
    }
    for expected in [
        ("GET", "/v1/admin/users"),
        ("POST", "/v1/admin/adults"),
        ("PATCH", "/v1/admin/users/{user_id}"),
        ("POST", "/v1/admin/users/{user_id}/password"),
        ("PUT", "/v1/admin/guardianship"),
        ("DELETE", "/v1/admin/guardianship"),
        ("DELETE", "/v1/admin/users/{user_id}"),
        ("GET", "/v1/learners/{learner_id}/skills"),
        ("GET", "/v1/learners/{learner_id}/progress"),
        ("GET", "/v1/learners/{learner_id}/activity"),
        ("GET", "/v1/learners/{learner_id}/submissions"),
    ]:
        assert expected in routes, expected
