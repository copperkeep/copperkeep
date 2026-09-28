import { useState, type FormEvent } from "react";
import type { Identity, Person, ReadingTier } from "@copperkeep/contracts";
import { api } from "../../api";
import { problem, TIER_LABEL } from "./format";

interface Props {
  person: Person;
  people: Person[];
  identity: Identity;
  onChanged: () => void | Promise<void>;
  onRemoved: () => void | Promise<void>;
}

/** One account: its details, its credential, who it is linked to, and removal. */
export function PersonPanel({ person, people, identity, onChanged, onRemoved }: Props) {
  const isAdmin = identity.is_admin === true;
  const isSelf = person.id === identity.user_id;
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);

  async function act(action: () => Promise<unknown>, done: string) {
    try {
      await action();
      setStatus({ ok: true, text: done });
      await onChanged();
    } catch (e) {
      setStatus({ ok: false, text: problem(e) });
    }
  }

  return (
    <section className="card family__panel" aria-label={`Account: ${person.display_name}`}>
      <div className="kicker">
        <span className="label">
          {person.role === "learner" ? "Learner" : person.is_admin ? "Admin" : "Adult"} account
        </span>
      </div>
      <h2 className="display">{person.display_name}</h2>

      {status && (
        <p
          className={`note ${status.ok ? "family__ok" : "family__error"}`}
          role={status.ok ? "status" : "alert"}
        >
          {status.text}
        </p>
      )}

      <Details person={person} canSetAdmin={isAdmin && person.role === "adult"} act={act} />

      {person.role === "learner" ? (
        <Secret
          label="New PIN (4–8 digits)"
          pattern="\d{4,8}"
          button="Reset PIN"
          onSubmit={(pin) => act(() => api.resetPin(person.id, pin), "PIN changed.")}
        />
      ) : (
        (isAdmin || isSelf) && (
          <Secret
            label="New password (8+ characters)"
            minLength={8}
            button={isSelf ? "Change my password" : "Reset password"}
            onSubmit={(password) =>
              act(
                () => api.setPassword(person.id, password),
                "Password changed. Other devices signed in as this account are signed out.",
              )
            }
          />
        )
      )}

      {person.locked && (
        <div className="callout family__row">
          <span>
            Locked after {person.failed_attempts} wrong tries. Only an adult can unlock it.
          </span>
          <button
            className="tap"
            onClick={() => act(() => api.unlock(person.id), "Unlocked — they can sign in again.")}
          >
            Unlock
          </button>
        </div>
      )}

      {isAdmin && <Links person={person} people={people} act={act} />}

      {isAdmin && !isSelf && (
        <Remove
          person={person}
          onRemove={async () => {
            // Not through act(): only a removal that succeeded may move the page on.
            try {
              await api.removePerson(person.id);
              await onRemoved();
            } catch (e) {
              setStatus({ ok: false, text: problem(e) });
            }
          }}
        />
      )}
    </section>
  );
}

