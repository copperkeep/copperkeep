import { useCallback, useEffect, useRef, useState } from "react";
import type { Course, Identity, LanguageRuntime, SkillState } from "@copperkeep/contracts";
import { createPythonRuntime } from "@copperkeep/runtime-python";
import { api, EventQueue } from "./api";
import { config } from "./config";
import { loadCourse, loadManifest, satisfiesMinAppVersion } from "./content";
import { applyDyslexiaFont, applyTheme, applyTier, type Theme } from "./theme";
import { Conformance } from "./components/Conformance";
import { LessonView } from "./components/LessonView";
import { Login } from "./components/Login";
import { SkillMap } from "./components/SkillMap";

type View = "lesson" | "map" | "conformance";

export function App() {
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [course, setCourse] = useState<Course | null>(null);
  const [skills, setSkills] = useState<SkillState[]>([]);
  const [runtime, setRuntime] = useState<LanguageRuntime | null>(null);
  const [loaderState, setLoaderState] = useState<"absent" | "fetching" | "ready">("absent");
  const [view, setView] = useState<View>(() => hashView());
  const [theme, setTheme] = useState<Theme>("auto");
  const [dyslexia, setDyslexia] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);

  const mergeSkills = useCallback((updated: SkillState[]) => {
    setSkills((current) => {
      const byId = new Map(current.map((skill) => [skill.skill_id, skill]));
      for (const skill of updated) byId.set(skill.skill_id, skill);
      return [...byId.values()].sort((a, b) => a.skill_id.localeCompare(b.skill_id));
    });
  }, []);

  const queue = useRef<EventQueue | null>(null);
  queue.current ??= new EventQueue(mergeSkills);

  useEffect(() => {
    const onHash = () => setView(hashView());
    globalThis.addEventListener("hashchange", onHash);
    return () => globalThis.removeEventListener("hashchange", onHash);
  }, []);

  // A device-bound session means the login screen should be rare.
  useEffect(() => {
    api.me().then(setIdentity, () => setIdentity(null));
  }, []);

  useEffect(() => {
    if (!identity) return;
    applyTheme(theme, identity.role);
    applyTier(identity.reading_tier);
  }, [identity, theme]);

  useEffect(() => applyDyslexiaFont(dyslexia), [dyslexia]);

  useEffect(() => {
    if (!identity) return;
    api.skills().then(setSkills, () => undefined);

    loadManifest()
      .then(async (manifest) => {
        if (!satisfiesMinAppVersion(config().appVersion, manifest.minAppVersion)) {
          setBanner(
            `This curriculum needs app version ${manifest.minAppVersion} or newer. ` +
              "Ask an adult to update Copperkeep.",
          );
          return;
        }
        const first = manifest.courses[0];
        if (first) setCourse(await loadCourse(first.path));
      })
      .catch(() => setBanner("Lessons are not available right now. Your progress is safe."));
  }, [identity]);

  // Lazy-loaded on first use, with an explicit first-run state. absent is the ordinary
  // path, not an error — an evicted cache is indistinguishable from a new device.
  //
  // Keyed on the learner, NOT on `runtime`. Depending on the state this effect sets is a
  // trap: storing the instance re-runs the effect, whose cleanup then disposes the very
  // runtime just stored, leaving a corpse behind which every Run button silently fails.
  const learnerId = identity?.user_id;
  useEffect(() => {
    if (!learnerId) return;
    let cancelled = false;

    const instance = createPythonRuntime({
      indexUrl: config().pyodideIndexUrl,
      onProgress: (progress) => setLoaderState(progress.state),
    });
    instance.init().then(
      () => {
        // Signed out while Pyodide was still loading: nothing will use it.
        if (cancelled) {
          instance.dispose();
          return;
        }
        setRuntime(instance);
        // Granted far more readily to installed apps; a classroom of tablets
        // cold-fetching Pyodide at once saturates the access point, not the server.
        void navigator.storage?.persist?.();
      },
      (error) => {
        if (!cancelled) setBanner(`Python could not start: ${String(error)}`);
      },
    );

    return () => {
      cancelled = true;
      instance.dispose();
      setRuntime(null);
    };
  }, [learnerId]);

  if (!identity) return <Login onSignedIn={setIdentity} />;

  const lesson = course?.modules[0]?.lessons[0] ?? null;

  return (
    <div className="shell">
      <header className="bar">
        <h1>Copperkeep</h1>
        <div className="controls">
          <span className="label">View</span>
          <div className="seg" role="group" aria-label="View">
            {(["lesson", "map", "conformance"] as View[]).map((option) => (
              <button
                key={option}
                className="tap tap--quiet"
                aria-pressed={view === option}
                onClick={() => {
                  globalThis.location.hash = option;
                  setView(option);
                }}
              >
                {option === "lesson" ? "Lesson" : option === "map" ? "Skills" : "Runtime"}
              </button>
            ))}
          </div>

          <span className="label">Theme</span>
          <div className="seg" role="group" aria-label="Theme">
            {(["auto", "light", "dark"] as Theme[]).map((option) => (
              <button
                key={option}
                className="tap tap--quiet"
                aria-pressed={theme === option}
                onClick={() => setTheme(option)}
              >
                {option}
              </button>
            ))}
          </div>

          <button
            className="tap tap--quiet"
            aria-pressed={dyslexia}
            onClick={() => setDyslexia(!dyslexia)}
          >
            Easier letters
          </button>

          <button
            className="tap tap--quiet"
            onClick={() => api.logout().then(() => setIdentity(null))}
          >
            Sign out
          </button>
        </div>
      </header>

      {banner && (
        <div className="card" role="status" style={{ marginBottom: 16 }}>
          <p>{banner}</p>
        </div>
      )}

      {loaderState === "fetching" && (
        <div className="card" role="status" style={{ marginBottom: 16 }}>
          <span className="label">First run</span>
          <p>Downloading Python… this happens once on this device.</p>
        </div>
      )}

      {view === "conformance" && <Conformance runtime={runtime} />}
      {view === "map" && <SkillMap skills={skills} />}
      {view === "lesson" &&
        (lesson && course ? (
          <LessonView
            lesson={lesson}
            courseId={course.id}
            identity={identity}
            runtime={runtime}
            queue={queue.current!}
          />
        ) : (
          <section className="card">
            <p>No lessons loaded yet.</p>
          </section>
        ))}
    </div>
  );
}

function hashView(): View {
  const hash = globalThis.location?.hash.replace("#", "");
  return hash === "map" || hash === "conformance" ? hash : "lesson";
}
