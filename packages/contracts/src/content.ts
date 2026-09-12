/** Shapes the curriculum build emits and the SPA reads. */

export type ReadingTier = "grade3" | "grade7" | "adult";

export type StepType =
  | "narrative"
  | "predict"
  | "parsons"
  | "fill-blank"
  | "free-code"
  | "explain-back"
  | "project";

export interface SkillRef {
  id: string;
  weight: "primary" | "supporting";
}

export interface AuthoredHint {
  /** parse/runtime errors do not count towards this (§6.2) */
  afterSemanticFailures: number;
  tier: ReadingTier;
  text: string;
}

export interface Step {
  /** STABLE — never renamed, never reused. Progress events store it as an opaque string. */
  id: string;
  type: StepType;
  title: string;
  skills: SkillRef[];
  prerequisites: string[];
  estimatedMinutes: number;
  aiGuidance: "allow" | "suppress";
  /** Skills this step is a transfer item for — the strongest single signal (§6.3). */
  transferFor: string[];
  prose: Partial<Record<ReadingTier, string>>;
  audio?: Partial<Record<ReadingTier, string>>;
  hints: AuthoredHint[];
  starter?: string;
  tests?: import("./runtime.js").TestSpec;
  /** predict / explain-back only; drives pGuess. */
  options?: string[];
  answer?: string;
  /** parsons only. */
  lines?: string[];
  distractors?: string[];
}

export interface Lesson {
  id: string;
  title: string;
  claim: string;
  steps: Step[];
}

export interface Module {
  id: string;
  title: string;
  lessons: Lesson[];
}

export interface Course {
  id: string;
  title: string;
  modules: Module[];
}

export interface Manifest {
  contentVersion: string;
  minAppVersion: string;
  courses: { id: string; title: string; path: string }[];
}

export interface Skill {
  id: string;
  title: string;
  prerequisites: string[];
  pInit?: number;
  pLearn?: number;
  pSlip?: number;
  reportQuestion?: string;
}

export interface SkillRegistry {
  ontologyVersion: number;
  skills: Skill[];
  transitions: {
    from: string | string[];
    to: string | string[];
    kind: "split" | "merge" | "rename";
    policy: string;
  }[];
}
