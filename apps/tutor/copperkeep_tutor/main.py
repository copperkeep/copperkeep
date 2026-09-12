"""The optional tutor service.

Never reachable from the browser: the API calls it over the cluster network, and it is
absent from the deployment when disabled. Stateless, no database access.

It exists as its own service because an 8-10 second LLM timeout has no business in a
process where everything else answers in 50ms.
"""

from __future__ import annotations

import json
import logging
import statistics
import time
from contextlib import asynccontextmanager

import httpx
from fastapi import FastAPI, Response, status
from prometheus_client import CONTENT_TYPE_LATEST, Counter, Gauge, generate_latest
from pydantic import BaseModel
from pydantic_settings import BaseSettings, SettingsConfigDict

log = logging.getLogger(__name__)

SYSTEM_PROMPT = """You help a child who is learning to program. You are given their \
code and the test failure. Reply with JSON only: {"observation": str, "nudge": str, \
"confidence": "high"|"low"}.

Rules you must follow:
- Never write code. No code fences, no lines that could be pasted and run.
- Never give the answer. The nudge is a question that makes them look in the right place.
- Observation: one sentence naming what their code actually does, not what is wrong with them.
- Use "low" confidence whenever you are unsure; a low-confidence reply is discarded.
- Match the reading tier given. At grade3 use short words and short sentences."""


class TutorSettings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="COPPERKEEP_TUTOR_", extra="ignore")

    base_url: str = "http://ollama:11434/v1"
    model: str = "qwen2.5-coder:7b"
    api_key: str = ""
    timeout_seconds: float = 8.0
    latency_gate_enabled: bool = True
    probe_on_start: bool = True
    latency_budget_seconds: float = 8.0
    probe_samples: int = 3


settings = TutorSettings()

guidance_available = Gauge(
    "copperkeep_tutor_guidance_available", "0 when the latency gate has disabled guidance"
)
requests_total = Counter("copperkeep_tutor_requests_total", "Guidance requests", ["outcome"])

_state = {"guidance_enabled": True, "p95_seconds": 0.0}


# Field names are camelCase because they mirror the API's JSON contract exactly; this
# service does not get to rename the wire format.
class GuidanceRequest(BaseModel):
    language: str = "python"
    readingTier: str = "grade3"
    skills: list[str] = []
    instruction: str = ""
    learnerCode: str = ""
    failures: list[dict] = []
    authoredHintsAlreadyShown: list[str] = []


async def _complete(prompt: str, timeout: float) -> str:
    headers = {"Content-Type": "application/json"}
    if settings.api_key:
        headers["Authorization"] = f"Bearer {settings.api_key}"

    async with httpx.AsyncClient(timeout=timeout) as client:
        response = await client.post(
            f"{settings.base_url.rstrip('/')}/chat/completions",
            headers=headers,
            json={
                "model": settings.model,
                "messages": [
                    {"role": "system", "content": SYSTEM_PROMPT},
                    {"role": "user", "content": prompt},
                ],
                "temperature": 0.2,
                "response_format": {"type": "json_object"},
            },
        )
    response.raise_for_status()
    return response.json()["choices"][0]["message"]["content"]


async def _probe_latency() -> None:
    """An 8s budget and a 7B model on N100 CPU are mutually exclusive.

    Rather than documenting the contradiction, measure it and refuse to enable guidance
    when the endpoint cannot meet the budget — logging why (§19.7).
    """
    if not settings.latency_gate_enabled:
        return
    samples: list[float] = []
    for _ in range(settings.probe_samples):
        started = time.monotonic()
        try:
            await _complete('Reply with {"observation":"ok","nudge":"ok","confidence":"low"}', 30.0)
        except Exception as exc:  # noqa: BLE001
            log.warning("latency probe failed; guidance disabled: %s", exc)
            _state["guidance_enabled"] = False
            guidance_available.set(0)
            return
        samples.append(time.monotonic() - started)

    p95 = max(samples) if len(samples) < 20 else statistics.quantiles(samples, n=20)[18]
    _state["p95_seconds"] = p95
    if p95 > settings.latency_budget_seconds:
        log.warning(
            "endpoint p95 %.1fs exceeds the %.1fs budget; guidance disabled",
            p95,
            settings.latency_budget_seconds,
        )
        _state["guidance_enabled"] = False
    guidance_available.set(1 if _state["guidance_enabled"] else 0)


@asynccontextmanager
async def lifespan(app: FastAPI):
    logging.basicConfig(level="INFO")
    guidance_available.set(1)
    if settings.probe_on_start:
        await _probe_latency()
    yield


app = FastAPI(title="Copperkeep Tutor", version="0.1.5", lifespan=lifespan)


@app.get("/healthz", include_in_schema=False)
async def healthz() -> dict[str, object]:
    return {
        "status": "ok",
        "guidanceEnabled": _state["guidance_enabled"],
        "p95Seconds": round(_state["p95_seconds"], 2),
    }


@app.get("/metrics", include_in_schema=False)
async def metrics_endpoint() -> Response:
    return Response(generate_latest(), media_type=CONTENT_TYPE_LATEST)


@app.post("/guidance")
async def guidance(body: GuidanceRequest):
    """Degrade, never block: anything other than a clean structured reply is a 204,
    and the API falls back to the authored ladder."""
    if not _state["guidance_enabled"]:
        requests_total.labels(outcome="gated").inc()
        return Response(status_code=status.HTTP_204_NO_CONTENT)

    prompt = json.dumps(
        {
            "language": body.language,
            "readingTier": body.readingTier,
            "skills": body.skills,
            "instruction": body.instruction,
            "learnerCode": body.learnerCode,
            "failures": body.failures,
            "authoredHintsAlreadyShown": body.authoredHintsAlreadyShown,
        }
    )

    try:
        raw = await _complete(prompt, settings.timeout_seconds)
        hint = json.loads(raw)
    except Exception as exc:  # noqa: BLE001
        log.info("guidance unavailable: %s", exc)
        requests_total.labels(outcome="error").inc()
        return Response(status_code=status.HTTP_204_NO_CONTENT)

    requests_total.labels(outcome="generated").inc()
    # The API validates this before it reaches a browser. This service does not decide
    # what is safe to show.
    return hint
