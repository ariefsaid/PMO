import { emitServerEvent } from './posthogServer.ts';

/**
 * erp_push_outcome (#1532 S4, FR-PHO-030..032): one operational event per outbox transition that THIS
 * call made (confirmed / failed / held / quarantined). Codes and counts only — never amounts, party
 * names, ERP document ids or ERP error text. Called only from adapter-dispatch/moneyOutboxDeps.ts.
 */
const KNOWN_CODES = new Set([
  'commit-rejected', 'external-unreachable', 'destination_not_permitted', // AdapterErrorCode (contract.ts)
  'recovery-probe-failed', 'recovery-inconclusive-absence', 'recovery-reissue-unauthorized', // held reasons (dispatch.ts)
  'committing-lease-expired', // quarantined
]);
/** The leading `<code>:` that `redactErrorForOutbox` / the held reasons put in front of free text, only if it is a known code; nothing else leaves. */
export function stableOutcomeCode(text: string | undefined): string {
  const code = /^([a-z][a-z0-9_-]{2,48}):/.exec(text ?? '')?.[1];
  return code && KNOWN_CODES.has(code) ? code : 'unclassified';
}

export interface ErpPushOutcomeProps {
  tier: string; domain: string; operation: string; outcome: 'confirmed' | 'failed' | 'quarantined' | 'held';
  errorCode?: string; attemptCount?: number; durationMs?: number; orgId: string; outboxId: string;
}

export function emitErpPushOutcome(p: ErpPushOutcomeProps): Promise<void> {
  return emitServerEvent('erp_push_outcome', 'money-outbox', {
    tier: p.tier, domain: p.domain, operation: p.operation, outcome: p.outcome, error_code: p.errorCode,
    attempt_count: p.attemptCount, duration_ms: p.durationMs, org_id: p.orgId, outbox_id: p.outboxId,
    needs_human: p.outcome === 'held', // FR-PHO-032: a held command always needs a person
  });
}
