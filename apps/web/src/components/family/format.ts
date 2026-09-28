import type { Course, ReadingTier } from "@copperkeep/contracts";
import { ApiError } from "../../api";

export const TIER_LABEL: Record<ReadingTier, string> = {
  grade3: "Younger reader",
  grade7: "Older reader",
  adult: "Adult",
};

/** "3 min ago", "yesterday", "12 Sep" — relative while recent, a date after a week. */
export function ago(iso: string | null, now = Date.now()): string {
  if (!iso) return "never";
  const seconds = Math.max(0, (now - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} h ago`;
  if (seconds < 172800) return "yesterday";
  if (seconds < 604800) return `${Math.floor(seconds / 86400)} days ago`;
  return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

/** The API's `{"detail": "..."}`, as a sentence a parent can act on. */
export function problem(error: unknown): string {
  if (error instanceof ApiError) {
    try {
      const detail = (JSON.parse(error.message) as { detail?: unknown }).detail;
      if (typeof detail === "string") return detail;
      if (Array.isArray(detail)) return "Check the fields — something is missing or too short.";
    } catch {
      // not JSON: fall through to the raw text
    }
    return error.message;
  }
  return String(error);
}

export interface StepPlace {
  courseTitle: string;
  moduleTitle: string;
  lessonId: string;
  lessonTitle: string;
  stepTitle: string;
  stepIndex: number;
}

/** Step id → where it sits, for turning event and submission ids into titles. */
export function indexSteps(courses: Course[]): Map<string, StepPlace> {
  const places = new Map<string, StepPlace>();
  for (const course of courses) {
    for (const module of course.modules) {
      for (const lesson of module.lessons) {
        lesson.steps.forEach((step, i) =>
          places.set(step.id, {
            courseTitle: course.title,
            moduleTitle: module.title,
            lessonId: lesson.id,
            lessonTitle: lesson.title,
            stepTitle: step.title,
            stepIndex: i,
          }),
        );
      }
    }
  }
  return places;
}
