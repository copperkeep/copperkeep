import type {
  ActivityItem,
  EventBatchResponse,
  EvalResult,
  Hint,
  Identity,
  LessonProgress,
  Person,
  PersonUpdate,
  ProgressEvent,
  ReadingTier,
  Report,
  SkillState,
  Submission,
} from "@copperkeep/contracts";
import { config } from "./config";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${config().apiBaseUrl}${path}`, {
    ...init,
    // Sessions are httpOnly cookies on a single origin: no tokens to carry, nothing
    // for a compromised tablet's localStorage to leak.
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
  if (response.status === 204) return undefined as T;
  if (!response.ok) {
    const detail = await response.text();
    throw new ApiError(response.status, detail || response.statusText);
  }
  return (await response.json()) as T;
}

function json(method: string, body: unknown): RequestInit {
  return { method, body: JSON.stringify(body) };
}

export const api = {
  login: (org: string, username: string, secret: string, method: "pin" | "password" = "pin") =>
    request<Identity>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ org, username, secret, method }),
    }),
  logout: () => request<void>("/auth/logout", { method: "POST" }),
  me: () => request<Identity>("/me"),
  skills: () => request<SkillState[]>("/skills"),
  reviewsDue: () => request<{ skill_id: string; title: string }[]>("/reviews/due"),
  submit: (stepId: string, code: string, evalResult: EvalResult) =>
    request<{ submission_id: string }>("/submissions", {
      method: "POST",
      body: JSON.stringify({ step_id: stepId, code, eval_result: evalResult }),
    }),
  hint: (stepId: string, code: string, authoredHintsShown: string[]) =>
    request<Hint | undefined>("/hint", {
      method: "POST",
      body: JSON.stringify({
        step_id: stepId,
        code,
        authored_hints_shown: authoredHintsShown,
      }),
    }),
  report: (learnerId: string, windowDays = 7) =>
    request<Report>(`/reports/${learnerId}?window_days=${windowDays}`),

  // The adult view. Every call is org-scoped and permission-checked server-side.
  people: () => request<Person[]>("/admin/users"),
  createLearner: (body: {
    username: string;
    display_name: string;
    pin: string;
    reading_tier: ReadingTier;
  }) => request<{ learnerId: string }>("/admin/learners", json("POST", body)),
  createAdult: (body: {
    username: string;
    display_name: string;
    password: string;
    is_admin: boolean;
  }) => request<{ userId: string }>("/admin/adults", json("POST", body)),
  updatePerson: (id: string, body: PersonUpdate) =>
    request<Person>(`/admin/users/${id}`, json("PATCH", body)),
  resetPin: (id: string, pin: string) =>
    request<void>(`/admin/learners/${id}/pin`, json("POST", { pin })),
  setPassword: (id: string, password: string) =>
    request<void>(`/admin/users/${id}/password`, json("POST", { password })),
  unlock: (id: string) => request<void>(`/admin/learners/${id}/unlock`, { method: "POST" }),
  link: (adultId: string, learnerId: string) =>
    request<void>(
      "/admin/guardianship",
      json("PUT", { adult_id: adultId, learner_id: learnerId }),
    ),
  unlink: (adultId: string, learnerId: string) =>
    request<void>(
      "/admin/guardianship",
      json("DELETE", { adult_id: adultId, learner_id: learnerId }),
    ),
  removePerson: (id: string) => request<void>(`/admin/users/${id}`, { method: "DELETE" }),
  learnerSkills: (id: string) => request<SkillState[]>(`/learners/${id}/skills`),
  learnerProgress: (id: string) => request<LessonProgress[]>(`/learners/${id}/progress`),
  learnerActivity: (id: string, limit = 200) =>
    request<ActivityItem[]>(`/learners/${id}/activity?limit=${limit}`),
  learnerSubmissions: (id: string, stepId?: string, limit = 50) =>
    request<Submission[]>(
      `/learners/${id}/submissions?limit=${limit}` +
        (stepId ? `&step_id=${encodeURIComponent(stepId)}` : ""),
    ),
  sendEvents: (events: ProgressEvent[]) =>
    request<EventBatchResponse>("/events", {
      method: "POST",
      body: JSON.stringify({ events }),
    }),
};

/**
 * A burst of telemetry is one request, not twenty.
 *
 * The skill map updates from the response rather than from a local copy: BKT runs
 * server-side only, and a map that updates a beat later is imperceptible on a LAN.
 */
export class EventQueue {
  #queue: ProgressEvent[] = [];
  #timer: ReturnType<typeof setTimeout> | null = null;
  #onSkillState: (state: SkillState[]) => void;

  constructor(onSkillState: (state: SkillState[]) => void) {
    this.#onSkillState = onSkillState;
    // A tablet put to sleep mid-lesson should not lose the last few events.
    globalThis.addEventListener?.("pagehide", () => void this.flush());
  }

  push(event: Omit<ProgressEvent, "occurred_at"> & { occurred_at?: string }): void {
    this.#queue.push({ ...event, occurred_at: event.occurred_at ?? new Date().toISOString() });
    if (this.#queue.length >= 20) {
      void this.flush();
      return;
    }
    this.#timer ??= setTimeout(() => void this.flush(), 3000);
  }

  async flush(): Promise<void> {
    if (this.#timer) {
      clearTimeout(this.#timer);
      this.#timer = null;
    }
    if (this.#queue.length === 0) return;

    const batch = this.#queue.splice(0, this.#queue.length);
    try {
      const response = await api.sendEvents(batch);
      if (response.rejected.length > 0) {
        console.warn("events rejected by the server", response.rejected);
      }
      if (response.skill_state.length > 0) this.#onSkillState(response.skill_state);
    } catch (error) {
      console.warn("event batch failed, will retry with the next flush", error);
      this.#queue.unshift(...batch);
    }
  }
}
