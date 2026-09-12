from prometheus_client import Counter, Gauge, Histogram

events_ingested = Counter(
    "copperkeep_events_ingested_total", "Progress events accepted", ["event_type"]
)
events_rejected = Counter(
    "copperkeep_events_rejected_total", "Progress events rejected by validation", ["reason"]
)
auth_failures = Counter("copperkeep_auth_failures_total", "Failed sign-in attempts", ["role"])
skills_mastered = Counter("copperkeep_skills_mastered_total", "Skills crossing the threshold")
hint_rejections = Counter(
    "copperkeep_hint_rejections_total", "Generated hints rejected by the validator", ["rule"]
)
content_loaded = Gauge(
    "copperkeep_content_loaded", "1 when a content index is held in memory"
)
event_batch_seconds = Histogram(
    "copperkeep_event_batch_seconds", "Time to apply one batch of progress events"
)
