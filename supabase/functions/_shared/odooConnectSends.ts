/**
 * Pass — send the PMO masters an Admin accepted as "send" to Odoo (#1504 S8, FR-ECA-020..022, FR-ODC-034/052). The loop is the
 * tier-neutral `connectSendsCore.ts`; this supplies Odoo's connection, its lookup probe and its rule that a probe miss is NEVER
 * reissued: Odoo has no unique constraint on a partner anchor, a product code or an analytic code, so a miss cannot prove the
 * create never landed (ADR-0058 C-1). Such a send ends held, for a person.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { bindCall, OdooError, type OdooCall } from '../../../pmo-portal/src/lib/adapterSeam/odoo/client.ts';
import { KIND_SPECS, parsePage } from '../../../pmo-portal/src/lib/adapterSeam/odoo/kinds.ts';
import { createOdooConnectAdapter, odooSendProbe, type OdooConnectCtx } from '../../../pmo-portal/src/lib/adapterSeam/odoo/connectAdapter.ts';
import { CONNECT_SENDS_BUDGET_MS, CONNECT_SENDS_PER_TICK, drainSends, type DrainResult } from './connectSendsCore.ts';
import { odooClientForOrg, type OdooClientForOrgResult } from './odooClientForOrg.ts';

/** Odoo calls one send can make: the outbox's probe, sendMaster's own lookup, the create, and (a project) the read that mirrors the new cost account. */
export const ODOO_CALLS_PER_SEND = 4;

/**
 * A project is linked to its cost account through the mirror (`link_odoo_cost_account` accepts only mirrored accounts of the chosen plan),
 * and the directory pass will not have read a just-created account yet. So the account is mirrored here, one row, with the directory
 * cursor passed back unchanged: this write never moves the watermark, the sweep still reads everything after it.
 */
export async function mirrorSentAccount(sc: SupabaseClient, orgId: string, call: OdooCall, accountId: string): Promise<void> {
  const spec = KIND_SPECS.analytic_account;
  const found = await call<Array<Record<string, unknown>>>(spec.model, 'search_read', { domain: [['id', '=', Number(accountId)]], fields: ['id', ...spec.fields], limit: 1, context: { active_test: false } });
  const { rows } = parsePage(spec, found);
  if (rows.length === 0) throw new Error('sent account unreadable');
  const cursor = await sc.from('external_sync_watermarks').select('watermark_cursor').eq('org_id', orgId).eq('external_tier', 'odoo').eq('domain', 'master:analytic_account').maybeSingle();
  if (cursor.error) throw new Error('cursor unreadable');
  const { error } = await sc.rpc('apply_odoo_master_page', { p_org_id: orgId, p_kind: 'analytic_account', p_rows: rows, p_cursor: (cursor.data?.watermark_cursor as string | undefined) ?? '' });
  if (error) throw new Error('mirror write failed');
}

type Resolved = Extract<OdooClientForOrgResult, { client: unknown }>;

/** Plain words for the two refusals Odoo's adapter raises itself; anything else (Odoo's own text never travels) gets the generic sentence. */
const REASONS: Record<string, string> = {
  'unit-unmapped': 'its unit has no match in Odoo yet',
  'project-number-missing': 'the project has no project number yet',
};

export const odooConnectCtx = (r: Resolved): OdooConnectCtx => {
  const plan = r.config.analytic_plan_id;
  return {
    companyId: r.companyId as number,
    analyticPlanId: Number.isInteger(plan) ? (plan as number) : null,
    unitMap: (r.config.unit_map ?? {}) as Record<string, string>,
  };
};

/**
 * One tick's sends. `resolved` is the sweep's own client (one vault read per tick); without it the client is resolved here.
 * `calls` (when given) is told how many Odoo calls were really made, so the sweep can give back what it reserved.
 */
export function drainOdooConnectSends(
  sc: SupabaseClient,
  org: { orgId: string; bindingId?: string | null },
  opts: { resolved?: Resolved; limit?: number; onCalls?: (n: number) => void; clock?: { nowMs: () => number; budgetMs: number } } = {},
): Promise<DrainResult> {
  let ctx: OdooConnectCtx | null = null;
  let made = 0;
  let call: OdooCall | null = null;
  return drainSends(sc, org, {
    tier: 'odoo',
    async open() {
      const r = opts.resolved ?? await odooClientForOrg(sc, org.orgId);
      if ('refusal' in r) return { refusal: r.refusal };
      ctx = odooConnectCtx(r);
      const raw = bindCall(r.client);
      // Only a validation answer says something about THIS record. A rejected key, a missing model or a changed database is the connection's
      // fault: the send must wait for the connection to be fixed, not end as a decision about the record.
      call = (async <T>(model: string, method: string, body?: Record<string, unknown>) => {
        made += 1;
        try { return await raw<T>(model, method, body); }
        catch (err) { throw err instanceof OdooError && err.errorClass !== 'validation' ? new OdooError('unreachable') : err; }
      }) as OdooCall;
      return { connect: createOdooConnectAdapter(call!, ctx), probe: (kind, master) => odooSendProbe(call!, ctx!, kind, master) };
    },
    afterSent: async (kind, _master, externalId) => { if (kind === 'project') await mirrorSentAccount(sc, org.orgId, call!, externalId); },
    refuse: (kind, master) => {
      if (kind !== 'project') return null;
      if (ctx?.analyticPlanId === null) return 'Choose the cost-account plan for projects first, then send this project again.';
      return master.code?.trim() ? null : 'This project has no project number yet, so its cost account cannot be named. Give it one, then send it again.';
    },
    reissueOnInconclusiveAbsence: () => false,
    reasonOf: (err) => REASONS[(err as { message?: string }).message ?? ''] ?? null,
    personText: 'Odoo people are not sent from PMO yet. Add this person in Odoo.',
  }, opts.limit ?? CONNECT_SENDS_PER_TICK, opts.clock ?? { nowMs: Date.now, budgetMs: CONNECT_SENDS_BUDGET_MS }).finally(() => opts.onCalls?.(made));
}

/**
 * The sweep tick's step: send what Admins accepted, inside the tick's Odoo call budget. Each send reserves its four calls up
 * front, and what the tick did not make is given back, so a probe hit (no create) or an unreachable Odoo frees room for the
 * directory passes. Never fails the tick; it logs a fixed sentence only, never a record.
 */
export async function sendAcceptedOdoo(
  sc: SupabaseClient,
  orgId: string,
  r: Resolved,
  budget: { spend: (calls?: number) => boolean; refund?: (calls?: number) => void },
): Promise<void> {
  let limit = 0;
  while (limit < CONNECT_SENDS_PER_TICK && budget.spend(ODOO_CALLS_PER_SEND)) limit += 1;
  if (limit === 0) return;
  try {
    const out = await drainOdooConnectSends(sc, { orgId, bindingId: r.bindingId }, {
      resolved: r, limit, onCalls: (made) => budget.refund?.(Math.max(0, limit * ODOO_CALLS_PER_SEND - made)),
    });
    if (out.error) console.error('odoo send pass reported a problem');
  } catch {
    budget.refund?.(limit * ODOO_CALLS_PER_SEND);   // ponytail: refunds everything even if some calls were made; harmless, the tick's own cap still bounds Odoo load
    console.error('odoo send pass failed');
  }
}
