import LoginForm from "@/components/LoginForm";
import { listApps, appForUrl } from "@/lib/redirects";

export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }) {
  const sp = await searchParams;
  const apps = await listApps();
  const returnTo = typeof sp.return === "string" ? sp.return : "";
  const slug = typeof sp.app === "string" ? sp.app : "";
  const target = apps.find((a) => a.slug === slug) || (returnTo ? appForUrl(apps, returnTo) : null);
  return (
    <div className="login-wrap">
      <aside className="login-brand">
        <span className="logo big">🔐</span>
        <h1>One login.<br />Every app.</h1>
        <p>Sign in once and AuthHub takes you straight to the apps you’re allowed to use, with no extra passwords and nothing shared between apps.</p>
        <ul>
          <li>✓ Signed tokens apps verify on their own</li>
          <li>✓ Access controlled per user and per app</li>
          <li>✓ Every sign-in is audited</li>
        </ul>
      </aside>
      <section className="login-card card">
        <h2>Sign in</h2>
        <p className="muted">{target ? <>to continue to <b>{target.icon} {target.name}</b></> : "to continue to your apps"}</p>
        <LoginForm returnTo={returnTo} app={slug} />
      </section>
    </div>
  );
}
