"use client";
import { useState } from "react";

export default function LoginForm({ returnTo, app }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setError(""); setBusy(true);
    try {
      const r = await fetch("/sso/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password, return: returnTo || undefined, app: app || undefined }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || `Sign-in failed (${r.status})`);
      window.location.assign(j.redirect); // the server decided where this user belongs
    } catch (err) { setError(err.message); setBusy(false); }
  }

  return (
    <form onSubmit={submit} className="form">
      <label>Email
        <input type="email" required autoFocus autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" />
      </label>
      <label>Password
        <div className="pw">
          <input type={show ? "text" : "password"} required autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
          <button type="button" className="link" onClick={() => setShow(!show)}>{show ? "Hide" : "Show"}</button>
        </div>
      </label>
      {error && <div className="alert" role="alert">{error}</div>}
      <button className="btn go" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button>
    </form>
  );
}
