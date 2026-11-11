/**
 * Shared command-identity helpers for externally-owned writes (BLOCK 2, ADR-0058).
 * One identity per user INTENT: the caller's intent is passed verbatim on every
 * attempt; omitting it keeps the legacy per-attempt minting.
 */
import { dispatchDomainCommand } from '@/src/lib/adapterSeam/dispatchClient';
import { newCommandIntent } from './commandIntent';
import type { CommandIntent } from './contracts/commandIntent';

/** The identity of a `create` command: the caller's intent, or a fresh per-attempt one (legacy default). */
export const identityFor = (intent?: CommandIntent): CommandIntent => intent ?? newCommandIntent();

/** The dispatch options bag of a `transition` command — the record id is the EXISTING record, so only
 *  the idempotency key comes from the intent (a retry of the same click reuses it verbatim). */
export const keyFor = (intent?: CommandIntent) => ({ idempotencyKey: intent?.idempotencyKey ?? crypto.randomUUID() });

/** Dispatch a `create` under ONE command identity — the caller's intent when supplied, else a fresh
 *  per-attempt one. The record id and the idempotency key come from the SAME identity, so they cannot
 *  drift apart (the 4-tuple is what the outbox de-duplicates on). */
export const dispatchCreate = (
  domain: string,
  record: Record<string, unknown>,
  intent: CommandIntent | undefined,
): ReturnType<typeof dispatchDomainCommand> => {
  const identity = identityFor(intent);
  // `id` is written LAST so the intent's id is authoritative — a record that happens to carry its own
  // `id` can never silently decouple the PMO record id from the idempotency key it is paired with.
  return dispatchDomainCommand(domain, 'create', { ...record, id: identity.id }, { idempotencyKey: identity.idempotencyKey });
};
