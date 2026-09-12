"""Bayesian Knowledge Tracing — the whole mastery evaluator.

Server-side only (plan §6.1). The client renders what it is told and never computes
mastery: two implementations would have to agree to the decimal, and the round trip is
5-20ms on a LAN.

Everything here is a pure function of (prior, observation, parameters), so a parameter
change is a replay of progress_events, not a migration.
"""

from __future__ import annotations

from dataclasses import dataclass

# pGuess is a property of the item, not the skill (§6.1). A 4-option predict step has a
# 25% floor by construction; a global 0.20 sits below what random clicking achieves.
_GUESS_BY_STEP_TYPE = {
    "predict": 0.25,
    "explain-back": 0.25,
    "parsons": 0.10,
    "fill-blank": 0.10,
    "free-code": 0.05,
    "project": 0.05,
}
_DEFAULT_GUESS = 0.20

# Only semantic failures are opportunities in the BKT sense (§6.2). A missing colon is
# not evidence about whether the learner understands loops.
_WEIGHT_BY_FAILURE_KIND = {
    None: 1.0,  # a pass
    "semantic": 1.0,
    "runtime": 0.4,
    "parse": 0.0,
    "timeout": 0.0,
}


@dataclass(frozen=True)
class SkillParams:
    p_init: float = 0.15
    p_learn: float = 0.20
    p_slip: float = 0.10


@dataclass(frozen=True)
class Observation:
    correct: bool
    step_type: str
    failure_kind: str | None = None
    option_count: int | None = None
    hint_source: str | None = None


def guess_for(step_type: str, option_count: int | None) -> float:
    if step_type in ("predict", "explain-back") and option_count:
        return max(0.25, 1.0 / option_count)
    return _GUESS_BY_STEP_TYPE.get(step_type, _DEFAULT_GUESS)


def weight_for(obs: Observation) -> float:
    if obs.correct:
        return 1.0
    return _WEIGHT_BY_FAILURE_KIND.get(obs.failure_kind, 1.0)


def is_opportunity(obs: Observation) -> bool:
    """Parse errors and timeouts move nothing — not the estimate, not the ladder."""
    return weight_for(obs) > 0.0


def update(p_known: float, obs: Observation, params: SkillParams) -> float:
    """Standard BKT posterior followed by the learning transition.

    A reduced weight (a runtime error) interpolates between the prior and the full
    posterior rather than inventing a second model.
    """
    weight = weight_for(obs)
    if weight == 0.0:
        return p_known

    p_guess = guess_for(obs.step_type, obs.option_count)
    p_slip = params.p_slip

    if obs.correct:
        numerator = p_known * (1 - p_slip)
        denominator = numerator + (1 - p_known) * p_guess
    else:
        numerator = p_known * p_slip
        denominator = numerator + (1 - p_known) * (1 - p_guess)

    posterior = p_known if denominator == 0 else numerator / denominator
    blended = p_known + weight * (posterior - p_known)
    return blended + (1 - blended) * params.p_learn


@dataclass
class MasteryInput:
    p_known: float
    opportunities: int
    distinct_step_types: int
    ai_assisted: bool
    transfer_passed: bool


def is_mastered(
    state: MasteryInput,
    *,
    threshold: float,
    min_opportunities: int,
    min_step_types: int,
) -> bool:
    """A skill is not mastered from one step type alone, and an AI-assisted solve
    requires a transfer item before it counts (§19.6)."""
    if state.p_known < threshold:
        return False
    if state.opportunities < min_opportunities:
        return False
    if state.distinct_step_types < min_step_types:
        return False
    if state.ai_assisted and not state.transfer_passed:
        return False
    return True


def gate_response(consecutive_semantic_failures: int) -> str | None:
    """Branch, never lock (§6.4). Counts semantic failures only.

    Forward progress on the primary sequence stays blocked; lateral movement is always
    available, so the learner is never staring at a locked screen with nothing to do.
    """
    if consecutive_semantic_failures >= 6:
        return "worked_example"
    if consecutive_semantic_failures >= 4:
        return "drop_to_prerequisite"
    if consecutive_semantic_failures >= 2:
        return "reteach"
    return None
