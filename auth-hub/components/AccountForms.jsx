"use client";
import { useState } from "react";

export default function AccountForms() {
  const [cur, setCur] = useState(""), [next, setNext] = useState("");
  const [msg, setMsg] = useState(null), [busy, setBusy] = useState(false);

  async function change(e) {
    e.preventDefault(); setMsg(null); setBusy(true);
    const r = await fetch("/api/account/password", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ current: cur, next }) });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) return setMsg({ bad: true, text: j.error || "Could not change the password" });
    setCur(""); setNext(""); setMsg({ text: "Password changed. Your other devices were signed out." });
  }
  async function signOutAll() {
    if (!confirm("Sign out of every device, including this one?")) return;
    await fetch("/api/account/signout-all", { method: "POST" });
    window.location.assign("/login");
  }

  return (
    <section className="card">
      <h3>Change password</h3>
      <form onSubmit={change} className="form">
        <label>Current password<input type="password" required autoComplete="current-password" value={cur} onChange={(e) => setCur(e.target.value)} /></label>
        <label>New password <em>min 10 characters</em><input type="password" required minLength={10} autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} /></label>
        {msg && <div className={msg.bad ? "alert" : "okmsg"}>{msg.text}</div>}
        <button className="btn go" disabled={busy}>{busy ? "Saving…" : "Change password"}</button>
      </form>
      <hr />
      <h3>Sessions</h3>
      <p className="muted">Lost a laptop or used a shared computer? Sign out everywhere.</p>
      <button className="btn danger" onClick={signOutAll}>Sign out of all devices</button>
    </section>
  );
}
