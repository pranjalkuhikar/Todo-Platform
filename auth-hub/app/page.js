import { redirect } from "next/navigation";
import Shell from "@/components/Shell";
import { requireUser } from "@/lib/page-auth";

export const dynamic = "force-dynamic";

// The launcher (every app as a card) is for ADMINISTRATORS only.
// Everyone else goes straight to their app: their default app if they have one, otherwise the first app they can open.
// (A person with no apps at all stays here and sees "no apps assigned yet".)
export default async function Home() {
  const { user, access } = await requireUser("/");
  if (user.role !== "admin" && access.list.length > 0) {
    const target = access.list.find((a) => a.slug === user.default_app) || access.list[0];
    // via /sso/authorize so the app gets a fresh access token in the same hop
    redirect(`/sso/authorize?app=${encodeURIComponent(target.slug)}&return=${encodeURIComponent(target.url)}`);
  }
  const first = user.name.split(" ")[0];
  return (
    <Shell user={user} active="apps">
      <h1>Welcome back, {first} 👋</h1>
      <p className="lead">{access.list.length ? "Pick an app to continue. You stay signed in across all of them." : "You're signed in, but no apps have been assigned to you yet."}</p>
      {access.list.length === 0 ? (
        <div className="card empty"><h3>No apps assigned yet</h3><p>Ask an administrator to give you access. Once they do, your apps will show up here and sign-in will take you straight to them.</p></div>
      ) : (
        <div className="apps">
          {access.list.map((a) => (
            <a key={a.slug} className="app card" href={a.url}>
              <span className="appicon">{a.icon}</span>
              <div>
                <b>{a.name}{user.default_app === a.slug && <span className="pill teal">default</span>}</b>
                <p>{a.description || a.url}</p>
                <small>{a.url.replace(/^https?:\/\//, "")} · your role: <em>{a.app_role}</em></small>
              </div>
              <span className="go">Open →</span>
            </a>
          ))}
        </div>
      )}
    </Shell>
  );
}
