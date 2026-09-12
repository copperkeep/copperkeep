-- Copperkeep initial schema. Postgres holds user data only; content is never ingested.
-- See docs/architecture/plan.md §8.

CREATE TABLE orgs (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    slug       text NOT NULL UNIQUE,
    name       text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE users (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id            uuid NOT NULL REFERENCES orgs (id) ON DELETE CASCADE,
    username          text NOT NULL,
    display_name      text NOT NULL,
    role              text NOT NULL CHECK (role IN ('adult', 'learner')),
    password_hash     text,
    pin_hash          text,
    picture_seq_hash  text,
    reading_tier      text NOT NULL DEFAULT 'grade3' CHECK (reading_tier IN ('grade3', 'grade7', 'adult')),
    theme             text NOT NULL DEFAULT 'auto' CHECK (theme IN ('auto', 'light', 'dark')),
    email_optional    text,
    created_at        timestamptz NOT NULL DEFAULT now(),
    UNIQUE (org_id, username)
);

CREATE TABLE recovery_codes (
    id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id    uuid NOT NULL REFERENCES orgs (id) ON DELETE CASCADE,
    user_id   uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    code_hash text NOT NULL,
    used_at   timestamptz
);

CREATE TABLE device_credentials (
    id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id                uuid NOT NULL REFERENCES orgs (id) ON DELETE CASCADE,
    user_id               uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    kind                  text NOT NULL CHECK (kind IN ('qr_token', 'passkey')),
    secret_hash_or_pubkey text NOT NULL,
    label                 text,
    created_at            timestamptz NOT NULL DEFAULT now(),
    revoked_at            timestamptz
);

CREATE TABLE guardianship (
    org_id          uuid NOT NULL REFERENCES orgs (id) ON DELETE CASCADE,
    adult_user_id   uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    learner_user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    relationship    text,
    PRIMARY KEY (org_id, adult_user_id, learner_user_id)
);

CREATE TABLE sessions (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id       uuid NOT NULL REFERENCES orgs (id) ON DELETE CASCADE,
    user_id      uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    token_hash   text NOT NULL UNIQUE,
    device_label text,
    issued_at    timestamptz NOT NULL DEFAULT now(),
    expires_at   timestamptz NOT NULL,
    revoked_at   timestamptz
);

CREATE INDEX sessions_user_idx ON sessions (org_id, user_id);

-- Append-only. Never mutated, never deleted while a learner exists.
CREATE TABLE progress_events (
    id              bigserial PRIMARY KEY,
    org_id          uuid NOT NULL REFERENCES orgs (id) ON DELETE CASCADE,
    user_id         uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    event_type      text NOT NULL CHECK (event_type IN (
                        'step_started', 'attempt', 'hint_shown', 'step_completed',
                        'review_due', 'review_passed', 'review_failed')),
    course_id       text,
    step_id         text,
    skill_ids       text[] NOT NULL DEFAULT '{}',
    correct         boolean,
    failure_kind    text CHECK (failure_kind IN ('parse', 'runtime', 'semantic', 'timeout')),
    hint_source     text CHECK (hint_source IN ('authored', 'ai')),
    payload         jsonb NOT NULL DEFAULT '{}'::jsonb,
    content_version text,
    occurred_at     timestamptz NOT NULL,
    received_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX progress_events_user_idx ON progress_events (org_id, user_id, occurred_at);
CREATE INDEX progress_events_step_idx ON progress_events (org_id, step_id);

CREATE TABLE submissions (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id          uuid NOT NULL REFERENCES orgs (id) ON DELETE CASCADE,
    user_id         uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    step_id         text NOT NULL,
    code            text NOT NULL,
    eval_result     jsonb NOT NULL,
    content_version text,
    occurred_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX submissions_user_step_idx ON submissions (org_id, user_id, step_id, occurred_at DESC);

-- Populated only when AI guidance is enabled (§19.8).
CREATE TABLE ai_hint_cache (
    content_version text NOT NULL,
    step_id         text NOT NULL,
    code_hash       text NOT NULL,
    hint            jsonb NOT NULL,
    rejected_count  int NOT NULL DEFAULT 0,
    created_at      timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (content_version, step_id, code_hash)
);

-- Derived state. Truncate and rebuild from progress_events at any time.
CREATE TABLE skill_state (
    org_id           uuid NOT NULL REFERENCES orgs (id) ON DELETE CASCADE,
    user_id          uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    skill_id         text NOT NULL,
    p_known          numeric NOT NULL DEFAULT 0,
    opportunities    int NOT NULL DEFAULT 0,
    step_types       text[] NOT NULL DEFAULT '{}',
    consecutive_fails int NOT NULL DEFAULT 0,
    ai_assisted      boolean NOT NULL DEFAULT false,
    transfer_passed  boolean NOT NULL DEFAULT false,
    mastered_at      timestamptz,
    last_seen_at     timestamptz,
    next_review_at   timestamptz,
    review_stage     int NOT NULL DEFAULT 0,
    decayed          boolean NOT NULL DEFAULT false,
    PRIMARY KEY (org_id, user_id, skill_id)
);

CREATE INDEX skill_state_review_idx ON skill_state (next_review_at)
    WHERE next_review_at IS NOT NULL;

-- Abuse controls (§7.4). Per-account, never per-IP.
CREATE TABLE auth_attempts (
    org_id       uuid NOT NULL REFERENCES orgs (id) ON DELETE CASCADE,
    user_id      uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    window_start timestamptz NOT NULL DEFAULT now(),
    failures     int NOT NULL DEFAULT 0,
    locked_until timestamptz,
    PRIMARY KEY (org_id, user_id)
);

CREATE TABLE write_quota (
    org_id       uuid NOT NULL REFERENCES orgs (id) ON DELETE CASCADE,
    user_id      uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    window_start timestamptz NOT NULL DEFAULT now(),
    writes       int NOT NULL DEFAULT 0,
    PRIMARY KEY (org_id, user_id)
);

CREATE TABLE cohorts (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id     uuid NOT NULL REFERENCES orgs (id) ON DELETE CASCADE,
    name       text NOT NULL,
    join_code  text NOT NULL UNIQUE,
    created_by uuid REFERENCES users (id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE cohort_members (
    org_id    uuid NOT NULL REFERENCES orgs (id) ON DELETE CASCADE,
    cohort_id uuid NOT NULL REFERENCES cohorts (id) ON DELETE CASCADE,
    user_id   uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    PRIMARY KEY (org_id, cohort_id, user_id)
);
