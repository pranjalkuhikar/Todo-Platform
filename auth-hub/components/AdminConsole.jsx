"use client";
import { useCallback, useEffect, useState } from "react";

async function api(url, method = "GET", body) {
  const r = await fetch(url, { method, headers: body ? { "content-type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `Request failed (${r.status})`);
  return j;
}
const ago = (t) => {
  if (!t) return "never";
  const s = (Date.now() - new Date(t)) / 1000;
  return s < 60 ? "just now" : s < 3600 ? `${Math.floor(s / 60)} min ago` : s < 86400 ? `${Math.floor(s / 3600)} h ago` : `${Math.floor(s / 86400)} d ago`;
};
const genPassword = () => { const a = new Uint8Array(12); crypto.getRandomValues(a); return btoa(String.fromCharCode(...a)).replace(/[+/=]/g, "x") + "9!"; };

function Modal({ title, onClose, children, wide }) {
  useEffect(() => { const k = (e) => e.key === "Escape" && onClose(); window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k); }, [onClose]);
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={"modal card" + (wide ? " wide" : "")} role="dialog" aria-label={title}>
        <div className="mhead"><h3>{title}</h3><button className="icon" onClick={onClose} aria-label="Close">×</button></div>
        {children}
      </div>
    </div>
  );
}

// ---------------- users ----------------
function UserForm({ user, apps, me, onDone, onClose }) {
  const editing = !!user;
  const [f, setF] = useState(() => ({
    email: user?.email || "", name: user?.name || "", role: user?.role || "user", disabled: !!user?.disabled,
    password: editing ? "" : genPassword(), default_app: user?.default_app || "",
    apps: Object.fromEntries((user?.apps || []).map((a) => [a.slug, a.role])),
  }));
  const [err, setErr] = useState(""), [busy, setBusy] = useState(false), [shown, setShown] = useState(!editing);
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const toggleApp = (slug, on) => setF((x) => { const a = { ...x.apps }; if (on) a[slug] = a[slug] || "member"; else delete a[slug]; return { ...x, apps: a, default_app: on ? x.default_app : x.default_app === slug ? "" : x.default_app }; });
  const self = user?.id === me.id;

  async function save(e) {
    e.preventDefault(); setErr(""); setBusy(true);
    const appList = Object.entries(f.apps).map(([slug, role]) => ({ slug, role }));
    try {
      if (editing) await api(`/api/admin/users/${user.id}`, "PATCH", { name: f.name, role: f.role, disabled: f.disabled, default_app: f.default_app || null, apps: appList, ...(f.password ? { password: f.password } : {}) });
      else await api("/api/admin/users", "POST", { email: f.email, name: f.name, role: f.role, password: f.password, default_app: f.default_app || null, apps: appList });
      onDone();
    } catch (e2) { setErr(e2.message); setBusy(false); }
  }
  async function revoke() { if (confirm(`Sign ${user.email} out of every device?`)) { try { await api(`/api/admin/users/${user.id}`, "PATCH", { revokeSessions: true }); onDone(); } catch (e) { setErr(e.message); } } }
  async function remove() { if (confirm(`Delete ${user.email} permanently? This can't be undone.`)) { try { await api(`/api/admin/users/${user.id}`, "DELETE"); onDone(); } catch (e) { setErr(e.message); } } }

  return (
    <Modal title={editing ? `Edit ${user.name}` : "New user"} onClose={onClose} wide>
      <form onSubmit={save} className="form">
        <div className="grid2">
          <label>Email<input type="email" required disabled={editing} value={f.email} onChange={(e) => set("email", e.target.value)} /></label>
          <label>Name<input required value={f.name} onChange={(e) => set("name", e.target.value)} /></label>
        </div>
        <div className="grid2">
          <label>Hub role <em>admins manage users and apps</em>
            <select value={f.role} onChange={(e) => set("role", e.target.value)} disabled={self}><option value="user">User</option><option value="admin">Admin</option></select></label>
          <label>{editing ? "Reset password" : "Password"} <em>{editing ? "leave empty to keep" : "min 10 characters"}</em>
            <div className="pw"><input type={shown ? "text" : "password"} value={f.password} onChange={(e) => set("password", e.target.value)} minLength={f.password ? 10 : undefined} required={!editing} autoComplete="new-password" />
              <button type="button" className="link" onClick={() => setShown(!shown)}>{shown ? "Hide" : "Show"}</button>
              <button type="button" className="link" onClick={() => { set("password", genPassword()); setShown(true); }}>Generate</button></div></label>
        </div>

        <div className="field"><span className="lbl">Apps this user can open</span>
          <div className="appsel">
            {apps.map((a) => {
              const on = f.apps[a.slug] !== undefined;
              return (
                <div key={a.slug} className={"aprow" + (on ? " on" : "")}>
                  <label className="chk"><input type="checkbox" checked={on} onChange={(e) => toggleApp(a.slug, e.target.checked)} /><span className="appicon sm">{a.icon}</span><b>{a.name}</b><small>{a.slug}</small></label>
                  {on && <select value={f.apps[a.slug]} onChange={(e) => setF((x) => ({ ...x, apps: { ...x.apps, [a.slug]: e.target.value } }))}><option value="member">member</option><option value="admin">app admin</option></select>}
                </div>
              );
            })}
          </div>
        </div>
        <label>Default app <em>where this user lands after login when they have several</em>
          <select value={f.default_app} onChange={(e) => set("default_app", e.target.value)}>
            <option value="">Show the launcher</option>
            {apps.filter((a) => f.apps[a.slug] !== undefined).map((a) => <option key={a.slug} value={a.slug}>{a.name}</option>)}
          </select></label>
        {editing && <label className="chk"><input type="checkbox" checked={f.disabled} disabled={self} onChange={(e) => set("disabled", e.target.checked)} /> Disable this account <em>blocks sign-in and signs them out</em></label>}
        {err && <div className="alert">{err}</div>}
        <div className="mfoot">
          {editing && !self && <><button type="button" className="btn danger" onClick={remove}>Delete</button><button type="button" className="btn" onClick={revoke}>Sign out everywhere</button></>}
          <span className="sp" />
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button className="btn go" disabled={busy}>{busy ? "Saving…" : editing ? "Save changes" : "Create user"}</button>
        </div>
      </form>
    </Modal>
  );
}

function UsersTab({ me, apps, reload, users, setModal }) {
  const [q, setQ] = useState("");
  const shown = users.filter((u) => !q || (u.email + u.name).toLowerCase().includes(q.toLowerCase()));
  const bySlug = Object.fromEntries(apps.map((a) => [a.slug, a]));
  return (
    <>
      <div className="bar"><input className="search" placeholder="Search users…" value={q} onChange={(e) => setQ(e.target.value)} /><button className="btn go" onClick={() => setModal({ type: "user" })}>+ New user</button></div>
      <div className="card tight scroll">
        <table className="tbl">
          <thead><tr><th>User</th><th>Role</th><th>Apps</th><th>Last sign-in</th><th>Status</th><th></th></tr></thead>
          <tbody>
            {shown.map((u) => (
              <tr key={u.id}>
                <td><b>{u.name}</b>{u.id === me.id && <span className="pill">you</span>}<small>{u.email}</small></td>
                <td><span className={"pill " + (u.role === "admin" ? "amber" : "")}>{u.role}</span></td>
                <td>{u.apps.length ? u.apps.map((a) => <span key={a.slug} className={"pill " + (u.default_app === a.slug ? "teal" : "")} title={`${a.role}${u.default_app === a.slug ? " · default" : ""}`}>{bySlug[a.slug]?.icon} {a.slug}{a.role === "admin" ? " ★" : ""}</span>) : <em className="muted">none</em>}</td>
                <td>{ago(u.last_login_at)}</td>
                <td>{u.disabled ? <span className="pill bad">disabled</span> : <span className="pill good">active</span>}</td>
                <td className="acts"><button className="btn sm" onClick={() => setModal({ type: "user", user: u })}>Edit</button></td>
              </tr>
            ))}
            {!shown.length && <tr><td colSpan={6} className="muted center">No users match.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}

// ---------------- apps ----------------
function AppForm({ app, onDone, onClose }) {
  const editing = !!app;
  const [f, setF] = useState({ slug: app?.slug || "", name: app?.name || "", url: app?.url || "", description: app?.description || "", icon: app?.icon || "◆" });
  const [err, setErr] = useState(""), [busy, setBusy] = useState(false);
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  async function save(e) {
    e.preventDefault(); setErr(""); setBusy(true);
    try { editing ? await api(`/api/admin/apps/${app.slug}`, "PATCH", f) : await api("/api/admin/apps", "POST", f); onDone(); } catch (e2) { setErr(e2.message); setBusy(false); }
  }
  async function remove() { if (confirm(`Remove ${app.name}? Every user loses access to it.`)) { try { await api(`/api/admin/apps/${app.slug}`, "DELETE"); onDone(); } catch (e) { setErr(e.message); } } }
  return (
    <Modal title={editing ? `Edit ${app.name}` : "Register an app"} onClose={onClose}>
      <form onSubmit={save} className="form">
        <div className="grid2">
          <label>Name<input required value={f.name} onChange={(e) => set("name", e.target.value)} placeholder="Billing portal" /></label>
          <label>Slug <em>used inside tokens</em><input required disabled={editing} value={f.slug} onChange={(e) => set("slug", e.target.value.toLowerCase())} placeholder="billing" pattern="[a-z0-9][a-z0-9\-]{1,30}" /></label>
        </div>
        <label>URL <em>where users are sent</em><input required value={f.url} onChange={(e) => set("url", e.target.value)} placeholder="http://localhost:5000" /></label>
        <div className="grid2">
          <label>Description<input value={f.description} onChange={(e) => set("description", e.target.value)} /></label>
          <label>Icon <em>one emoji or symbol</em><input value={f.icon} maxLength={4} onChange={(e) => set("icon", e.target.value)} /></label>
        </div>
        {err && <div className="alert">{err}</div>}
        <div className="mfoot">
          {editing && <button type="button" className="btn danger" onClick={remove}>Remove</button>}<span className="sp" />
          <button type="button" className="btn" onClick={onClose}>Cancel</button><button className="btn go" disabled={busy}>{busy ? "Saving…" : editing ? "Save" : "Register app"}</button>
        </div>
      </form>
    </Modal>
  );
}

function AppsTab({ apps, setModal }) {
  return (
    <>
      <div className="bar"><p className="muted">Apps registered here can receive signed-in users. A token is only accepted by an app whose slug it lists.</p><button className="btn go" onClick={() => setModal({ type: "app" })}>+ Register app</button></div>
      <div className="apps">
        {apps.map((a) => (
          <div key={a.slug} className="app card">
            <span className="appicon">{a.icon}</span>
            <div><b>{a.name}</b><p>{a.description || "No description"}</p><small>{a.url} · slug <code>{a.slug}</code> · {a.users} user{a.users === 1 ? "" : "s"}</small></div>
            <button className="btn sm" onClick={() => setModal({ type: "app", app: a })}>Edit</button>
          </div>
        ))}
      </div>
    </>
  );
}

// ---------------- audit ----------------
function AuditTab() {
  const [rows, setRows] = useState([]), [stats, setStats] = useState(null), [failed, setFailed] = useState(false), [q, setQ] = useState(""), [err, setErr] = useState("");
  const load = useCallback(() => api(`/api/admin/audit?limit=200${failed ? "&failed=1" : ""}${q ? "&q=" + encodeURIComponent(q) : ""}`).then((d) => { setRows(d.events); setStats(d.stats); setErr(""); }).catch((e) => setErr(e.message)), [failed, q]);
  useEffect(() => { const t = setTimeout(load, 200); return () => clearTimeout(t); }, [load]);
  return (
    <>
      {stats && <div className="kpis"><div className="kpi"><span>Sign-ins (24 h)</span><b>{stats.logins_ok}</b></div><div className="kpi"><span>Failed sign-ins (24 h)</span><b className={stats.logins_failed ? "red" : ""}>{stats.logins_failed}</b></div><div className="kpi"><span>Active sessions</span><b>{stats.active_sessions}</b></div></div>}
      <div className="bar"><input className="search" placeholder="Filter by email, event or app…" value={q} onChange={(e) => setQ(e.target.value)} />
        <label className="chk"><input type="checkbox" checked={failed} onChange={(e) => setFailed(e.target.checked)} /> Failures only</label><button className="btn" onClick={load}>↻ Refresh</button></div>
      {err && <div className="alert">{err}</div>}
      <div className="card tight scroll">
        <table className="tbl">
          <thead><tr><th>When</th><th>Event</th><th>Who</th><th>App</th><th>Detail</th><th>IP</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}><td title={new Date(r.at).toLocaleString()}>{ago(r.at)}</td>
                <td><span className={"pill " + (r.success ? "good" : "bad")}>{r.event}</span></td>
                <td>{r.email || <em className="muted">n/a</em>}</td><td>{r.app || ""}</td><td className="detail">{r.detail || ""}</td><td className="muted">{r.ip}</td></tr>
            ))}
            {!rows.length && <tr><td colSpan={6} className="muted center">No events.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}

// ---------------- console ----------------
export default function AdminConsole({ me }) {
  const [tab, setTab] = useState("users");
  const [users, setUsers] = useState([]), [apps, setApps] = useState([]), [err, setErr] = useState(""), [modal, setModal] = useState(null);
  const reload = useCallback(async () => {
    try { const [u, a] = await Promise.all([api("/api/admin/users"), api("/api/admin/apps")]); setUsers(u.users); setApps(a.apps); setErr(""); } catch (e) { setErr(e.message); }
  }, []);
  useEffect(() => { reload(); }, [reload]);
  const done = () => { setModal(null); reload(); };
  return (
    <>
      <h1>Admin console</h1>
      <div className="kpis">
        <div className="kpi"><span>Users</span><b>{users.length}</b></div>
        <div className="kpi"><span>Apps</span><b>{apps.length}</b></div>
        <div className="kpi"><span>Admins</span><b>{users.filter((u) => u.role === "admin").length}</b></div>
        <div className="kpi"><span>Disabled</span><b>{users.filter((u) => u.disabled).length}</b></div>
      </div>
      <div className="tabs">{[["users", "Users & access"], ["apps", "Apps"], ["audit", "Audit log"]].map(([k, l]) => <button key={k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>{l}</button>)}</div>
      {err && <div className="alert">{err}</div>}
      {tab === "users" && <UsersTab me={me} apps={apps} users={users} reload={reload} setModal={setModal} />}
      {tab === "apps" && <AppsTab apps={apps} setModal={setModal} />}
      {tab === "audit" && <AuditTab />}
      {modal?.type === "user" && <UserForm user={modal.user} apps={apps} me={me} onDone={done} onClose={() => setModal(null)} />}
      {modal?.type === "app" && <AppForm app={modal.app} onDone={done} onClose={() => setModal(null)} />}
    </>
  );
}
