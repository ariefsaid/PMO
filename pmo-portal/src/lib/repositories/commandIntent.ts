/**
 * BLOCK 2 (MONEY-CRITICAL) — mint ONE command identity per user INTENT, not per attempt.
 *
 * A form/mutation session mints a `CommandIntent` once (`newCommandIntent()`) and passes the SAME
 * value on every attempt, so a human retry after a lost response lands on the SAME outbox 4-tuple
 * (`org, domain, pmo_record_id, idempotency_key`) and is reconciled by the ADR-0058 algorithm —
 * adopting the doc ERP already committed — instead of opening a fresh row and POSTing again.
 *
 * Minting inside the repository (the pre-existing behavior, kept as the default for call sites not
 * yet threaded) makes every retry a NEW identity: no claim contention, no anchor-probe hit (the
 * in-flight ERP doc carries the FIRST key) ⇒ a second SUBMITTED money document.
 *
 * This lives in its OWN leaf module (re-exported from `./index` — the public seam is unchanged) so
 * the UI hook that owns an intent's lifetime (`src/hooks/useCommandIntent`) can import the minter
 * without pulling in the whole repository barrel — which every `vi.mock('@/src/lib/repositories')`
 * in the suite would otherwise blank out.
 */
import type { CommandIntent } from './types';

export function newCommandIntent(): CommandIntent {
  return { id: crypto.randomUUID(), idempotencyKey: crypto.randomUUID() };
}
