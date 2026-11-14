import Shell from "@/components/Shell";
import { requireUser } from "@/lib/page-auth";

export const dynamic = "force-dynamic";

export default async function Forbidden({ searchParams }) {
  const sp = await searchParams;
  const slug = typeof sp.app === "string" ? sp.app : "this app";
  const { user, access } = await requireUser(`/forbidden?app=${encodeURIComponent(slug)}`);
  return (
    <Shell user={user} active="apps">
      <div className="card empty">
        <h1>🚫 No access to <code>{slug}</code></h1>
        <p>You’re signed in as <b>{user.email}</b>, but that account isn’t allowed to use {slug === "admin" ? "the admin console" : <>the <b>{slug}</b> app</>}. If you need it, ask an administrator to add it to your account.</p>
        <div className="row">
          {access.list.length > 0 && <a className="btn go" href="/">Go to my apps</a>}
          <a className="btn" href="/sso/logout">Sign in as someone else</a>
        </div>
      </div>
    </Shell>
  );
}
