import type { EvalResult, FailureKind } from "./runtime.js";
import type { ReadingTier } from "./content.js";

/**
 * Fetched at boot from /config.json (a ConfigMap in Helm, a mounted file in Compose).
 * Never baked into the bundle, or you need a rebuild per environment (§9.1 rule 2).
 */
export interface AppConfig {
  apiBaseUrl: string;
  contentBaseUrl: string;
  audioBaseUrl: string;
  runtimesBaseUrl: string;
  pyodideIndexUrl: string;
  /** micropip resolves here, never PyPI — external fetches are blocked by design. */
  micropipIndexUrl: string;
  appVersion: string;
  defaultTheme: "auto" | "light" | "dark";
  tutorEnabled: boolean;
}

export type EventType =
  | "step_started"
  | "attempt"
  | "hint_shown"
  | "step_completed"
  | "review_due"
  | "review_passed"
  | "review_failed";

export interface ProgressEvent {
  event_type: EventType;
  course_id?: string;
  step_id?: string;
  skill_ids?: string[];
  correct?: boolean;
  failure_kind?: FailureKind;
  hint_source?: "authored" | "ai";
  submission_id?: string;
  /** Telemetry: durations, edit distance, submission count (§6.3). */
  payload?: Record<string, unknown>;
  occurred_at: string;
}

export interface SkillState {
  skill_id: string;
  title: string;
  p_known: number;
  opportunities: number;
  mastered: boolean;
  unlocked: boolean;
  review_due: boolean;
  gate?: "reteach" | "drop_to_prerequisite" | "worked_example" | null;
}

export interface EventBatchResponse {
  accepted: number;
  rejected: { stepId?: string; reason: string }[];
  skill_state: SkillState[];
}

export interface Identity {
  user_id: string;
  org: string;
  display_name: string;
  role: "adult" | "learner";
  reading_tier: ReadingTier;
  theme: "auto" | "light" | "dark";
  content_version: string | null;
  owned_learners: { id: string; displayName: string; readingTier: ReadingTier }[];
}

export interface SubmissionRequest {
  step_id: string;
  code: string;
  eval_result: EvalResult;
}

export interface Hint {
  observation: string;
  nudge: string;
  source: "ai";
}
