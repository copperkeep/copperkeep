from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Every field is also a Helm value and a Compose environment variable.

    The names here are the contract that keeps the two deployment paths from drifting
    (plan §9.7). Neither deployment invents its own.
    """

    model_config = SettingsConfigDict(env_prefix="COPPERKEEP_", env_file=".env", extra="ignore")

    app_version: str = "0.1.7"
    log_level: str = "INFO"

    database_url: str = "postgresql://copperkeep:copperkeep@localhost:5432/copperkeep"
    database_pool_min: int = 1
    database_pool_max: int = 10
    database_statement_timeout_ms: int = 5_000
    migrations_dir: str = ""

    content_base_url: str = "http://content"
    content_refresh_seconds: int = 300

    session_secret: str = Field(default="dev-only-change-me", min_length=8)
    session_ttl_hours: int = 720  # device-bound sessions; the login screen should be rare
    cookie_secure: bool = True

    # Abuse controls (§7.4)
    auth_backoff_after: int = 3
    auth_hard_lock_after: int = 10
    event_writes_per_minute: int = 240
    submission_max_bytes: int = 64_000

    # Mastery engine (§6.1)
    mastery_threshold: float = 0.90
    mastery_min_opportunities: int = 3
    mastery_min_step_types: int = 2
    review_intervals_days: list[int] = [3, 7, 21]

    tutor_enabled: bool = False
    tutor_base_url: str = "http://tutor"
    tutor_timeout_seconds: int = 8

    # Shared secret for in-cluster callers with no session — the review CronJob.
    admin_token: str = ""

    # Set at first boot when no org exists. Never overwrites an existing account.
    bootstrap_org_slug: str = "home"
    bootstrap_org_name: str = "Home"
    bootstrap_admin_username: str = "admin"
    bootstrap_admin_password: str = ""


settings = Settings()
