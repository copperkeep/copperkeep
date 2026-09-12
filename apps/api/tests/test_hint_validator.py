"""The validator is the guarantee; the prompt is only a request."""

from copperkeep_api.tutor_client import validate

GOOD = {
    "observation": "Your loop starts counting at one, but the test wants it to start at zero.",
    "nudge": "What number does range begin at?",
    "confidence": "high",
}


def test_a_clean_hint_passes():
    assert validate(GOOD, "grade3")


def test_low_confidence_is_rejected():
    assert not validate({**GOOD, "confidence": "medium"}, "grade3")


def test_a_code_fence_is_rejected():
    assert not validate({**GOOD, "nudge": "Try ```for i in range(10)```"}, "grade3")


def test_a_line_that_parses_as_code_is_rejected():
    assert not validate({**GOOD, "nudge": "for i in range(10):"}, "grade3")


def test_the_word_ceiling_is_per_tier():
    long_nudge = {**GOOD, "nudge": " ".join(["word"] * 50)}
    assert not validate(long_nudge, "grade3")
    assert validate(long_nudge, "adult")


def test_an_empty_field_is_rejected():
    assert not validate({**GOOD, "nudge": ""}, "grade3")
