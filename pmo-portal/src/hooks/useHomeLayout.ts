import { useCallback, useEffect, useState } from 'react';

export type HomeLayout = 'overview' | 'focused';
const KEY = 'home-layout';
const EVENT = 'homelayoutchange';

/** Per device, like text size. Invalid stored values use the caller's default. */
export function readHomeLayout(defaultLayout: HomeLayout = 'overview'): HomeLayout {
  try {
    const stored = localStorage.getItem(KEY);
    return stored === 'overview' || stored === 'focused' ? stored : defaultLayout;
  } catch { return defaultLayout; }
}

export function useHomeLayout(defaultLayout: HomeLayout = 'overview') {
  const [homeLayout, setState] = useState<HomeLayout>(() => readHomeLayout(defaultLayout));
  useEffect(() => {
    const sync = () => setState(readHomeLayout(defaultLayout));
    const syncStorage = (event: StorageEvent) => { if (event.key === KEY) sync(); };
    window.addEventListener(EVENT, sync);
    window.addEventListener('storage', syncStorage);
    return () => {
      window.removeEventListener(EVENT, sync);
      window.removeEventListener('storage', syncStorage);
    };
  }, [defaultLayout]);
  const setHomeLayout = useCallback((value: HomeLayout) => {
    try { localStorage.setItem(KEY, value); } catch { /* The current session still applies. */ }
    setState(value);
    window.dispatchEvent(new Event(EVENT));
  }, []);
  return { homeLayout, setHomeLayout };
}
