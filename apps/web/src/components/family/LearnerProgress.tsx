import { useEffect, useMemo, useState } from "react";
import type {
  ActivityItem,
  Course,
  LessonProgress,
  Person,
  Report,
  SkillState,
  Submission,
} from "@copperkeep/contracts";
import { api } from "../../api";
import { Editor } from "../Editor";
import { SkillMap } from "../SkillMap";
import { ago, indexSteps, problem, type StepPlace } from "./format";

type Tab = "report" | "skills" | "lessons" | "activity";
const TABS: [Tab, string][] = [
  ["report", "Report"],
  ["skills", "Skills"],
  ["lessons", "Lessons"],
  ["activity", "Activity"],
];

export function LearnerProgress({ learner, courses }: { learner: Person; courses: Course[] }) {
  const [tab, setTab] = useState<Tab>("report");
  const [skills, setSkills] = useState<SkillState[]>([]);
  const [error, setError] = useState<string | null>(null);
  const places = useMemo(() => indexSteps(courses), [courses]);

  // Skill titles are needed by the report as well as the map, so load them once here.
  useEffect(() => {
    api.learnerSkills(learner.id).then(setSkills, (e) => setError(problem(e)));
  }, [learner.id]);
  const skillTitle = (id: string) => skills.find((s) => s.skill_id === id)?.title ?? id;

  return (
    <section className="family__progress" aria-label={`${learner.display_name}'s progress`}>
      <div className="seg" role="tablist" aria-label="Progress view">
        {TABS.map(([id, label]) => (
          <button
            key={id}
            role="tab"
            className="tap tap--quiet"
            aria-selected={tab === id}
            aria-pressed={tab === id}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </div>
      {error && (
        <p className="note family__error" role="alert">
          {error}
        </p>
      )}
      {tab === "report" && <ReportView learner={learner} skillTitle={skillTitle} />}
      {tab === "skills" && <SkillMap skills={skills} learnerName={learner.display_name} />}
      {tab === "lessons" && <Lessons learner={learner} courses={courses} />}
      {tab === "activity" && <Activity learner={learner} places={places} />}
    </section>
  );
}

/**
 * The weekly digest (plan §12.5). Deliberately not a grade. The questions to ask come
 * first because they are the most useful thing on the page.
 */
function ReportView({
  learner,
  skillTitle,
}: {
  learner: Person;
  skillTitle: (id: string) => string;
}) {
  const [days, setDays] = useState(7);
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setReport(null);
    api.report(learner.id, days).then(setReport, (e) => setError(problem(e)));
  }, [learner.id, days]);

  if (error) return <p className="note family__error">{error}</p>;
  if (!report) return <p className="note">Loading the report…</p>;

  const passed = report.review_performance.review_passed ?? 0;
  const failed = report.review_performance.review_failed ?? 0;

  return (
    <div className="card">
      <div className="family__row family__row--between">
        <div className="kicker">
          <span className="label">
            {days === 7 ? "This week" : `Last ${days} days`} · {learner.display_name}
          </span>
        </div>
        <div className="seg" role="group" aria-label="Report window">
          {[7, 30].map((n) => (
            <button
              key={n}
              className="tap tap--quiet"
              aria-pressed={days === n}
              onClick={() => setDays(n)}
            >
              {n} days
            </button>
          ))}
        </div>
      </div>

      <h2 className="display">
        Ask about <span className="hl">this</span>
      </h2>
      {report.questions_to_ask.length > 0 ? (
        <ul className="family__questions">
          {report.questions_to_ask.map((q) => (
            <li key={q} className="callout">
              {q}
            </li>
          ))}
        </ul>
      ) : (
        <p className="note">
          Nothing new mastered in this window yet — questions appear as skills are learned.
        </p>
      )}

      <div className="stat-strip family__stats">
        <Stat value={report.minutes_on_task} label="minutes learning" />
        <Stat value={report.skills_mastered.length} label="skills mastered" />
        <Stat value={passed} label={`reviews passed${failed ? ` · ${failed} missed` : ""}`} />
        <Stat value={report.syntax_trouble} label="typos Python could not read" />
      </div>

      {report.skills_mastered.length > 0 && (
        <>
          <h3 className="label family__subhead">Mastered</h3>
          <p>{report.skills_mastered.map(skillTitle).join(" · ")}</p>
        </>
      )}
      {report.stuck_on.length > 0 && (
        <>
          <h3 className="label family__subhead">Where they got stuck</h3>
          <ul className="family__plain">
            {report.stuck_on.map((s) => (
              <li key={s.skillId}>
                {skillTitle(s.skillId)} — {s.consecutiveFailures} tries in a row
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <div>
      <div className="bignum">{value}</div>
      <div className="label">{label}</div>
    </div>
  );
}

/** Every lesson, grouped as the learner sees them, with how far through they are. */
function Lessons({ learner, courses }: { learner: Person; courses: Course[] }) {
  const [progress, setProgress] = useState<LessonProgress[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.learnerProgress(learner.id).then(setProgress, (e) => setError(problem(e)));
  }, [learner.id]);

  if (error) return <p className="note family__error">{error}</p>;
  if (!progress) return <p className="note">Loading lessons…</p>;

  const byLesson = new Map(progress.map((p) => [`${p.course_id}/${p.lesson_id}`, p]));
  const started = courses.filter((course) =>
    course.modules.some((m) => m.lessons.some((l) => byLesson.has(`${course.id}/${l.id}`))),
  );

  if (started.length === 0) {
    return (
      <div className="card">
        <p className="note">{learner.display_name} has not started a lesson yet.</p>
      </div>
    );
  }

  return (
    <div className="card family__lessons">
      {started.map((course) => (
        <section key={course.id}>
          <h3 className="label family__subhead">{course.title}</h3>
          {course.modules.map((module) => (
            <div key={module.id} className="family__module">
              <div className="label">{module.title}</div>
              <ul className="family__plain">
                {module.lessons.map((lesson) => {
                  const key = `${course.id}/${lesson.id}`;
                  const row = byLesson.get(key);
                  const done = row?.steps_completed ?? 0;
                  const total = lesson.steps.length;
                  return (
                    <li key={lesson.id}>
                      <button
                        className="family__lesson"
                        aria-expanded={open === key}
                        onClick={() => setOpen(open === key ? null : key)}
                      >
                        <span className="family__lesson-title">{lesson.title}</span>
                        <span className="progress" aria-hidden="true">
                          {lesson.steps.map((step, i) => (
                            <span key={step.id} data-done={i < done} />
                          ))}
                        </span>
                        <span className="label">
                          {!row
                            ? "not started"
                            : done >= total
                              ? "done"
                              : `${done} of ${total} steps`}
                          {row?.last_activity ? ` · ${ago(row.last_activity)}` : ""}
                        </span>
                      </button>
                      {open === key && <LessonSteps learner={learner} lesson={lesson} />}
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </section>
      ))}
    </div>
  );
}

/** A lesson's steps, each with the latest code the learner submitted for it. */
function LessonSteps({
  learner,
  lesson,
}: {
  learner: Person;
  lesson: Course["modules"][number]["lessons"][number];
}) {
  const [latest, setLatest] = useState<Map<string, Submission> | null>(null);

  useEffect(() => {
    // Newest first, so the first one seen for a step is its latest.
    api.learnerSubmissions(learner.id, undefined, 200).then((all) => {
      const map = new Map<string, Submission>();
      for (const s of all) if (!map.has(s.step_id)) map.set(s.step_id, s);
      setLatest(map);
    }, () => setLatest(new Map()));
  }, [learner.id]);

  if (!latest) return <p className="note">Loading their code…</p>;
  return (
    <ol className="family__steps">
      {lesson.steps.map((step) => {
        const sub = latest.get(step.id);
        return (
          <li key={step.id}>
            <div className="family__row family__row--between">
              <span>{step.title}</span>
              <span className="label">
                {step.type}
                {sub ? ` · ${sub.passed ? "passed" : "not yet"} · ${ago(sub.occurred_at)}` : ""}
              </span>
            </div>
            {sub && <Editor value={sub.code} readOnly />}
          </li>
        );
      })}
    </ol>
  );
}

const EVENT_WORDS: Record<ActivityItem["event_type"], string> = {
  step_started: "Opened",
  attempt: "Tried",
  hint_shown: "Asked for a hint on",
  step_completed: "Finished",
  review_due: "Review due for",
  review_passed: "Passed a review of",
  review_failed: "Missed a review of",
};

function Activity({ learner, places }: { learner: Person; places: Map<string, StepPlace> }) {
  const [items, setItems] = useState<ActivityItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.learnerActivity(learner.id, 100).then(setItems, (e) => setError(problem(e)));
  }, [learner.id]);

  if (error) return <p className="note family__error">{error}</p>;
  if (!items) return <p className="note">Loading activity…</p>;
  if (items.length === 0) {
    return (
      <div className="card">
        <p className="note">No activity yet.</p>
      </div>
    );
  }

  return (
    <div className="card">
      <table className="data">
        <thead>
          <tr>
            <th>When</th>
            <th>What</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item, i) => {
            const place = item.step_id ? places.get(item.step_id) : undefined;
            const what = place ? `${place.lessonTitle} › ${place.stepTitle}` : item.step_id ?? "";
            const outcome =
              item.event_type === "attempt"
                ? item.correct
                  ? " — right"
                  : item.failure_kind === "parse"
                    ? " — typo"
                    : " — not yet"
                : "";
            return (
              <tr key={`${item.occurred_at}-${i}`}>
                <td>{ago(item.occurred_at)}</td>
                <td>
                  {EVENT_WORDS[item.event_type]} {what}
                  {outcome}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
