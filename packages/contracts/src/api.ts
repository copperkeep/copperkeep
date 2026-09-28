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
  /** The org admin sees and manages every account; other adults only their learners. */
  is_admin?: boolean;
  owned_learners: { id: string; displayName: string; readingTier: ReadingTier }[];
}

/** One account, as the adult view lists it. */
export interface Person {
  id: string;
  username: string;
  display_name: string;
  role: "adult" | "learner";
  is_admin: boolean;
  reading_tier: ReadingTier;
  created_at: string;
  last_active: string | null;
  locked: boolean;
  failed_attempts: number;
  /** A learner's linked adults, or an adult's linked learners. */
  linked: string[];
}

export interface PersonUpdate {
  display_name?: string;
  username?: string;
  reading_tier?: ReadingTier;
  is_admin?: boolean;
}

export interface LessonProgress {
  course_id: string;
  lesson_id: string;
  steps_total: number;
  steps_completed: number;
  last_activity: string | null;
}

export interface ActivityItem {
  event_type: ProgressEvent["event_type"];
  course_id: string | null;
  step_id: string | null;
  correct: boolean | null;
  failure_kind: FailureKind | null;
  hint_source: "authored" | "ai" | null;
  occurred_at: string;
}

export interface Submission {
  id: string;
  step_id: string;
  code: string;
  passed: boolean | null;
  eval_result: Record<string, unknown>;
  occurred_at: string;
}

/** The weekly parent digest (plan §12.5). Never a grade. */
export interface Report {
  learner_id: string;
  display_name: string;
  window_days: number;
  skills_mastered: string[];
  minutes_on_task: number;
  stuck_on: { skillId: string; consecutiveFailures: number }[];
  review_performance: Record<string, number>;
  syntax_trouble: number;
  questions_to_ask: string[];
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
