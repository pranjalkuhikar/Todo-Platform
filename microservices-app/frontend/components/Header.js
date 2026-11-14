"use client";
import Link from "next/link";
import { useAuth } from "./AuthProvider";

export default function Header() {
  const { user, hubUrl, logout } = useAuth();
  return (
    <header className="header">
      <div className="header-inner">
        <Link href="/" className="brand">
          <span className="brand-dot" /> TaskGate
        </Link>
        {user && (
          <nav className="nav">
            <div className="avatar" aria-hidden>{(user.name || user.email || "?").trim().charAt(0).toUpperCase()}</div>
            <span className="who" title={user.email}>
              {user.name || user.email}
              {user.role === "admin" && <span className="badge">admin</span>}
            </span>
            {hubUrl && <a className="btn btn-ghost" href={hubUrl}>All my apps</a>}
            <button className="btn btn-ghost" onClick={logout}>Sign out</button>
          </nav>
        )}
      </div>
    </header>
  );
}
