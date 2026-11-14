"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { useRequireAuth } from "@/components/useRequireAuth";

const PAGE_SIZE = 10;
const FILTERS = [
  { key: "all", label: "All" },
  { key: "active", label: "Active" },
  { key: "done", label: "Done" },
];

export default function TodosPage() {
  const { user, loading: authLoading } = useRequireAuth();

  const [todos, setTodos] = useState([]);
  const [total, setTotal] = useState(0);
  const [stats, setStats] = useState({ all: 0, done: 0 });
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState(""); // debounced search
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [adding, setAdding] = useState(false);

  const [editingId, setEditingId] = useState(null);
  const [draft, setDraft] = useState({ title: "", description: "" });

  const reqId = useRef(0);

  // an expired session (or no access) => reload "/": the gateway sends the browser to AuthHub, which renews or explains
  const handleError = useCallback(
    async (err) => {
      if (err.status === 401 || err.status === 403) {
        window.location.assign("/");
        return;
      }
      setError(err.message);
    },
    []
  );

  const load = useCallback(async () => {
    const id = ++reqId.current;
    const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(offset) });
    if (filter === "active") params.set("done", "false");
    if (filter === "done") params.set("done", "true");
    if (query) params.set("q", query);
    try {
      const d = await api(`/api/todos?${params}`);
      if (id !== reqId.current) return; // a newer request superseded this one
      setTodos(d.data);
      setTotal(d.total);
      setStats(d.stats);
      setError("");
    } catch (err) {
      if (id === reqId.current) await handleError(err);
    } finally {
      if (id === reqId.current) setLoading(false);
    }
  }, [offset, filter, query, handleError]);

  useEffect(() => {
    if (user) load();
  }, [user, load]);

  useEffect(() => {
    const t = setTimeout(() => {
      setQuery(search.trim());
      setOffset(0);
    }, 300);
    return () => clearTimeout(t);
  }, [search]);

  async function add(e) {
    e.preventDefault();
    if (!title.trim()) return;
    setAdding(true);
    try {
      await api("/api/todos", { method: "POST", body: { title, description: description || undefined } });
      setTitle("");
      setDescription("");
      setOffset(0);
      await load();
    } catch (err) {
      await handleError(err);
    } finally {
      setAdding(false);
    }
  }

  async function toggle(todo) {
    // optimistic update, rolled back by reload if the call fails
    setTodos((list) => list.map((t) => (t.id === todo.id ? { ...t, done: !t.done } : t)));
    try {
      await api(`/api/todos/${todo.id}`, { method: "PATCH", body: { done: !todo.done } });
      await load();
    } catch (err) {
      await handleError(err);
      load();
    }
  }

  async function saveEdit(todo) {
    try {
      await api(`/api/todos/${todo.id}`, { method: "PATCH", body: { title: draft.title, description: draft.description } });
      setEditingId(null);
      await load();
    } catch (err) {
      await handleError(err);
    }
  }

  async function remove(todo) {
    if (!confirm(`Delete "${todo.title}"?`)) return;
    try {
      await api(`/api/todos/${todo.id}`, { method: "DELETE" });
      // deleting the last item of a page moves back one page
      if (todos.length === 1 && offset > 0) setOffset(offset - PAGE_SIZE);
      else await load();
    } catch (err) {
      await handleError(err);
    }
  }

  if (authLoading || !user) return <p className="muted">Loading…</p>;

  const pct = stats.all ? Math.round((stats.done / stats.all) * 100) : 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const page = Math.floor(offset / PAGE_SIZE) + 1;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Your todos</h1>
          <p className="muted">
            {stats.done} of {stats.all} done
          </p>
        </div>
        <div className="progress" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Completion">
          <div className="progress-bar" style={{ width: `${pct}%` }} />
        </div>
      </div>

      <form onSubmit={add} className="card add-form">
        <input
          placeholder="What needs doing?"
          value={title}
          maxLength={200}
          onChange={(e) => setTitle(e.target.value)}
          aria-label="Todo title"
        />
        <input
          placeholder="Notes (optional)"
          value={description}
          maxLength={2000}
          onChange={(e) => setDescription(e.target.value)}
          aria-label="Todo notes"
        />
        <button className="btn btn-primary" disabled={adding || !title.trim()}>
          {adding ? "Adding…" : "Add"}
        </button>
      </form>

      <div className="toolbar">
        <div className="tabs" role="tablist">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              role="tab"
              aria-selected={filter === f.key}
              className={filter === f.key ? "tab active" : "tab"}
              onClick={() => {
                setFilter(f.key);
                setOffset(0);
              }}
            >
              {f.label}
            </button>
          ))}
        </div>
        <input
          className="search"
          type="search"
          placeholder="Search…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Search todos"
        />
      </div>

      {error && <p className="error" role="alert">{error}</p>}

      <ul className="list">
        {loading && <li className="empty muted">Loading…</li>}
        {!loading && todos.length === 0 && (
          <li className="empty muted">{query || filter !== "all" ? "Nothing matches." : "No todos yet. Add your first one above."}</li>
        )}
        {todos.map((t) =>
          editingId === t.id ? (
            <li key={t.id} className="item editing">
              <div className="edit-fields">
                <input value={draft.title} maxLength={200} onChange={(e) => setDraft({ ...draft, title: e.target.value })} aria-label="Edit title" autoFocus />
                <input value={draft.description} maxLength={2000} onChange={(e) => setDraft({ ...draft, description: e.target.value })} placeholder="Notes" aria-label="Edit notes" />
              </div>
              <button className="btn btn-primary" disabled={!draft.title.trim()} onClick={() => saveEdit(t)}>Save</button>
              <button className="btn btn-ghost" onClick={() => setEditingId(null)}>Cancel</button>
            </li>
          ) : (
            <li key={t.id} className={t.done ? "item done" : "item"}>
              <input type="checkbox" checked={t.done} onChange={() => toggle(t)} aria-label={`Mark "${t.title}" as ${t.done ? "not done" : "done"}`} />
              <div className="item-text">
                <span className="item-title">{t.title}</span>
                {t.description && <span className="item-desc">{t.description}</span>}
              </div>
              <button
                className="btn btn-ghost"
                onClick={() => {
                  setEditingId(t.id);
                  setDraft({ title: t.title, description: t.description });
                }}
              >
                Edit
              </button>
              <button className="btn btn-danger" onClick={() => remove(t)}>Delete</button>
            </li>
          )
        )}
      </ul>

      {total > PAGE_SIZE && (
        <div className="pager">
          <button className="btn btn-ghost" disabled={offset === 0} onClick={() => setOffset(offset - PAGE_SIZE)}>← Previous</button>
          <span className="muted small">Page {page} of {pages}</span>
          <button className="btn btn-ghost" disabled={offset + PAGE_SIZE >= total} onClick={() => setOffset(offset + PAGE_SIZE)}>Next →</button>
        </div>
      )}
    </>
  );
}
