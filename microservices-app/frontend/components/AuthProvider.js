"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";

// Sign-in is handled entirely by the central AuthHub. This only asks the gateway "who am I?" and handles sign-out.
const AuthContext = createContext(null);
export const useAuth = () => useContext(AuthContext);

export default function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [hubUrl, setHubUrl] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api("/api/auth/me")
      .then((d) => { setUser(d.user); setHubUrl(d.hub_url || ""); })
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);

  const logout = useCallback(async () => {
    const r = await api("/api/auth/logout", { method: "POST" }).catch(() => null);
    // (Do not clear the user here: that would trigger the "no user, go to /" redirect and race with the one below.)
    // The session must be ended at AuthHub too, otherwise it would silently sign the user straight back in.
    window.location.assign(r?.redirect || "/");
  }, []);

  const value = useMemo(() => ({ user, hubUrl, loading, logout }), [user, hubUrl, loading, logout]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
