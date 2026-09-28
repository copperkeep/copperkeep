import { useEffect, useRef, useState } from "react";
import type { Course, Lesson } from "@copperkeep/contracts";

export interface LessonEntry {
  course: Course;
  moduleTitle: string;
  lesson: Lesson;
}

interface Props {
  courses: Course[];
  entries: LessonEntry[];
  current: number;
  isOpen: (lesson: Lesson) => boolean;
  isDone: (lesson: Lesson) => boolean;
  onSelect: (index: number) => void;
}

/**
 * One compact bar instead of a chip for every lesson. With three courses there are a
 * hundred lessons, and a wall of chips pushes the lesson itself below the fold. The bar
 * shows where you are and steps to the neighbouring open lesson; the outline, opened from
 * it, is where you browse — grouped by course and module, closed again once you pick.
 */
export function LessonNav({ courses, entries, current, isOpen, isDone, onSelect }: Props) {
  const [outlineOpen, setOutlineOpen] = useState(false);
  const here = entries[current];
  const [courseTab, setCourseTab] = useState(here?.course.id ?? courses[0]?.id);
  const outlineRef = useRef<HTMLElement>(null);

  // Open on the course you are in, not whichever tab was last browsed.
  useEffect(() => {
    if (outlineOpen && here) setCourseTab(here.course.id);
  }, [outlineOpen, here]);

  useEffect(() => {
    if (!outlineOpen) return;
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && setOutlineOpen(false);
    globalThis.addEventListener("keydown", onKey);
    outlineRef.current?.querySelector<HTMLButtonElement>("[aria-current='true']")?.focus();
    return () => globalThis.removeEventListener("keydown", onKey);
  }, [outlineOpen]);

  if (!here) return null;

  const neighbour = (direction: 1 | -1) => {
    for (let i = current + direction; i >= 0 && i < entries.length; i += direction) {
      if (isOpen(entries[i]!.lesson)) return i;
    }
    return -1;
  };
  const prev = neighbour(-1);
  const next = neighbour(1);
  const inCourse = entries.filter((entry) => entry.course.id === here.course.id);
  const positionInCourse = inCourse.findIndex((entry) => entry.lesson.id === here.lesson.id);

  const choose = (index: number) => {
    onSelect(index);
    setOutlineOpen(false);
  };

  const tab = courses.find((course) => course.id === courseTab) ?? here.course;

  return (
    <div className="lesson-nav">
      <div className="lesson-bar">
        <button
          className="tap tap--quiet"
          aria-label="Previous lesson"
          disabled={prev === -1}
          onClick={() => onSelect(prev)}
        >
          ‹
        </button>
        <button
          className="lesson-bar__current"
          aria-expanded={outlineOpen}
          aria-controls="lesson-outline"
          onClick={() => setOutlineOpen(!outlineOpen)}
        >
          <span className="label">
            {here.course.title} · {here.moduleTitle}
          </span>
          <span className="lesson-bar__title">
            {here.lesson.title} <span aria-hidden="true">{outlineOpen ? "▴" : "▾"}</span>
          </span>
        </button>
        <button
          className="tap tap--quiet"
          aria-label="Next lesson"
          disabled={next === -1}
          onClick={() => onSelect(next)}
        >
          ›
        </button>
        <span className="label lesson-bar__count">
          Lesson {positionInCourse + 1} of {inCourse.length}
        </span>
      </div>

      {outlineOpen && (
        <nav id="lesson-outline" className="card outline" aria-label="Lessons" ref={outlineRef}>
          {courses.length > 1 && (
            <div className="seg" role="group" aria-label="Course">
              {courses.map((course) => (
                <button
                  key={course.id}
                  className="tap tap--quiet"
                  aria-pressed={course.id === tab.id}
                  onClick={() => setCourseTab(course.id)}
                >
                  {course.title}
                </button>
              ))}
            </div>
          )}
          <div className="outline__modules">
            {tab.modules.map((module) => (
              <section key={module.id} className="outline__module">
                <h3 className="label">{module.title}</h3>
                <ol>
                  {module.lessons.map((lesson) => {
                    const index = entries.findIndex(
                      (entry) => entry.course.id === tab.id && entry.lesson.id === lesson.id,
                    );
                    const open = isOpen(lesson);
                    const done = isDone(lesson);
                    return (
                      <li key={lesson.id}>
                        <button
                          className="outline__lesson"
                          aria-current={index === current}
                          aria-disabled={!open}
                          title={open ? lesson.claim : "Finish the earlier lessons first"}
                          onClick={() => open && choose(index)}
                        >
                          <span className="outline__mark" aria-hidden="true">
                            {done ? "✓" : open ? "" : <LockIcon />}
                          </span>
                          <span>{lesson.title}</span>
                          {done && <span className="visually-hidden"> (done)</span>}
                          {!open && <span className="visually-hidden"> (locked)</span>}
                        </button>
                      </li>
                    );
                  })}
                </ol>
              </section>
            ))}
          </div>
        </nav>
      )}
    </div>
  );
}

/** Drawn, not an emoji: an emoji lock depends on the device having a colour emoji font. */
function LockIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor">
      <rect x="2" y="5.5" width="8" height="5.5" rx="1" strokeWidth="1.3" />
      <path d="M4 5.5V4a2 2 0 0 1 4 0v1.5" strokeWidth="1.3" />
    </svg>
  );
}