function Details({
  person,
  canSetAdmin,
  act,
}: {
  person: Person;
  canSetAdmin: boolean;
  act: (action: () => Promise<unknown>, done: string) => Promise<void>;
}) {
  const [displayName, setDisplayName] = useState(person.display_name);
  const [username, setUsername] = useState(person.username);
  const [tier, setTier] = useState<ReadingTier>(person.reading_tier);
  const [admin, setAdmin] = useState(person.is_admin);

  const changed =
    displayName !== person.display_name ||
    username !== person.username ||
    tier !== person.reading_tier ||
    admin !== person.is_admin;

  function save(event: FormEvent) {
    event.preventDefault();
    void act(
      () =>
        api.updatePerson(person.id, {
          ...(displayName !== person.display_name && { display_name: displayName }),
          ...(username !== person.username && { username }),
          ...(tier !== person.reading_tier && { reading_tier: tier }),
          ...(admin !== person.is_admin && { is_admin: admin }),
        }),
      "Saved.",
    );
  }

  return (
    <form className="family__form" onSubmit={save}>
      <label>
        <span className="label">Name they see</span>
        <input required value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
      </label>
      <label>
        <span className="label">Username</span>
        <input
          required
          pattern="[A-Za-z0-9_.\-]+"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          autoComplete="off"
        />
      </label>
      {person.role === "learner" && (
        <label>
          <span className="label">Reading level</span>
          <select value={tier} onChange={(e) => setTier(e.target.value as ReadingTier)}>
            <option value="grade3">{TIER_LABEL.grade3}</option>
            <option value="adult">{TIER_LABEL.adult}</option>
          </select>
        </label>
      )}
      {canSetAdmin && (
        <label className="family__check">
          <input type="checkbox" checked={admin} onChange={(e) => setAdmin(e.target.checked)} />
          <span>Admin — can see and manage everyone</span>
        </label>
      )}
      <button className="tap tap--primary" disabled={!changed}>
        Save changes
      </button>
    </form>
  );
}

function Secret({
  label,
  button,
  pattern,
  minLength,
  onSubmit,
}: {
  label: string;
  button: string;
  pattern?: string;
  minLength?: number;
  onSubmit: (secret: string) => Promise<void>;
}) {
  const [value, setValue] = useState("");
  return (
    <form
      className="family__form family__row"
      onSubmit={async (event) => {
        event.preventDefault();
        await onSubmit(value);
        setValue("");
      }}
    >
      <label>
        <span className="label">{label}</span>
        <input
          required
          type={pattern ? "text" : "password"}
          inputMode={pattern ? "numeric" : undefined}
          pattern={pattern}
          minLength={minLength}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          autoComplete="new-password"
        />
      </label>
      <button className="tap">{button}</button>
    </form>
  );
}

/** Which adults see this learner, or which learners this adult sees. */
function Links({
  person,
  people,
  act,
}: {
  person: Person;
  people: Person[];
  act: (action: () => Promise<unknown>, done: string) => Promise<void>;
}) {
  const others = people.filter((p) => p.role !== person.role);
  if (others.length === 0) return null;
  const heading =
    person.role === "learner"
      ? "Adults who can see this learner"
      : person.is_admin
        ? "Learners linked to this admin (an admin sees everyone anyway)"
        : "Learners this adult can see";

  return (
    <fieldset className="family__links">
      <legend className="label">{heading}</legend>
      {others.map((other) => {
        const linked = person.linked.includes(other.id);
        const [adultId, learnerId] =
          person.role === "learner" ? [other.id, person.id] : [person.id, other.id];
        return (
          <label key={other.id} className="family__check">
            <input
              type="checkbox"
              checked={linked}
              onChange={() =>
                act(
                  () => (linked ? api.unlink(adultId, learnerId) : api.link(adultId, learnerId)),
                  linked ? `Unlinked ${other.display_name}.` : `Linked ${other.display_name}.`,
                )
              }
            />
            <span>{other.display_name}</span>
          </label>
        );
      })}
    </fieldset>
  );
}

function Remove({ person, onRemove }: { person: Person; onRemove: () => Promise<unknown> }) {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  if (!open) {
    return (
      <button className="tap tap--quiet family__danger" onClick={() => setOpen(true)}>
        Remove this account…
      </button>
    );
  }
  return (
    <div className="callout family__remove">
      <p>
        This deletes <strong>{person.display_name}</strong> and everything they have done —
        progress, code, reports. It cannot be undone.
      </p>
      <label>
        <span className="label">Type {person.username} to confirm</span>
        <input value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" />
      </label>
      <div className="family__row">
        <button className="tap tap--quiet" onClick={() => setOpen(false)}>
          Keep it
        </button>
        <button
          className="tap family__danger"
          disabled={typed !== person.username}
          onClick={() => void onRemove()}
        >
          Remove forever
        </button>
      </div>
    </div>
  );
}
