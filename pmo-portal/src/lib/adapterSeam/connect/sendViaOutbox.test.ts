/**
 * ECA3-T4 (PD-ECA-8, FR-ECA-021): a master send rides the money outbox under `seed:<kind>:<pmo id>`: one outbox row and one
 * ERP create per record, a lost answer is adopted through the probe, a refusal fails the row, an undecidable probe holds it.
 * The outbox is an in-memory fake with the database's guarded semantics and a controllable clock.
 */
import { describe, expect, it } from 'vitest';
import { AdapterError } from '../contract.ts';
import type { DispatchMoneyOutboxDeps, OutboxRow } from '../dispatch.ts';
import { sendKey, sendMasterOnce, SEND_DOMAIN } from './sendViaOutbox.ts';
import type { ConnectAdapter, MasterKind, PmoMaster } from './types.ts';

const LEASE_MS = 60_000;
const WINDOW_MS = 5 * 60_000;

type Row = OutboxRow & { updatedAt: number; reconcileAfter: number | null; lastError?: string };

function fakeOutbox(probe: DispatchMoneyOutboxDeps['probeByRemarksKey'], reissueOnInconclusiveAbsence = true) {
  let t = 1_000_000;
  const rows = new Map<string, Row>();
  const refs: Array<{ pmoRecordId: string; externalRecordId: string; domain: string }> = [];
  const seen: Array<[string, string, string]> = [];
  const strip = ({ updatedAt: _u, reconcileAfter: _r, lastError: _e, ...row }: Row): OutboxRow => ({ ...row });
  const find = (d: string, p: string, k: string) => [...rows.values()].find((r) => r.domain === d && r.pmoRecordId === p && r.idempotencyKey === k);
  const money: DispatchMoneyOutboxDeps = {
    now: () => t,
    async readOutbox(d, p, k) { const r = find(d, p, k); return r ? strip(r) : null; },
    async insertOutboxPending(d, p, k) {
      seen.push([d, p, k]);
      const row: Row = { id: `o${rows.size + 1}`, domain: d, pmoRecordId: p, idempotencyKey: k, state: 'pending', externalRecordId: null, canonical: null, claimGeneration: 0, payloadDigest: null, updatedAt: t, reconcileAfter: null };
      rows.set(row.id, row);
      return strip(row);
    },
    async claimOutboxForCommit(id) {
      const r = rows.get(id)!;
      const ready = r.state === 'quarantined' && r.reconcileAfter !== null && t >= r.reconcileAfter;
      if (r.state !== 'pending' && r.state !== 'failed' && !ready) return null;
      Object.assign(r, { state: 'committing', claimGeneration: r.claimGeneration + 1, updatedAt: t });
      return strip(r);
    },
    async quarantineCommitting(id) {
      const r = rows.get(id)!;
      if (!(r.state === 'committing' && t - r.updatedAt > LEASE_MS)) return null;
      Object.assign(r, { state: 'quarantined', claimGeneration: r.claimGeneration + 1, reconcileAfter: t + WINDOW_MS });
      return strip(r);
    },
    async markOutboxCommitted(id, ext, canonical, gen) {
      const r = rows.get(id)!; if (r.claimGeneration !== gen) return 0;
      Object.assign(r, { state: 'committed', externalRecordId: ext, canonical }); return 1;
    },
    async recordOutboxRef(id, gen, m) {
      const r = rows.get(id)!; if (r.claimGeneration !== gen || r.state !== 'committed') return 0;
      refs.push({ pmoRecordId: m.pmoRecordId, externalRecordId: m.externalRecordId, domain: m.domain }); return 1;
    },
    async confirmOutbox(id, gen) { const r = rows.get(id)!; if (r.claimGeneration !== gen || r.state !== 'committed') return 0; r.state = 'confirmed'; return 1; },
    async markOutboxHeld(id, _reason, gen) { const r = rows.get(id)!; if (r.claimGeneration !== gen || r.state !== 'committing') return 0; r.state = 'held'; return 1; },
    async markOutboxFailed(id, err, gen) { const r = rows.get(id)!; if (r.claimGeneration !== gen) return 0; Object.assign(r, { state: 'failed', lastError: err }); return 1; },
    reissueOnInconclusiveAbsence,
    probeByRemarksKey: probe,
    backoff: async () => {},
  };
  return { money, rows, refs, seen, advance: (ms: number) => { t += ms; } };
}

/** A tier-agnostic ERP: lookup by id, create once; `fault` is consumed by the next create. */
function fakeConnect() {
  const docs = new Map<string, string>();   // pmo id -> external id
  const calls = { sends: 0 };
  let fault: 'lost-response' | 'reject' | null = null;
  const deadlines: Array<number | undefined> = [];
  const adapter: ConnectAdapter = {
    tier: 'fake',
    async listMasters() { return { rows: [], nextCursor: null }; },
    async countDomain() { return 0; },
    async sendMaster(_kind, record, _key, opts) {
      calls.sends += 1; deadlines.push(opts?.commitDeadlineAtMs);
      const f = fault; fault = null;
      if (f === 'reject') throw new AdapterError('commit-rejected', 'refused');
      if (!docs.has(record.id)) docs.set(record.id, `EXT-${docs.size + 1}`);
      if (f === 'lost-response') throw new AdapterError('external-unreachable', 'lost');
      return { externalId: docs.get(record.id)! };
    },
  };
  const probe: DispatchMoneyOutboxDeps['probeByRemarksKey'] = async (_d, key) => {
    const id = key.split(':').slice(2).join(':');
    return docs.has(id) ? { externalRecordId: docs.get(id)! } : null;
  };
  return { adapter, docs, calls, deadlines, probe, arm: (f: 'lost-response' | 'reject') => { fault = f; } };
}

