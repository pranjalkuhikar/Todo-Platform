import { observe } from "@/lib/observe";
import { todoOps } from "@/lib/metrics";
import { track } from "@/lib/analytics";
import { getTodo, updateTodo, deleteTodo, validate, parseId } from "@/lib/todos";

const ROUTE = "/api/todos/[id]";
const badId = () => Response.json({ error: "id must be a positive integer" }, { status: 400 });
const notFound = () => Response.json({ error: "Not found" }, { status: 404 });

// READ (one)
export const GET = observe(ROUTE, async (_req, { params }) => {
  const id = parseId((await params).id);
  if (id === null) return badId();
  const todo = await getTodo(id);
  if (!todo) return notFound();
  todoOps.inc({ op: "get" });
  return Response.json(todo);
});

// UPDATE (partial: send only the fields you want to change)
const update = observe(ROUTE, async (request, { params }, { userId }) => {
  const id = parseId((await params).id);
  if (id === null) return badId();
  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const { value, error } = validate(body, { requireTitle: false });
  if (error) return Response.json({ error }, { status: 400 });
  const todo = await updateTodo(id, value);
  if (!todo) return notFound();
  todoOps.inc({ op: "update" });
  track(userId, "todo_updated", { todo_id: id });
  return Response.json(todo);
});
export const PUT = update;
export const PATCH = update;

// DELETE
export const DELETE = observe(ROUTE, async (_req, { params }, { userId }) => {
  const id = parseId((await params).id);
  if (id === null) return badId();
  if (!(await deleteTodo(id))) return notFound();
  todoOps.inc({ op: "delete" });
  track(userId, "todo_deleted", { todo_id: id });
  return new Response(null, { status: 204 });
});
