import { authRequired, hubUrl } from "@/lib/authhub";

// Top bar. Shows who is signed in (identity comes from proxy.js, which verifies the AuthHub token) and a Sign out button.
export default function Header({ user }) {
  const show = authRequired() && user?.email;
  return (
    <header className="top"><div className="in">
      <a className="brand" href="/"><span className="logo">✓</span>Todos <span className="pill">Next.js · Postgres</span></a>
      <nav className="links"><a href="/api/todos">API</a><a href="/api/health">Health</a><a href="/api/metrics">Metrics</a></nav>
      <div className="who">
        {show ? (
          <>
            <div className="avatar">{(user.name || user.email).trim().charAt(0).toUpperCase()}</div>
            <div className="t"><b>{user.name || user.email}</b><span>{user.email} · {user.role}</span></div>
            {user.hubAdmin && <a className="btn sm" href={hubUrl}>All my apps</a>}
            {/* AuthHub ends the session everywhere, then shows its login page */}
            <a className="btn sm out" href={`${hubUrl}/sso/logout`}>Sign out</a>
          </>
        ) : (
          <span className="pill" title="Start with AUTH_REQUIRED=true to require the central login">Sign-in is off (local mode)</span>
        )}
      </div>
    </div></header>
  );
}