const REC: Record<string, PmoMaster> = {
  party: { id: 'c-1', name: 'PT Baja', role: 'vendor' }, project: { id: 'p-1', name: 'Jembatan' },
  item: { id: 'Semen', name: 'Semen' }, employee: { id: 'u-1', name: 'Siti' },
};

function setup(over: { probe?: DispatchMoneyOutboxDeps['probeByRemarksKey']; reissue?: boolean } = {}) {
  const erp = fakeConnect();
  const ob = fakeOutbox(over.probe ?? erp.probe, over.reissue);
  const send = (kind: 'party' | 'project' | 'item' | 'employee', rec: PmoMaster = REC[kind]) =>
    sendMasterOnce({ money: ob.money }, erp.adapter, kind, rec);
  return { erp, ob, send };
}

describe('ECA3-T4 sendViaOutbox', () => {
  it('FR-ECA-021 the key is seed:<kind>:<pmo id> in the kind\'s outbox domain', async () => {
    const { ob, send } = setup();
    for (const kind of ['party', 'project', 'item', 'employee'] as const) await send(kind);
    expect(ob.seen).toEqual([
      ['companies', 'c-1', 'seed:party:c-1'], ['projects', 'p-1', 'seed:project:p-1'],
      ['items', 'Semen', 'seed:item:Semen'], ['employees', 'u-1', 'seed:employee:u-1'],
    ]);
    expect(sendKey('party', 'x')).toBe('seed:party:x');
    expect(SEND_DOMAIN).toEqual({ party: 'companies', project: 'projects', item: 'items', employee: 'employees' });
  });

  it('sending the same record twice claims once and creates once: the second answer is the stored one', async () => {
    const { erp, ob, send } = setup();
    const first = await send('party');
    const second = await send('party');
    expect(second.externalRecordId).toBe(first.externalRecordId);
    expect(erp.calls.sends).toBe(1);
    expect(ob.rows.size).toBe(1);
    expect([...ob.rows.values()][0].state).toBe('confirmed');
  });

  it('AC-ECA-011 a create whose answer is lost is adopted through the probe after the window, never created twice', async () => {
    const { erp, ob, send } = setup();
    erp.arm('lost-response');
    await expect(send('project')).rejects.toMatchObject({ code: 'external-unreachable' });
    ob.advance(LEASE_MS + 1);
    await expect(send('project')).rejects.toMatchObject({ code: 'external-unreachable' });   // inside the visibility window: no new POST
    expect(erp.calls.sends).toBe(1);
    ob.advance(WINDOW_MS + 1);
    const adopted = await send('project');
    expect(adopted.externalRecordId).toBe('EXT-1');
    expect(erp.calls.sends).toBe(1);
    expect(erp.docs.size).toBe(1);
    expect([...ob.rows.values()][0].state).toBe('confirmed');
  });

  it('a refusal fails the row with a bounded reason and does not hold it', async () => {
    const { erp, ob, send } = setup();
    erp.arm('reject');
    await expect(send('item')).rejects.toMatchObject({ code: 'commit-rejected' });
    const row = [...ob.rows.values()][0];
    expect(row.state).toBe('failed');
    expect(row.lastError).toMatch(/commit-rejected/);
  });

  it('a probe that cannot decide holds the row for a person and creates nothing', async () => {
    const { erp, ob, send } = setup({ probe: async () => { throw new AdapterError('commit-rejected', 'ambiguous'); } });
    await expect(send('party')).rejects.toMatchObject({ code: 'command-held' });
    expect([...ob.rows.values()][0].state).toBe('held');
    expect(erp.calls.sends).toBe(0);
  });

  it('a party whose create left no trace is held, a project or item is created again (reissue policy)', async () => {
    for (const [kind, reissue] of [['party', false], ['project', true]] as const) {
      const { erp, ob, send } = setup({ probe: async () => null, reissue });
      erp.arm('lost-response');
      await expect(send(kind)).rejects.toMatchObject({ code: 'external-unreachable' });
      erp.docs.clear();   // the create never landed after all
      ob.advance(LEASE_MS + 1); await expect(send(kind)).rejects.toBeTruthy();
      ob.advance(WINDOW_MS + 1);
      if (reissue) { await send(kind); expect(erp.calls.sends).toBe(2); } else {
        await expect(send(kind)).rejects.toMatchObject({ code: 'command-held' });
        expect(erp.calls.sends).toBe(1);
      }
    }
  });

  it('C1 the outbox writes no link for any kind (record_connect_send_result is the one guarded link writer), and every send still confirms', async () => {
    const { ob, send } = setup();
    for (const kind of ['party', 'project', 'item', 'employee'] as const) await send(kind);
    expect(ob.refs).toEqual([]);
    expect([...ob.rows.values()].map((r) => r.state)).toEqual(['confirmed', 'confirmed', 'confirmed', 'confirmed']);
  });

  it('the claim\'s commit deadline reaches the ERP create (a POST past it is refused by the transport)', async () => {
    const { erp, send } = setup();
    await send('party');
    expect(erp.deadlines[0]).toEqual(expect.any(Number));
  });

  it('MasterKind account and contact are not sendable (type-level), the kinds are exactly the four', () => {
    const kinds: MasterKind[] = Object.keys(SEND_DOMAIN) as MasterKind[];
    expect(kinds.sort()).toEqual(['employee', 'item', 'party', 'project']);
  });
});
