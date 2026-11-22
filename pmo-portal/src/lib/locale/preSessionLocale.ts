import { useSyncExternalStore } from 'react';

/**
 * The language of the pages a person sees BEFORE a session exists (sign-in, reset). No organisation is known there, so the
 * resolution tiers (profile, organisation) cannot speak: this tier follows the browser language (Bahasa Indonesia or English) and
 * remembers an explicit choice on this device. It is read by `useResolvedLocale` ONLY while there is no signed-in profile; once the
 * profile loads, `resolveLocale` is the single source again (FR-L10N-003).
 */
export type PreSessionLocale = 'id' | 'en';
const KEY = 'login.language';
const EVENT = 'presessionlocalechange';

const isChoice = (value: unknown): value is PreSessionLocale => value === 'id' || value === 'en';

/** The stored choice, else the browser language (`id*` is Bahasa Indonesia, anything else English). */
export function readPreSessionLocale(): PreSessionLocale {
  try {
    const stored = window.localStorage.getItem(KEY);
    if (isChoice(stored)) return stored;
  } catch { /* storage unavailable: fall through to the browser language */ }
  const browser = typeof navigator === 'undefined' ? '' : (navigator.languages?.[0] ?? navigator.language ?? '');
  return browser.toLowerCase().startsWith('id') ? 'id' : 'en';
}

export function setPreSessionLocale(locale: PreSessionLocale): void {
  try { window.localStorage.setItem(KEY, locale); } catch { /* the choice still applies until reload */ }
  window.dispatchEvent(new Event(EVENT));
}

const subscribe = (onChange: () => void) => {
  window.addEventListener(EVENT, onChange);
  window.addEventListener('storage', onChange);
  return () => { window.removeEventListener(EVENT, onChange); window.removeEventListener('storage', onChange); };
};

export function usePreSessionLocale(): PreSessionLocale {
  return useSyncExternalStore(subscribe, readPreSessionLocale, () => 'en');
}
