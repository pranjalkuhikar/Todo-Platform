import { listTodos } from "@/lib/todos";
import { headers } from "next/headers";
import TodoApp from "@/components/TodoApp";
import Header from "@/components/Header";

// Server Component: reads Postgres directly on every request
export const dynamic = "force-dynamic";

export default async function Home() {
  const { data } = await listTodos({ limit: 100 });
  const h = await headers();
  // set by proxy.js after it verified the sign-in token (only meaningful when AUTH_REQUIRED=true)
  const user = { email: h.get("x-user-email"), name: h.get("x-user-name"), role: h.get("x-user-role"), hubAdmin: h.get("x-hub-role") === "admin" };
  return (
    <>
      <Header user={user} />
      <main>
        <h1>Your todos</h1>
        <p className="sub">Next.js server components read Postgres directly; the buttons below call the REST API.</p>
        <TodoApp initial={data} />
        <p className="foot">Next.js + Postgres · JSON API at <a href="/api/todos">/api/todos</a></p>
      </main>
    </>
  );
}
