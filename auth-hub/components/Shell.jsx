// Top bar for signed-in pages (server component).
export default function Shell({ user, active, children }) {
  const initials = (user.name || user.email).split(/\s+/).map((w) => w.match(/[A-Za-z0-9]/)?.[0]).filter(Boolean).slice(0, 2).join("").toUpperCase();
  return (
    <div className="shell">
      <header className="top">
        <a className="brand" href="/"><span className="logo">🔐</span><div><b>AuthHub</b><small>one login for all your apps</small></div></a>
        <nav>
          {user.role === "admin" && <a className={active === "apps" ? "on" : ""} href="/">My apps</a>}
          {user.role === "admin" && <a className={active === "admin" ? "on" : ""} href="/admin">Admin</a>}
          <a className={active === "account" ? "on" : ""} href="/account">Account</a>
        </nav>
        <div className="me">
          <span className="avatar" title={user.email}>{initials}</span>
          <div className="who"><b>{user.name}</b><small>{user.email}{user.role === "admin" ? " · admin" : ""}</small></div>
          <a className="btn sm" href="/sso/logout">Sign out</a>
        </div>
      </header>
      <main className="page">{children}</main>
    </div>
  );
}
