/**
 * Advance an org's open connect run (ECA2-T13, #1605; Odoo's pass, #1504 S6). One bounded step per tick: page ERP masters
 * into the run's staging table; once every kind is staged, propose ONE kind. The loop is tier-agnostic (`connect/run.ts`);
 * this file only binds it to the database. A tick that throws is counted against the run and three in a row end it. Each
 * tier's sweep calls this with its own tier.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { AdapterError } from '../../../pmo-portal/src/lib/adapterSeam/contract.ts';
import { reviewReasonText } from '../../../pmo-portal/src/lib/adapterSeam/connect/match.ts';
import { RUN_BUDGET_MS, tickConnectRun, type ConnectRunDeps } from '../../../pmo-portal/src/lib/adapterSeam/connect/run.ts';
import type { MasterKind, MatchOutcome, NormalisedMaster } from '../../../pmo-portal/src/lib/adapterSeam/connect/types.ts';
import { connectAdapterForOrg } from '../_shared/connectAdapterForOrg.ts';
import { pmoMasters } from '../_shared/connectPmoMasters.ts';

export const CONNECT_CALLS_PER_TICK = 20;
const CHUNK = 1000;   // under the platform row cap, for reads and for one replace_connect_proposals call

interface RunRow { id: string; state: 'staging' | 'proposing'; cursor: Record<string, string | null>; proposed_kinds: MasterKind[]; started_at: string }

async function check<T>(q: PromiseLike<{ data: T; error: { code?: string } | null }>, what: string): Promise<T> {
  const { data, error } = await q;
  if (error) throw new Error(`${what} failed: ${error.code ?? 'unknown'}`);
  return data;
}

/** The row a proposal stores: only the ERP fields an accept will apply, so accept never calls the ERP (PD-ECA-2). */
const snapshotOf = (e: NormalisedMaster | undefined) => ({ name: e?.name, taxId: e?.taxId ?? null, code: e?.code ?? null, role: e?.role });

function toRow(kind: MasterKind, o: MatchOutcome, erp: (id: string) => NormalisedMaster | undefined): Record<string, unknown> {
  if (o.outcome === 'link') return { outcome: 'link', pmoIds: [o.pmoId], externalIds: [o.externalId], key: o.key, snapshot: snapshotOf(erp(o.externalId)) };
  if (o.outcome === 'bring-in') return { outcome: 'bring-in', pmoIds: [], externalIds: [o.externalId], snapshot: snapshotOf(erp(o.externalId)) };
  if (o.outcome === 'send') return { outcome: 'send', pmoIds: [o.pmoId], externalIds: [], snapshot: {} };
  return { outcome: 'review', pmoIds: o.pmoIds, externalIds: o.externalIds, reason: o.reason, reasonText: reviewReasonText(kind, o), snapshot: {} };
}

export async function advanceConnectRuns(sc: SupabaseClient, org: { orgId: string; bindingId?: string | null }, tier: string): Promise<{ state?: 'more' | 'ready' | 'failed' }> {
  if (!org.bindingId) return {};
  const row = await check(sc.from('erp_connect_runs').select('id, state, cursor, proposed_kinds, started_at')
    .eq('org_id', org.orgId).eq('external_tier', tier).eq('binding_id', org.bindingId).in('state', ['staging', 'proposing']).maybeSingle(), 'connect run read') as RunRow | null;
  if (!row) return {};

  const failRun = async (errorClass: string, fatal: boolean) =>
    await check(sc.rpc('fail_connect_run', { p_org_id: org.orgId, p_run_id: row.id, p_error_class: errorClass, p_fatal: fatal }), 'connect run failure') as 'staging' | 'proposing' | 'failed';

  let adapter;
  try {
    adapter = await connectAdapterForOrg(sc, org.orgId, tier);
  } catch (err) {
    // an unresolvable connection is a failed tick too, so the run cannot sit open for ever
    const state = await failRun(err instanceof AdapterError ? err.code : 'unexpected', false);
    return { state: state === 'failed' ? 'failed' : 'more' };
  }

  const deps: ConnectRunDeps = {
    adapter,
    run: { id: row.id, state: row.state, cursor: row.cursor ?? {}, proposedKinds: [...(row.proposed_kinds ?? [])], startedAt: row.started_at },
    stagePage: async (kind, rows, nextCursor) => {
      await check(sc.rpc('stage_connect_master_page', { p_org_id: org.orgId, p_run_id: row.id, p_kind: kind, p_rows: rows, p_next_cursor: nextCursor }), 'staging');
    },
    stagedErp: async (kind) => {
      const out: NormalisedMaster[] = [];
      let after: string | null = null;
      for (;;) {
        let q = sc.from('erp_connect_staged').select('external_id, row').eq('run_id', row.id).eq('org_id', org.orgId).eq('kind', kind)
          .order('external_id', { ascending: true }).limit(CHUNK);
        if (after !== null) q = q.gt('external_id', after);
        const page = await check(q, 'staged read') as Array<{ external_id: string; row: NormalisedMaster }>;
        out.push(...page.map((r) => r.row));
        if (page.length < CHUNK) return out;
        after = page[page.length - 1].external_id;
      }
    },
    pmoMasters: (kind) => pmoMasters(sc, org.orgId, kind, tier),
    writeProposals: async (kind, outcomes, erp) => {
      const rows = outcomes.map((o) => toRow(kind, o, erp));
      const chunks = Math.max(1, Math.ceil(rows.length / CHUNK));   // a kind with nothing to propose still marks itself proposed
      for (let i = 0; i < chunks; i += 1) {
        await check(sc.rpc('replace_connect_proposals', {
          p_org_id: org.orgId, p_tier: tier, p_run_id: row.id, p_kind: kind, p_rows: rows.slice(i * CHUNK, (i + 1) * CHUNK), p_last: i === chunks - 1,
        }), 'proposal write');
      }
    },
    failRun,
    budget: { calls: CONNECT_CALLS_PER_TICK },
    now: Date.now,
  };
  return { state: await tickConnectRun(deps) };
}

export { RUN_BUDGET_MS };
