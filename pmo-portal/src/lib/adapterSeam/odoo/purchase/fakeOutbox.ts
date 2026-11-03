/**
 * Test support: the money outbox trimmed to what a quarantine -> recovery claim touches (the full fake is dispatch.money.test.ts's). It
 * reproduces the DB's guarantees that matter here: one claim winner per row, a stale `committing` row is quarantined (never re-POSTed),
 * and every write-back is fenced on `claim_generation`.
 */
import { expect } from 'vitest';
import type { DispatchMoneyOutboxDeps, OutboxRow } from '../../dispatch.ts';

export const LEASE_MS = 60_000;

type Row = OutboxRow & { updatedAt: number; claimedAt: number | null; reconcileAfter: number | null };
const strip = ({ updatedAt: _u, claimedAt: _c, reconcileAfter: _r, ...row }: Row): OutboxRow => ({ ...row });

export function createFakeOutbox(reissueOnInconclusiveAbsence: boolean, probe: DispatchMoneyOutboxDeps['probeByRemarksKey']) {
  const rows = new Map<string, Row>();
  const only = () => [...rows.values()][0];
  const deps: DispatchMoneyOutboxDeps = {
    readOutbox: async () => (only() ? strip(only()) : null),
    insertOutboxPending: async (domain, pmoRecordId, idempotencyKey) => {
      rows.set('o1', { id: 'o1', domain, pmoRecordId, idempotencyKey, state: 'pending', externalRecordId: null, canonical: null, claimGeneration: 0, payloadDigest: null, updatedAt: Date.now(), claimedAt: null, reconcileAfter: null });
      return strip(only());
    },
    claimOutboxForCommit: async (id) => {
      const row = rows.get(id)!;
      if (!(row.state === 'pending' || row.state === 'failed' || (row.state === 'quarantined' && row.reconcileAfter !== null && Date.now() >= row.reconcileAfter))) return null;
      Object.assign(row, { state: 'committing', claimGeneration: row.claimGeneration + 1, claimedAt: Date.now(), updatedAt: Date.now() });
      return strip(row);
    },
    quarantineCommitting: async (id) => {
      const row = rows.get(id)!;
      if (!(row.state === 'committing' && Date.now() - row.updatedAt > LEASE_MS)) return null;
      Object.assign(row, { state: 'quarantined', claimGeneration: row.claimGeneration + 1, reconcileAfter: Date.now() + 5 * 60_000, updatedAt: Date.now() });
      return strip(row);
    },
    markOutboxCommitted: async (id, externalRecordId, canonical, gen) => { const r = rows.get(id)!; if (r.claimGeneration !== gen) return 0; Object.assign(r, { state: 'committed', externalRecordId, canonical }); return 1; },
    recordOutboxRef: async (id, gen) => (rows.get(id)!.claimGeneration === gen ? 1 : 0),
    confirmOutbox: async (id, gen) => { const r = rows.get(id)!; if (r.claimGeneration !== gen || r.state !== 'committed') return 0; r.state = 'confirmed'; return 1; },
    markOutboxHeld: async (id, _reason, gen) => { const r = rows.get(id)!; if (r.claimGeneration !== gen || r.state !== 'committing') return 0; r.state = 'held'; return 1; },
    markOutboxFailed: async (id, _e, gen) => { const r = rows.get(id)!; if (r.claimGeneration !== gen) return 0; r.state = 'failed'; return 1; },
    reissueOnInconclusiveAbsence,
    probeByRemarksKey: probe,
    backoff: async () => {},
  };
  return {
    deps, rows, state: () => only().state,
    /** A dead claimant that never finished, then the lease and the visibility window both elapsed: the next dispatch is a post-window recovery. */
    strand: async (run: () => Promise<unknown>, domain: string, pmoRecordId: string, idempotencyKey: string) => {
      await deps.insertOutboxPending(domain, pmoRecordId, idempotencyKey);
      await deps.claimOutboxForCommit('o1');
      only().updatedAt = Date.now() - LEASE_MS - 1;
      await expect(run()).rejects.toMatchObject({ code: 'external-unreachable' });   // the stale committing row is quarantined first
      only().reconcileAfter = Date.now() - 1;
    },
  };
}
