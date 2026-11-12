import { useCallback, useEffect, useState } from 'react';

export type HomeLayout = 'overview' | 'focused';
const KEY = 'home-layout';
const EVENT = 'homelayoutchange';

/** Per device, like text size. Anything stored that is not "focused" reads as Overview. */
export function readHomeLayout(): HomeLayout {
  try { return localStorage.getItem(KEY) === 'focused' ? 'focused' : 'overview'; } catch { return 'overview'; }
}

export function useHomeLayout() {
  const [homeLayout, setState] = useState<HomeLayout>(readHomeLayout);
  useEffect(() => {
    const sync = () => setState(readHomeLayout());
    const syncStorage = (event: StorageEvent) => { if (event.key === KEY) sync(); };
    window.addEventListener(EVENT, sync);
    window.addEventListener('storage', syncStorage);
    return () => {
      window.removeEventListener(EVENT, sync);
      window.removeEventListener('storage', syncStorage);
    };
  }, []);
  const setHomeLayout = useCallback((value: HomeLayout) => {
    try { localStorage.setItem(KEY, value); } catch { /* The current session still applies. */ }
    setState(value);
    window.dispatchEvent(new Event(EVENT));
  }, []);
  return { homeLayout, setHomeLayout };
}
