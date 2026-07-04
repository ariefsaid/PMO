import { useCallback, useEffect, useState } from 'react';

/**
 * useTheme — F2 dark-mode toggle.
 *
 * The `<html>` element's `dark` class is the SINGLE SOURCE OF TRUTH the CSS
 * `.dark` block reads and the no-flash script seeds (`index.html`); the
 * `localStorage` "theme" key is the persistence layer that survives reloads.
 *
 * Contract (see useTheme.test.ts):
 * - `theme` initial = DOM truth (the class is already there or it isn't).
 * - `setTheme(t)` flips the class FIRST, then persists (best-effort, never
 *   throws — Safari private-mode where setItem throws still gets the flip).
 * - `toggle` = setTheme of the opposite of the current DOM truth.
 *
 * No `'system'` tri-state, no provider/context — the DOM class + storage key
 * ARE the shared state, so every consumer reading the class stays in sync.
 */
export type Theme = 'light' | 'dark';

export const THEME_STORAGE_KEY = 'theme';
export const THEME_CHANGE_EVENT = 'themechange';

/** Read the authoritative current theme straight off the documentElement class. */
function readDomTheme(): Theme {
  return document.documentElement.classList.contains('dark') ? 'dark' : 'light';
}

export interface UseThemeResult {
  theme: Theme;
  toggle: () => void;
  setTheme: (t: Theme) => void;
}

export function useTheme(): UseThemeResult {
  const [theme, setThemeState] = useState<Theme>(readDomTheme);

  useEffect(() => {
    const syncTheme = () => setThemeState(readDomTheme());

    window.addEventListener('storage', syncTheme);
    window.addEventListener(THEME_CHANGE_EVENT, syncTheme);

    return () => {
      window.removeEventListener('storage', syncTheme);
      window.removeEventListener(THEME_CHANGE_EVENT, syncTheme);
    };
  }, []);

  const setTheme = useCallback((next: Theme) => {
    // 1) DOM truth FIRST — flip the class before touching storage so the
    //    visible state changes even when localStorage.setItem throws.
    const root = document.documentElement;
    if (next === 'dark') root.classList.add('dark');
    else root.classList.remove('dark');
    // 2) Persist (best-effort; the class is the source of truth).
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      /* private mode / quota exhausted — ignore; the class already applied. */
    }
    // 3) Keep same-tab consumers in sync with the DOM source of truth.
    setThemeState(next);
    window.dispatchEvent(new Event(THEME_CHANGE_EVENT));
  }, []);

  const toggle = useCallback(() => {
    setTheme(readDomTheme() === 'dark' ? 'light' : 'dark');
  }, [setTheme]);

  return { theme, toggle, setTheme };
}
