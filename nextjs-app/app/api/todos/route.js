import { observe } from "@/lib/observe";
import { todoOps } from "@/lib/metrics";
import { track } from "@/lib/analytics";
import { listTodos, createTodo, validate } from "@/lib/todos";

// READ (list, with pagination + optional ?done=true|false)
export const GET = observe("/api/todos", async (request) => {
  const q = request.nextUrl.searchParams;
  const limit = Math.min(Math.max(parseInt(q.get("limit")) || 20, 1), 100);
  const offset = Math.max(parseInt(q.get("offset")) || 0, 0);
  const done = q.has("done") ? q.get("done") === "true" : null;
  const result = await listTodos({ limit, offset, done });
  todoOps.inc({ op: "list" });
  return Response.json(result);
});

// CREATE
export const POST = observe("/api/todos", async (request, _ctx, { userId }) => {
  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const { value, error } = validate(body, { requireTitle: true });
  if (error) return Response.json({ error }, { status: 400 });
  const todo = await createTodo(value, userId);
  todoOps.inc({ op: "create" });
  track(userId, "todo_created", { todo_id: todo.id });
  return Response.json(todo, { status: 201 });
});
