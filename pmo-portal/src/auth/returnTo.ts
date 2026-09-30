import type { Location } from 'react-router';

/**
 * Return-to for the sign-in guard (AC-CLI-012). `RequireAuth` hands the page a signed-out user was
 * trying to reach to `/login` in ROUTER STATE (never the URL — `/login` stays `/login`), and the
 * login page sends them back there after signing in. Needed by the OAuth consent screen: its
 * `authorization_id` must survive the detour through sign-in.
 *
 * Router state is set by the app, not by a link, but it is still treated as untrusted: only a
 * same-origin absolute PATH is honoured — never a protocol-relative `//host`, a `/\host` that some
 * browsers normalise to one, an absolute URL, or `/login` itself.
 */
export interface ReturnToState {
  from: string;
}

/** The state `RequireAuth` attaches when it redirects a signed-out visit to `/login`. */
export function returnToState(location: Pick<Location, 'pathname' | 'search' | 'hash'>): ReturnToState {
  return { from: `${location.pathname}${location.search}${location.hash}` };
}

/** The safe path to return to after sign-in, or `null` when the state carries none. */
export function returnPathFrom(state: unknown): string | null {
  const from = (state as Partial<ReturnToState> | null | undefined)?.from;
  if (typeof from !== 'string') return null;
  if (!from.startsWith('/') || from.startsWith('//') || from.startsWith('/\\')) return null;
  if (from === '/login' || from.startsWith('/login?') || from.startsWith('/login#')) return null;
  return from;
}
