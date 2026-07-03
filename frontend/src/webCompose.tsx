/**
 * WebCompose context — global state that lets any /web screen open the
 * floating Gmail-style compose panel with optional prefill (to, subject, body).
 *
 * The panel itself lives in /web/_layout so it renders on top of every screen.
 */
import React, { createContext, useCallback, useContext, useMemo, useState } from "react";

export type ComposePrefill = {
  to?: string;
  subject?: string;
  body?: string;
  inReplyTo?: string;
  threadId?: string;
  draftId?: string;
};

type Ctx = {
  open: boolean;
  prefill: ComposePrefill;
  openCompose: (prefill?: ComposePrefill) => void;
  closeCompose: () => void;
};

const WebComposeContext = createContext<Ctx | null>(null);

export function WebComposeProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [prefill, setPrefill] = useState<ComposePrefill>({});

  const openCompose = useCallback((p?: ComposePrefill) => {
    setPrefill(p || {});
    setOpen(true);
  }, []);

  const closeCompose = useCallback(() => {
    setOpen(false);
    setPrefill({});
  }, []);

  const value = useMemo(
    () => ({ open, prefill, openCompose, closeCompose }),
    [open, prefill, openCompose, closeCompose]
  );

  return <WebComposeContext.Provider value={value}>{children}</WebComposeContext.Provider>;
}

export function useWebCompose(): Ctx {
  const ctx = useContext(WebComposeContext);
  if (!ctx) {
    // Callers on native / mobile should still not crash — return a no-op.
    return {
      open: false,
      prefill: {},
      openCompose: () => {},
      closeCompose: () => {},
    };
  }
  return ctx;
}
