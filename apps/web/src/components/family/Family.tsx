import { useCallback, useEffect, useState, type FormEvent } from "react";
import type { Course, Identity, Person, ReadingTier } from "@copperkeep/contracts";
import { api } from "../../api";
import { ago, problem, TIER_LABEL } from "./format";
import { LearnerProgress } from "./LearnerProgress";
import { PersonPanel } from "./PersonPanel";

/**
 * The adult's home: everyone they can see, and — for the one picked — their account and,
 * for a learner, their progress. The org admin sees every account; another adult sees
 * themself and the learners linked to them. The server enforces that; this only renders
 * what it is given.
 */
export function Family({ identity, courses }: { identity: Identity; courses: Course[] }) {
  const [people, setPeople] = useState<Person[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [adding, setAdding] = useState<"learner" | "adult" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const list = await api.people();
      setPeople(list);
      setSelectedId((current) =>
        current && list.some((p) => p.id === current)
          ? current
          : (list.find((p) => p.role === "learner") ?? list[0])?.id ?? null,
      );
      setError(null);
    } catch (e) {
      setError(problem(e));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const selected = people?.find((p) => p.id === selectedId) ?? null;
  const isAdmin = identity.is_admin === true;

  return (
    <div className="family">
      <section className="card family__people">
        <div className="kicker">
          <span className="label">{isAdmin ? "Everyone" : "Your learners"}</span>
        </div>
        <h2 className="display">
          Who is <span className="hl">learning</span>
        </h2>

        {error && (
          <p className="note family__error" role="alert">
            {error}
          </p>
        )}
        {people === null && !error && <p className="note">Loading…</p>}

        {people && (
          <table className="data family__table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Role</th>
                <th>Last active</th>
              </tr>
            </thead>
            <tbody>
              {people.map((person) => (
                <tr key={person.id} aria-selected={person.id === selectedId}>
                  <td>
                    <button className="family__name" onClick={() => setSelectedId(person.id)}>
                      <span>{person.display_name}</span>
                      <span className="label">@{person.username}</span>
                    </button>
                    {person.locked && <span className="family__badge">Locked</span>}
                    {!person.locked && person.failed_attempts > 0 && (
                      <span className="family__badge family__badge--quiet">
                        {person.failed_attempts} failed sign-in
                        {person.failed_attempts === 1 ? "" : "s"}
                      </span>
                    )}
                  </td>
                  <td>
                    {person.role === "learner" ? "Learner" : person.is_admin ? "Admin" : "Adult"}
                    {person.role === "learner" && (
                      <span className="label family__tier">{TIER_LABEL[person.reading_tier]}</span>
                    )}
                  </td>
                  <td>{ago(person.last_active)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <div className="family__add">
          <button
            className="tap tap--quiet"
            aria-pressed={adding === "learner"}
            onClick={() => setAdding(adding === "learner" ? null : "learner")}
          >
            Add a learner
          </button>
          {isAdmin && (
            <button
              className="tap tap--quiet"
              aria-pressed={adding === "adult"}
              onClick={() => setAdding(adding === "adult" ? null : "adult")}
            >
              Add an adult
            </button>
          )}
        </div>
        {adding && (
          <AddPerson
            kind={adding}
            onDone={async (id) => {
              setAdding(null);
              await refresh();
              if (id) setSelectedId(id);
            }}
          />
        )}
      </section>

      {selected && people && (
        <div className="family__detail">
          <PersonPanel
            key={selected.id}
            person={selected}
            people={people}
            identity={identity}
            onChanged={refresh}
            onRemoved={async () => {
              setSelectedId(null);
              await refresh();
            }}
          />
          {selected.role === "learner" && (
            <LearnerProgress key={`progress-${selected.id}`} learner={selected} courses={courses} />
          )}
        </div>
      )}
    </div>
  );
}

function AddPerson({
  kind,
  onDone,
}: {
  kind: "learner" | "adult";
  onDone: (id: string | null) => void | Promise<void>;
}) {
  const [displayName, setDisplayName] = useState("");
  const [username, setUsername] = useState("");
  const [secret, setSecret] = useState("");
  const [tier, setTier] = useState<ReadingTier>("grade3");
  const [admin, setAdmin] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const id =
        kind === "learner"
          ? (
              await api.createLearner({
                username,
                display_name: displayName,
                pin: secret,
                reading_tier: tier,
              })
            ).learnerId
          : (
              await api.createAdult({
                username,
                display_name: displayName,
                password: secret,
                is_admin: admin,
              })
            ).userId;
      await onDone(id);
    } catch (e) {
      setError(problem(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="panel family__form" onSubmit={submit}>
      <label>
        <span className="label">Name they see</span>
        <input required value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
      </label>
      <label>
        <span className="label">Username</span>
        <input
          required
          pattern="[A-Za-z0-9_.\-]+"
          title="Letters, numbers, dot, dash or underscore"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          autoComplete="off"
        />
      </label>
      {kind === "learner" ? (
        <>
          <label>
            <span className="label">PIN (4–8 digits)</span>
            <input
              required
              inputMode="numeric"
              pattern="\d{4,8}"
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
              autoComplete="off"
            />
          </label>
          <label>
            <span className="label">Reading level</span>
            <select value={tier} onChange={(e) => setTier(e.target.value as ReadingTier)}>
              <option value="grade3">{TIER_LABEL.grade3}</option>
              <option value="adult">{TIER_LABEL.adult}</option>
            </select>
          </label>
        </>
      ) : (
        <>
          <label>
            <span className="label">Password (8+ characters)</span>
            <input
              required
              type="password"
              minLength={8}
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
              autoComplete="new-password"
            />
          </label>
          <label className="family__check">
            <input type="checkbox" checked={admin} onChange={(e) => setAdmin(e.target.checked)} />
            <span>Admin — can see and manage everyone</span>
          </label>
        </>
      )}
      {error && (
        <p className="note family__error" role="alert">
          {error}
        </p>
      )}
      <button className="tap tap--primary" disabled={busy}>
        {kind === "learner" ? "Add learner" : "Add adult"}
      </button>
    </form>
  );
}
