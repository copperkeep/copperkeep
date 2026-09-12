"""The API's one read-only dependency on the content service.

It fetches the built index at startup and on a timer, and holds it in memory to
validate events and compute prerequisites. It never reads lesson prose or tests.

If content is unreachable the last-good copy keeps serving: learners keep their
session, new lessons just do not load (coupling rule 7, §9.1).
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field

import httpx

from .bkt import SkillParams
from .config import settings

log = logging.getLogger(__name__)


@dataclass(frozen=True)
class StepDef:
    id: str
    course_id: str
    lesson_id: str
    type: str
    skills: dict[str, str]  # skill_id -> "primary" | "supporting"
    prerequisites: tuple[str, ...] = ()
    option_count: int | None = None
    transfer_for: tuple[str, ...] = ()
    ai_guidance: str = "allow"
    estimated_minutes: int = 5


@dataclass(frozen=True)
class SkillDef:
    id: str
    title: str
    prerequisites: tuple[str, ...] = ()
    params: SkillParams = field(default_factory=SkillParams)
    report_question: str | None = None


def parse_version(value: str) -> tuple[int, ...]:
    parts: list[int] = []
    for chunk in value.split("-")[0].split("."):
        try:
            parts.append(int(chunk))
        except ValueError:
            parts.append(0)
    return tuple(parts)


class ContentIndex:
    def __init__(self) -> None:
        self.content_version: str | None = None
        self.min_app_version: str = "0.0.0"
        self.ontology_version: int = 0
        self.courses: list[dict] = []
        self.steps: dict[str, StepDef] = {}
        self.skills: dict[str, SkillDef] = {}
        self.transitions: list[dict] = []
        self.loaded = False
        self.last_error: str | None = None

    @property
    def compatible(self) -> bool:
        """A pinned app version against a newer curriculum subscription fails the
        readiness probe rather than going live broken (§11.1)."""
        return parse_version(settings.app_version) >= parse_version(self.min_app_version)

    async def refresh(self) -> bool:
        base = settings.content_base_url.rstrip("/")
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                manifest = (await client.get(f"{base}/manifest.json")).raise_for_status().json()
                skills = (await client.get(f"{base}/skills.json")).raise_for_status().json()
                steps = (await client.get(f"{base}/steps.json")).raise_for_status().json()
        except Exception as exc:  # noqa: BLE001 - degrade, never crash
            self.last_error = str(exc)
            log.warning("content refresh failed, serving last-good copy: %s", exc)
            return False

        self._apply(manifest, skills, steps)
        self.last_error = None
        self.loaded = True
        log.info(
            "content loaded: version=%s steps=%d skills=%d",
            self.content_version,
            len(self.steps),
            len(self.skills),
        )
        return True

    def _apply(self, manifest: dict, skills: dict, steps: dict) -> None:
        self.content_version = manifest.get("contentVersion")
        self.min_app_version = manifest.get("minAppVersion", "0.0.0")
        self.courses = manifest.get("courses", [])
        self.ontology_version = skills.get("ontologyVersion", 0)
        self.transitions = skills.get("transitions", [])

        self.skills = {
            entry["id"]: SkillDef(
                id=entry["id"],
                title=entry.get("title", entry["id"]),
                prerequisites=tuple(entry.get("prerequisites", [])),
                params=SkillParams(
                    p_init=float(entry.get("pInit", 0.15)),
                    p_learn=float(entry.get("pLearn", 0.20)),
                    p_slip=float(entry.get("pSlip", 0.10)),
                ),
                report_question=entry.get("reportQuestion"),
            )
            for entry in skills.get("skills", [])
        }

        self.steps = {
            step_id: StepDef(
                id=step_id,
                course_id=entry.get("courseId", ""),
                lesson_id=entry.get("lessonId", ""),
                type=entry.get("type", "free-code"),
                skills={s["id"]: s.get("weight", "supporting") for s in entry.get("skills", [])},
                prerequisites=tuple(entry.get("prerequisites", [])),
                option_count=entry.get("optionCount"),
                transfer_for=tuple(entry.get("transferFor", [])),
                ai_guidance=entry.get("aiGuidance", "allow"),
                estimated_minutes=int(entry.get("estimatedMinutes", 5)),
            )
            for step_id, entry in steps.get("steps", {}).items()
        }

    def step(self, step_id: str) -> StepDef | None:
        return self.steps.get(step_id)

    def skill(self, skill_id: str) -> SkillDef:
        return self.skills.get(skill_id) or SkillDef(id=skill_id, title=skill_id)

    def resolve(self, skill_id: str) -> tuple[str, ...]:
        """Map a historical skill ID forward through ontology transitions (§5.5).

        Events keep their original IDs forever; the mapping is applied at projection
        time, which is what makes a split replayable rather than destructive.
        """
        for transition in self.transitions:
            sources = transition["from"]
            sources = [sources] if isinstance(sources, str) else sources
            if skill_id in sources:
                target = transition["to"]
                return tuple([target] if isinstance(target, str) else target)
        return (skill_id,)


index = ContentIndex()
