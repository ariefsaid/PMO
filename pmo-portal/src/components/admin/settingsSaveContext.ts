import { createContext, useContext, useEffect, useId } from 'react';

export interface SaveEntry {
  dirty: boolean;
  invalid?: boolean;
  busy?: boolean;
  save: () => Promise<unknown>;
}

export interface SettingsSaveContextValue {
  entries: Map<string, SaveEntry>;
  register: (id: string, entry: SaveEntry | null) => void;
  saving: boolean;
  error: boolean;
  saveAll: () => Promise<void>;
}

export const SettingsSaveContext = createContext<SettingsSaveContextValue | null>(null);

/** Registers the existing mutation for the page Save; editing never writes. */
export function useSettingsSaveEntry(entry: SaveEntry | null): boolean {
  const context = useContext(SettingsSaveContext);
  const id = useId();
  const register = context?.register;
  useEffect(() => { register?.(id, entry); });
  useEffect(() => () => register?.(id, null), [register, id]);
  return context !== null;
}

export function useSettingsSaveDirty(): boolean {
  const context = useContext(SettingsSaveContext);
  return context ? [...context.entries.values()].some((entry) => entry.dirty) : false;
}
