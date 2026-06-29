import React, { createContext, useContext, useEffect, useRef, useState, useCallback } from "react";
import { api, getToken, setToken, wsUrl } from "./api";

type User = {
  id: string;
  phone: string;
  name?: string;
  avatar?: string | null;
  about?: string;
  online?: boolean;
};

type Listener = (msg: any) => void;

type Ctx = {
  user: User | null;
  loading: boolean;
  setUser: (u: User | null) => void;
  applySession: (token: string, user: User) => Promise<void>;
  signOut: () => Promise<void>;
  ws: WebSocket | null;
  subscribe: (fn: Listener) => () => void;
  send: (data: any) => void;
};

const AuthCtx = createContext<Lateinit<Ctx>>(null as any);
type Lateinit<T> = T;

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const wsRef = useRef<WebSocket | null>(null);
  const listeners = useRef<Set<Listener>>(new Set());

  const connectWS = useCallback(async () => {
    const t = await getToken();
    if (!t) return;
    try {
      if (wsRef.current && wsRef.current.readyState <= 1) return;
      const ws = new WebSocket(wsUrl(t));
      wsRef.current = ws;
      ws.onmessage = (e) => {
        try {
          const data = JSON.parse(e.data);
          listeners.current.forEach((l) => l(data));
        } catch {}
      };
      ws.onclose = () => {
        wsRef.current = null;
        setTimeout(connectWS, 2000);
      };
      ws.onerror = () => {};
    } catch {}
  }, []);

  useEffect(() => {
    (async () => {
      const t = await getToken();
      if (t) {
        try {
          const me = await api<User>("/auth/me");
          setUser(me);
          connectWS();
          // Best-effort: ensure this device has a published E2EE key
          import("./crypto").then((m) => m.ensureKeyPublished().catch(() => {}));
        } catch {
          await setToken(null);
        }
      }
      setLoading(false);
    })();
  }, [connectWS]);

  useEffect(() => {
    if (user) connectWS();
  }, [user, connectWS]);

  const signOut = async () => {
    await setToken(null);
    setUser(null);
    if (wsRef.current) wsRef.current.close();
    import("./crypto").then((m) => m.clearKeyPair().catch(() => {}));
  };

  const applySession = async (token: string, u: User) => {
    await setToken(token);
    setUser(u);
    connectWS();
    import("./crypto").then((m) => m.ensureKeyPublished().catch(() => {}));
  };

  const subscribe = (fn: Listener) => {
    listeners.current.add(fn);
    return () => listeners.current.delete(fn) as any;
  };

  const send = (data: any) => {
    if (wsRef.current && wsRef.current.readyState === 1) {
      wsRef.current.send(JSON.stringify(data));
    }
  };

  return (
    <AuthCtx.Provider value={{ user, loading, setUser, applySession, signOut, ws: wsRef.current, subscribe, send }}>
      {children}
    </AuthCtx.Provider>
  );
};

export const useAuth = () => useContext(AuthCtx);
