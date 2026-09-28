import type { SkillState } from "@copperkeep/contracts";

/**
 * A map, not a list — "you need this before that" should be visible, and the
 * branch-on-failure behaviour legible rather than punitive.
 *
 * A new learner's map has zero green on it. That is correct, and it is the point.
 */
function stateOf(skill: SkillState): { modifier: string; glyph: string; word: string } {
  if (skill.mastered) return { modifier: "mastered", glyph: "✓", word: "Mastered" };
  if (skill.review_due) return { modifier: "review", glyph: "◷", word: "Review due" };
  if (skill.gate) return { modifier: "failed", glyph: "✕", word: "Stuck" };
  if (skill.unlocked || skill.opportunities > 0)
    return { modifier: "progress", glyph: "●", word: "In progress" };
  return { modifier: "locked", glyph: "·", word: "Not yet" };
}

export function SkillMap({
  skills,
  learnerName,
}: {
  skills: SkillState[];
  /** Set when an adult is looking at someone else's map. */
  learnerName?: string;
}) {
  return (
    <section className="card">
      <div className="kicker">
        <span className="label">{learnerName ? `${learnerName}'s skills` : "Your skills"}</span>
      </div>
      <h2 className="display">
        What {learnerName ?? "you"} <span className="hl">{learnerName ? "knows" : "know"}</span>{" "}
        so far
      </h2>

      <div className="skill-map">
        {skills.map((skill) => {
          const { modifier, glyph, word } = stateOf(skill);
          return (
            <div className={`skill-node skill-node--${modifier}`} key={skill.skill_id}>
              <div className="dot" aria-hidden="true">
                {glyph}
              </div>
              <div className="t">
                {skill.title}
                {/* Colour is never the only carrier. */}
                <div className="label" style={{ marginTop: 4 }}>
                  {word}
                </div>
              </div>
            </div>
          );
        })}
      </div>
      {skills.length === 0 && <p className="note">Nothing yet — finish a step to start the map.</p>}
    </section>
  );
}
