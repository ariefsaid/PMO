import { createContext, useContext, useEffect } from 'react';
import type React from 'react';

/** One definition a section gives to the work-order page's one help control (see AreaHelp.tsx). */
export interface AreaHelpEntry { id: string; title: string; body: React.ReactNode }
interface Registry {
  set: (entry: AreaHelpEntry) => void; remove: (id: string) => void;
  /** Notes about hidden figures, said once for the open area however many sections share the reason. */
  setNote: (id: string, text: string) => void; removeNote: (id: string) => void;
}

export const AreaHelpContext = createContext<Registry | null>(null);

/** Registers one definition while the calling section is mounted. Outside the page (a bare render) it does nothing. */
export function useAreaHelp(id: string, title: string, body: string | null) {
  const registry = useContext(AreaHelpContext);
  useEffect(() => {
    if (!registry || !body) return;
    registry.set({ id, title, body });
    return () => registry.remove(id);
  }, [registry, id, title, body]);
}


/**
 * States, once for the area, why figures are not shown (screen rules: unknown is never a sentence in a figure). Sections
 * that hide figures for the same reason register the same id, so the reason reads once. Outside the page it does nothing.
 */
export function useAreaNote(id: string, text: string | null) {
  const registry = useContext(AreaHelpContext);
  useEffect(() => {
    if (!registry || !text) return;
    registry.setNote(id, text);
    return () => registry.removeNote(id);
  }, [registry, id, text]);
}
