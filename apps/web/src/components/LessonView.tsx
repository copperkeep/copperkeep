import { useEffect, useMemo, useRef, useState } from "react";
import type {
  EvalResult,
  Hint,
  Identity,
  LanguageRuntime,
  Lesson,
  RunResult,
} from "@copperkeep/contracts";
import { api, EventQueue } from "../api";
import { Editor } from "./Editor";
import { OutputPane } from "./OutputPane";

type Pane = "read" | "code" | "run";

export function LessonView({
  lesson,
  courseId,
  identity,
  runtime,
  queue,
  nextLessonTitle,
  onNextLesson,
  onSeeSkills,
}: {
  lesson: Lesson;
  courseId: string;
  identity: Identity;
  runtime: LanguageRuntime | null;
  queue: EventQueue;
  nextLessonTitle: string | null;
  onNextLesson: () => void;
  onSeeSkills: () => void;
}) {
  const [stepIndex, setStepIndex] = useState(0);
  const step = lesson.steps[stepIndex]!;

  const [code, setCode] = useState(step.starter ?? "");
  const [run, setRun] = useState<RunResult | null>(null);
  const [evaluation, setEvaluation] = useState<EvalResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [semanticFailures, setSemanticFailures] = useState(0);
  const [aiHint, setAiHint] = useState<Hint | null>(null);
  const [choice, setChoice] = useState<string | null>(null);
  const [order, setOrder] = useState<string[]>([]);
  const [answeredCorrectly, setAnsweredCorrectly] = useState(false);
  const startedAt = useRef(Date.now());

  const tier = identity.reading_tier;
  const prose = step.prose[tier] ?? step.prose.grade3 ?? step.prose.adult ?? "";

  // The authored ladder is keyed on semantic failures of this step, and lives in this
  // step's content. It is not the skill gate (§6.5) — a learner can exhaust this
  // without moving the gate at all.
  const authoredHints = useMemo(
    () =>
      step.hints
        .filter((hint) => hint.tier === tier || hint.tier === "grade3")
        .filter((hint) => semanticFailures >= hint.afterSemanticFailures),
    [step.hints, tier, semanticFailures],
  );
  const ladderExhausted = authoredHints.length > 0 && authoredHints.length === step.hints.length;

  useEffect(() => {
    setCode(step.starter ?? "");
    setRun(null);
    setEvaluation(null);
    setSemanticFailures(0);
    setAiHint(null);
    setChoice(null);
    setAnsweredCorrectly(false);
    setOrder(shuffle([...(step.lines ?? []), ...(step.distractors ?? [])]));
    startedAt.current = Date.now();
    queue.push({ event_type: "step_started", course_id: courseId, step_id: step.id });
  }, [step.id, courseId, queue, step.starter, step.lines, step.distractors]);

  async function handleRun() {
    if (!runtime) return;
    setBusy(true);
    try {
      setRun(await runtime.run(code));
    } catch (error) {
      // A button that does nothing is the worst possible failure: the learner has no
      // idea whether they are wrong or the app is broken. Say so in the output pane.
      setRun({
        stdout: "",
        stderr: `Python could not run: ${String(error)}`,
        exitCode: 1,
        durationMs: 0,
        timedOut: false,
      });
    } finally {
      setBusy(false);
    }
  }

  async function handleSubmit() {
    if (!runtime || !step.tests) return;
    setBusy(true);
    try {
      const result = await runtime.evaluate(code, step.tests);
      setEvaluation(result);
      setAnsweredCorrectly(result.passed);
      await record(result, code);
    } catch (error) {
      setRun({
        stdout: "",
        stderr: `Could not check your answer: ${String(error)}`,
        exitCode: 1,
        durationMs: 0,
        timedOut: false,
      });
    } finally {
      setBusy(false);
    }
  }

  async function record(result: EvalResult, submittedCode: string) {
    // Stored verbatim, and referenced by the step_completed event — the server has no
    // execution of its own, so the submission is the evidence.
    const { submission_id } = await api.submit(step.id, submittedCode, result);

    queue.push({
      event_type: "attempt",
      course_id: courseId,
      step_id: step.id,
      correct: result.passed,
      failure_kind: result.failureKind ?? undefined,
      hint_source: aiHint ? "ai" : authoredHints.length > 0 ? "authored" : undefined,
      submission_id,
      payload: {
        durationMs: result.durationMs,
        msOnStep: Date.now() - startedAt.current,
        hintsShown: authoredHints.length,
      },
    });

    if (result.passed) {
      queue.push({
        event_type: "step_completed",
        course_id: courseId,
        step_id: step.id,
        submission_id,
      });
      await queue.flush();
    } else if (result.failureKind === "semantic") {
      // Only semantic failures move the ladder. A learner can fight a missing colon
      // twenty times without being re-taught.
      setSemanticFailures((count) => count + 1);
    }
  }

  async function handleStuck() {
    const shown = authoredHints.map((hint) => hint.text);
    if (!ladderExhausted) {
      setSemanticFailures((count) => Math.max(count + 1, (step.hints[0]?.afterSemanticFailures ?? 1)));
      return;
    }
    const hint = await api.hint(step.id, code, shown);
    if (hint) {
      setAiHint(hint);
      queue.push({
        event_type: "hint_shown",
        course_id: courseId,
        step_id: step.id,
        hint_source: "ai",
      });
    }
  }

  function recordChoice(correct: boolean) {
    setAnsweredCorrectly(correct);
    queue.push({
      event_type: "attempt",
      course_id: courseId,
      step_id: step.id,
      correct,
      // There is no interpreter involved, so a wrong pick is a wrong answer, full stop.
      failure_kind: correct ? undefined : "semantic",
      payload: { msOnStep: Date.now() - startedAt.current },
    });
    if (!correct) setSemanticFailures((count) => count + 1);
  }

  function submitChoice(option: string) {
    setChoice(option);
    recordChoice(option === step.answer);
  }

  function submitParsons() {
    const expected = step.lines ?? [];
    // The distractors have to end up below the answer, not merely somewhere else.
    const correct = expected.every((line, i) => order[i] === line);
    setChoice(correct ? "correct" : "incorrect");
    recordChoice(correct);
  }

  const isLast = stepIndex === lesson.steps.length - 1;
  // A finished lesson needs somewhere to go. Leaving a disabled button on screen tells a
  // learner they succeeded and then strands them there.
  const finished = isLast && (answeredCorrectly || step.type === "narrative");

  return (
    <div className="lesson">
      <section className="pane pane--read" data-pane={"read" satisfies Pane}>
        <div className="kicker">
          <span className="label">
            {stepIndex + 1} / {lesson.title} / {step.title}
          </span>
        </div>
        <h2 className="display">{renderClaim(lesson.claim)}</h2>
        <p className="lede">{prose}</p>

        {step.audio?.[tier] && (
          <audio controls src={step.audio[tier]} style={{ width: "100%", marginBottom: 12 }}>
            <track kind="captions" />
          </audio>
        )}

        <div className="progress" aria-label="Steps in this lesson">
          {lesson.steps.map((s, i) => (
            <span key={s.id} data-done={i < stepIndex} />
          ))}
        </div>

        {authoredHints.map((hint, i) => (
          <div className="hint" key={i}>
            <span className="label">Hint</span>
            <p>{hint.text}</p>
          </div>
        ))}

        {aiHint && (
          <div className="hint hint--ai">
            <span className="label">Generated</span>
            <p>
              {aiHint.observation} {aiHint.nudge}
            </p>
          </div>
        )}
      </section>

      <section className="pane pane--code" data-pane={"code" satisfies Pane}>
        {step.type === "free-code" || step.type === "fill-blank" || step.type === "project" ? (
          <>
            <div className="code__title">Your code</div>
            <Editor value={code} onChange={setCode} />
          </>
        ) : step.type === "predict" || step.type === "explain-back" ? (
          <>
            <div className="code__title">What does this print?</div>
            {step.starter && <pre className="code">{step.starter}</pre>}
            <div style={{ marginTop: 12, display: "grid", gap: 8 }}>
              {(step.options ?? []).map((option) => (
                <button
                  key={option}
                  className="tap"
                  disabled={choice !== null}
                  aria-pressed={choice === option}
                  onClick={() => submitChoice(option)}
                >
                  {option}
                </button>
              ))}
            </div>
            {choice !== null && (
              <p className="note">
                {choice === step.answer ? "That's right." : "Not quite — read the code again."}
              </p>
            )}
          </>
        ) : step.type === "parsons" ? (
          <>
            <div className="code__title">Put the lines in order</div>
            {/* Buttons rather than drag-and-drop: parsons steps must need no typing and
                no precise pointer, and they have to work from a keyboard. */}
            {order.map((line, i) => (
              <div className="parsons-line" key={line}>
                <code style={{ flex: 1 }}>{line}</code>
                <button
                  className="tap tap--quiet"
                  aria-label={`Move ${line} up`}
                  disabled={i === 0}
                  onClick={() => setOrder(move(order, i, -1))}
                >
                  ↑
                </button>
                <button
                  className="tap tap--quiet"
                  aria-label={`Move ${line} down`}
                  disabled={i === order.length - 1}
                  onClick={() => setOrder(move(order, i, 1))}
                >
                  ↓
                </button>
              </div>
            ))}
            {choice !== null && (
              <p className="note">
                {choice === "correct"
                  ? "That's it."
                  : "Not yet — one of those lines does not belong in the loop."}
              </p>
            )}
          </>
        ) : (
          <p className="note">Read this one, then continue.</p>
        )}

        <div className="btns">
          {step.tests && (
            <>
              <button className="tap" onClick={handleRun} disabled={busy || !runtime}>
                Run
              </button>
              <button className="tap tap--primary" onClick={handleSubmit} disabled={busy || !runtime}>
                Check my answer
              </button>
            </>
          )}
          {step.type === "parsons" && (
            <button className="tap tap--primary" onClick={submitParsons}>
              Check my answer
            </button>
          )}
          {/* Always visible, never behind a menu. */}
          <button className="tap" onClick={handleStuck}>
            I&apos;m stuck
          </button>
          {(answeredCorrectly || step.type === "narrative") && !isLast && (
            <button
              className="tap tap--primary"
              onClick={() => setStepIndex((i) => i + 1)}
            >
              Next
            </button>
          )}
        </div>
      </section>

      <section className="pane pane--run" data-pane={"run" satisfies Pane}>
        {finished ? (
          <div className="card">
            <div className="kicker">
              <span className="label">Lesson complete</span>
            </div>
            <h2 className="display">
              You finished <span className="hl">{lesson.title}</span>
            </h2>
            <p>
              {nextLessonTitle
                ? "Your skills are saved. Ready for the next one?"
                : "Your skills are saved. That is the last lesson here for now."}
            </p>
            <div className="btns">
              {nextLessonTitle && (
                <button className="tap tap--primary" onClick={onNextLesson}>
                  Start {nextLessonTitle}
                </button>
              )}
              <button className="tap" onClick={onSeeSkills}>
                See your skills
              </button>
            </div>
          </div>
        ) : (
          <>
            <OutputPane run={run} evaluation={evaluation} />
            {busy && <p className="note">Running…</p>}
          </>
        )}
      </section>
    </div>
  );
}

/** The claim is the headline; one word of it carries the accent. */
function renderClaim(claim: string) {
  const words = claim.split(" ");
  if (words.length < 3) return claim;
  const highlight = Math.floor(words.length / 2);
  return (
    <>
      {words.slice(0, highlight).join(" ")} <span className="hl">{words[highlight]}</span>{" "}
      {words.slice(highlight + 1).join(" ")}
    </>
  );
}

function move(items: string[], from: number, delta: number): string[] {
  const next = [...items];
  const [item] = next.splice(from, 1);
  next.splice(from + delta, 0, item!);
  return next;
}

function shuffle(items: string[]): string[] {
  const next = [...items];
  for (let i = next.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [next[i], next[j]] = [next[j]!, next[i]!];
  }
  return next;
}
