/**
 * Reference (test-double) adapter (FR-EAS-025, AC-EAS-020..022/070). Implements the adapter contract
 * for the synthetic 'reference' domain with configurable outcomes (commands AND reads — FR-EAS-021), so every P0 AC is provable with NO
 * real external system. Pure (no supabase/browser imports) ⇒ Deno-importable by the adapter-dispatch
 * edge function. NEVER receives org_id (FR-EAS-024) — proven at the dispatch (AC-EAS-023).
 */
import { Adapter, AdapterCommand, AdapterError, ChangesSinceWatermark, CommandResult, PmoDomain, PmoRecord } from './contract.ts';

/** Configurable outcomes for the reference adapter (FR-EAS-025). */
export type ReferenceOutcome = 'commit-success' | 'commit-rejected-validation' | 'external-unreachable';

/** The synthetic domain the reference adapter owns (OD-4 — zero contact with real-domain behavior). */
export const REFERENCE_DOMAIN: PmoDomain = 'reference';

/** A reference adapter with a readable `outcome` (for assertions). */
export interface ReferenceAdapter extends Adapter {
  readonly outcome: ReferenceOutcome;
}

/** Construct a reference adapter with the given outcome (default commit-success). */
export function createReferenceAdapter(outcome: ReferenceOutcome = 'commit-success'): ReferenceAdapter {
  return {
    tier: 'reference',
    capabilityMap: new Set<PmoDomain>([REFERENCE_DOMAIN]),
    outcome,
    async commit(command: AdapterCommand): Promise<CommandResult> {
      if (command.domain !== REFERENCE_DOMAIN) {
        throw new AdapterError('commit-rejected', `reference adapter cannot own domain "${command.domain}"`);
      }
      if (outcome === 'external-unreachable') {
        throw new AdapterError('external-unreachable', 'reference system unreachable');
      }
      if (outcome === 'commit-rejected-validation') {
        throw new AdapterError('commit-rejected', 'reference system rejected the payload');
      }
      const externalRecordId = `ext-${command.record.id}`;
      return { externalRecordId, canonical: { ...command.record, external_id: externalRecordId } };
    },
    async listChangesSinceWatermark(domain: PmoDomain, cursor: string | null): Promise<ChangesSinceWatermark> {
      if (domain !== REFERENCE_DOMAIN) {
        throw new AdapterError('commit-rejected', `reference adapter cannot own domain "${domain}"`);
      }
      if (outcome === 'external-unreachable') {
        throw new AdapterError('external-unreachable', 'reference system unreachable');
      }
      const since = cursor ? Number(cursor) : 0;
      const changes: PmoRecord[] = [
        { id: `pmo-${since + 1}`, external_id: `ext-${since + 1}` },
        { id: `pmo-${since + 2}`, external_id: `ext-${since + 2}` },
      ];
      return { changes, nextCursor: null };
    },
    async getByExternalId(domain: PmoDomain, externalRecordId: string): Promise<PmoRecord | null> {
      if (domain !== REFERENCE_DOMAIN) {
        throw new AdapterError('commit-rejected', `reference adapter cannot own domain "${domain}"`);
      }
      if (outcome === 'external-unreachable') {
        throw new AdapterError('external-unreachable', 'reference system unreachable');
      }
      return { id: externalRecordId.replace(/^ext-/, 'pmo-'), external_id: externalRecordId };
    },
  };
}
