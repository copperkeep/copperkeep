"""The mastery engine is the part worth testing without a database."""

from copperkeep_api.bkt import (
    MasteryInput,
    Observation,
    SkillParams,
    gate_response,
    guess_for,
    is_mastered,
    is_opportunity,
    update,
)

PARAMS = SkillParams()


def test_correct_answers_raise_the_estimate():
    p = 0.15
    for _ in range(4):
        p = update(p, Observation(correct=True, step_type="free-code"), PARAMS)
    assert p > 0.9


def test_semantic_failure_lowers_the_estimate():
    p = update(0.8, Observation(correct=False, step_type="free-code", failure_kind="semantic"), PARAMS)
    assert p < 0.8


def test_syntax_errors_are_not_mastery_opportunities():
    obs = Observation(correct=False, step_type="free-code", failure_kind="parse")
    assert not is_opportunity(obs)
    assert update(0.42, obs, PARAMS) == 0.42


def test_timeouts_move_nothing():
    obs = Observation(correct=False, step_type="free-code", failure_kind="timeout")
    assert update(0.42, obs, PARAMS) == 0.42


def test_runtime_errors_count_less_than_semantic_ones():
    runtime = update(
        0.8, Observation(correct=False, step_type="free-code", failure_kind="runtime"), PARAMS
    )
    semantic = update(
        0.8, Observation(correct=False, step_type="free-code", failure_kind="semantic"), PARAMS
    )
    assert semantic < runtime < 0.8


def test_guess_floor_follows_the_item_not_the_skill():
    assert guess_for("predict", 4) == 0.25
    assert guess_for("predict", 2) == 0.5
    assert guess_for("free-code", None) == 0.05


def test_a_four_option_predict_moves_the_estimate_less_than_free_code():
    predict = update(0.5, Observation(correct=True, step_type="predict", option_count=4), PARAMS)
    free_code = update(0.5, Observation(correct=True, step_type="free-code"), PARAMS)
    assert predict < free_code


def test_mastery_needs_more_than_a_high_estimate():
    high = dict(p_known=0.99, ai_assisted=False, transfer_passed=False)
    thresholds = dict(threshold=0.90, min_opportunities=3, min_step_types=2)

    assert not is_mastered(
        MasteryInput(opportunities=2, distinct_step_types=2, **high), **thresholds
    )
    assert not is_mastered(
        MasteryInput(opportunities=3, distinct_step_types=1, **high), **thresholds
    )
    assert is_mastered(MasteryInput(opportunities=3, distinct_step_types=2, **high), **thresholds)


def test_ai_assisted_mastery_requires_a_transfer_item():
    thresholds = dict(threshold=0.90, min_opportunities=3, min_step_types=2)
    assisted = MasteryInput(
        p_known=0.99,
        opportunities=5,
        distinct_step_types=3,
        ai_assisted=True,
        transfer_passed=False,
    )
    assert not is_mastered(assisted, **thresholds)
    assisted.transfer_passed = True
    assert is_mastered(assisted, **thresholds)


def test_the_gate_branches_and_never_locks():
    assert gate_response(1) is None
    assert gate_response(2) == "reteach"
    assert gate_response(4) == "drop_to_prerequisite"
    assert gate_response(6) == "worked_example"
    assert gate_response(20) == "worked_example"
