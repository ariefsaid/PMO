import { useCallback, useEffect, useState } from 'react';

export type TextSize = 'default' | 'large' | 'larger';
const KEY = 'text-size';
const EVENT = 'textsizechange';

function readSize(): TextSize {
  const value = document.documentElement.dataset.textSize;
  return value === 'large' || value === 'larger' ? value : 'default';
}

export function useTextSize() {
  const [textSize, setState] = useState<TextSize>(readSize);
  useEffect(() => {
    const sync = () => setState(readSize());
    const syncStorage = (event: StorageEvent) => {
      if (event.key !== KEY) return;
      document.documentElement.dataset.textSize = event.newValue === 'large' || event.newValue === 'larger' ? event.newValue : 'default';
      sync();
    };
    window.addEventListener(EVENT, sync);
    window.addEventListener('storage', syncStorage);
    return () => {
      window.removeEventListener(EVENT, sync);
      window.removeEventListener('storage', syncStorage);
    };
  }, []);
  const setTextSize = useCallback((value: TextSize) => {
    document.documentElement.dataset.textSize = value;
    try { localStorage.setItem(KEY, value); } catch { /* The current session still applies. */ }
    setState(value);
    window.dispatchEvent(new Event(EVENT));
  }, []);
  return { textSize, setTextSize };
}
