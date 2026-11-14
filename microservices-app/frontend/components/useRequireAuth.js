"use client";
import { useEffect } from "react";
import { useAuth } from "./AuthProvider";

// Pages that need a signed-in user. If there is none, reload "/" : the gateway then sends the browser to AuthHub,
// which signs the user in (or silently renews the session) and brings them back. Real enforcement is on the server.
export function useRequireAuth() {
  const auth = useAuth();
  useEffect(() => {
    if (!auth.loading && !auth.user) window.location.assign("/");
  }, [auth.loading, auth.user]);
  return auth;
}
