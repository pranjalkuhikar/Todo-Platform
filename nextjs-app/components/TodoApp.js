"use client";
import { useMemo, useState } from "react";

const JSON_HEADERS = { "Content-Type": "application/json", "x-user-id": "browser-user" }; // proxy.js replaces x-user-id with the signed-in user

// Client UI for the CRUD API: add, tick, rename, delete, filter. Every click is a real API call (so logs and metrics move).
export default function TodoApp({ initial }) {
  const [todos, setTodos] = useState(initial);
  const [title, setTitle] = useState("");
  const [filter, setFilter] = useState("all");
  const [editing, setEditing] = useState(null); // { id, title }
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const counts = useMemo(() => ({ all: todos.length, done: todos.filter((t) => t.done).length, open: todos.filter((t) => !t.done).length }), [todos]);
  const shown = todos.filter((t) => (filter === "all" ? true : filter === "done" ? t.done : !t.done));

  async function call(url, opts, onOk) {
    setError("");
    try {
      const res = await fetch(url, { ...opts, headers: JSON_HEADERS });
      if (res.status === 401 || res.status === 403) { setError("Your session ended. Reload the page to sign in again."); return; }
      if (!res.ok) { const j = await res.json().catch(() => ({})); setError(j.error || `Something went wrong (${res.status})`); return; }
      await onOk(res);
    } catch { setError("Could not reach the server."); }
  }
  async function add(e) {
    e.preventDefault();
    setBusy(true);
    await call("/api/todos", { method: "POST", body: JSON.stringify({ title }) }, async (res) => { setTodos([await res.json(), ...todos]); setTitle(""); });
    setBusy(false);
  }
  const toggle = (t) => call(`/api/todos/${t.id}`, { method: "PUT", body: JSON.stringify({ done: !t.done }) }, () => setTodos(todos.map((x) => (x.id === t.id ? { ...x, done: !t.done } : x))));
  const remove = (t) => confirm("Delete this todo?") && call(`/api/todos/${t.id}`, { method: "DELETE" }, () => setTodos(todos.filter((x) => x.id !== t.id)));
  const save = (e) => {
    e.preventDefault();
    const { id, title: next } = editing;
    return call(`/api/todos/${id}`, { method: "PUT", body: JSON.stringify({ title: next }) }, async (res) => { const u = await res.json(); setTodos(todos.map((x) => (x.id === id ? u : x))); setEditing(null); });
  };

  return (
    <>
      {error && <div className="flash" onClick={() => setError("")}>{error}</div>}
      <div className="stats">
        <div className="stat"><b>{counts.all}</b><span>total</span></div>
        <div className="stat"><b>{counts.open}</b><span>to do</span></div>
        <div className="stat"><b>{counts.done}</b><span>done</span></div>
      </div>
      <form className="card add" onSubmit={add}>
        <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="What needs doing?" maxLength={200} autoFocus />
        <button className="btn primary" disabled={busy || !title.trim()}>Add todo</button>
      </form>
      <div className="tabs">
        {[["all", "All"], ["open", "To do"], ["done", "Done"]].map(([k, l]) => <button key={k} className={filter === k ? "on" : ""} onClick={() => setFilter(k)}>{l}</button>)}
      </div>
      <div className="card">
        {!shown.length ? (
          <div className="empty"><b>Nothing here</b>{filter === "done" ? "Finish something and it shows up here." : "Add your first todo above."}</div>
        ) : (
          <ul className="list">
            {shown.map((t) => (
              <li key={t.id} className={`item ${t.done ? "done" : ""}`}>
                <button className="check" onClick={() => toggle(t)} title={t.done ? "Mark as to do" : "Mark as done"}>{t.done ? "✓" : ""}</button>
                {editing?.id === t.id ? (
                  <form className="editrow" onSubmit={save}>
                    <input type="text" value={editing.title} onChange={(e) => setEditing({ id: t.id, title: e.target.value })} maxLength={200} autoFocus />
                    <button className="btn sm primary" disabled={!editing.title.trim()}>Save</button>
                    <button type="button" className="btn sm" onClick={() => setEditing(null)}>Cancel</button>
                  </form>
                ) : (
                  <>
                    <div className="title">{t.title}<div className="meta">#{t.id} · {new Date(t.created_at).toLocaleString("en-GB")}</div></div>
                    <div className="row-actions">
                      <button className="btn sm" onClick={() => setEditing({ id: t.id, title: t.title })}>Rename</button>
                      <button className="btn sm out" onClick={() => remove(t)}>Delete</button>
                    </div>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}
