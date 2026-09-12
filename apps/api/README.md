# copperkeep-api

FastAPI. The only service with database credentials, and the sole authority on mastery:
it applies the BKT posterior, writes `skill_state`, and decides what unlocks. The client
renders what it is told.

```sh
python -m venv .venv && .venv/bin/pip install -e '.[dev]'
.venv/bin/copperkeep-migrate
.venv/bin/uvicorn copperkeep_api.main:app --reload
```

Configuration is environment-only, prefixed `COPPERKEEP_` — see
`copperkeep_api/config.py`. Those names are the same in the Helm chart and in Compose;
neither deployment invents its own.

Migrations run as a Helm `pre-upgrade` Job, never on startup.
