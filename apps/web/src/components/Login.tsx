import { useState } from "react";
import type { Identity } from "@copperkeep/contracts";
import { api, ApiError } from "../api";

/**
 * A password is the wrong credential for an 8-year-old. PIN is the simplest thing that
 * works on a trusted device; the adult path uses a password.
 *
 * The keyspace here is 10,000, which is exactly why the server throttles per account.
 */
export function Login({ onSignedIn }: { onSignedIn: (identity: Identity) => void }) {
  const [org, setOrg] = useState("home");
  const [username, setUsername] = useState("");
  const [secret, setSecret] = useState("");
  const [method, setMethod] = useState<"pin" | "password">("pin");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      onSignedIn(await api.login(org, username, secret, method));
    } catch (caught) {
      setError(
        caught instanceof ApiError && caught.status === 429
          ? "Too many tries. Ask an adult to unlock this account."
          : "That did not work. Check the name and try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="card" style={{ maxWidth: 420, margin: "48px auto" }} onSubmit={submit}>
      <div className="kicker">
        <span className="label">Sign in</span>
      </div>
      <h2 className="display">
        Welcome <span className="hl">back</span>
      </h2>

      <label className="label" htmlFor="org">
        Group
      </label>
      <input id="org" className="field" value={org} onChange={(e) => setOrg(e.target.value)} />

      <label className="label" htmlFor="username">
        Name
      </label>
      <input
        id="username"
        className="field"
        autoComplete="username"
        value={username}
        onChange={(e) => setUsername(e.target.value)}
      />

      <label className="label" htmlFor="secret">
        {method === "pin" ? "Your 4 numbers" : "Password"}
      </label>
      <input
        id="secret"
        className="field"
        type="password"
        inputMode={method === "pin" ? "numeric" : "text"}
        autoComplete={method === "pin" ? "off" : "current-password"}
        value={secret}
        onChange={(e) => setSecret(e.target.value)}
      />

      {error && (
        <p className="note" style={{ color: "var(--accent-hot)" }} role="alert">
          {error}
        </p>
      )}

      <div className="btns">
        <button className="tap tap--primary" type="submit" disabled={busy}>
          Go
        </button>
        <button
          className="tap tap--quiet"
          type="button"
          onClick={() => setMethod(method === "pin" ? "password" : "pin")}
        >
          {method === "pin" ? "I'm a grown-up" : "I'm a learner"}
        </button>
      </div>
    </form>
  );
}
