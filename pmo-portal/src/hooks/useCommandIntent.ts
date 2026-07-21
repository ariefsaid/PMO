/**
 * The FE ownership of a command identity's LIFETIME (BLOCK 2, ADR-0058).
 *
 * `newCommandIntent()` mints the `{id, idempotencyKey}` pair the repository seam threads to the
 * outbox; WHO holds it for HOW LONG is the money-safety property, and that is a UI concern:
 *
 *   - mint when the form / confirm dialog OPENS — never per submit;
 *   - pass it VERBATIM on every attempt, so a retry after a lost response ("external system
 *     unreachable — try again") lands on the SAME outbox 4-tuple and RECONCILES (adopting the doc
 *     ERP already committed) instead of POSTing a second submitted money document;
 *   - re-mint only when the session ends (a terminal success / a deliberately new form) — NEVER in
 *     `onError`, which is precisely the duplicate-money bug.
 *
 * Two shapes, because the two UI lifetimes differ:
 *   - `useCommandIntent()` for a component whose MOUNT is the session (a create modal that unmounts
 *     on close — one intent per form session, for free);
 *   - `useCommandIntentMap()` for a long-lived component that invokes a verb on MANY records (a
 *     confirm dialog that is always mounted): one identity per (record, verb) key, never shared.
 */
import { useCallback, useRef } from 'react';
import { newCommandIntent } from '@/src/lib/repositories/commandIntent';
import type { CommandIntent } from '@/src/lib/repositories/types';

/** ONE command identity for the calling component's whole mount (its form session). */
export function useCommandIntent(): CommandIntent {
  const ref = useRef<CommandIntent | null>(null);
  if (ref.current === null) ref.current = newCommandIntent();
  return ref.current;
}

export interface CommandIntentMap {
  /** The identity for `key`, minted on first use and stable until released. */
  intentFor: (key: string) => CommandIntent;
  /** Ends `key`'s session after a TERMINAL SUCCESS — the next `intentFor(key)` mints a fresh one. */
  release: (key: string) => void;
}

/** One command identity per key — use `${verb}:${recordId}` so two verbs never share an identity. */
export function useCommandIntentMap(): CommandIntentMap {
  const map = useRef<Map<string, CommandIntent>>(new Map());

  const intentFor = useCallback((key: string): CommandIntent => {
    const existing = map.current.get(key);
    if (existing) return existing;
    const minted = newCommandIntent();
    map.current.set(key, minted);
    return minted;
  }, []);

  const release = useCallback((key: string) => {
    map.current.delete(key);
  }, []);

  return { intentFor, release };
}
