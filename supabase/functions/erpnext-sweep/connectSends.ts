/**
 * Pass (8b) — send the PMO masters an Admin accepted as "send" (ECA3-T7, #1606, FR-ECA-020..022). Each tick leases a few waiting
 * proposals, builds the master from the PMO row (never from the proposal's snapshot), sends it through the money outbox under
 * `seed:<kind>:<pmo id>` and records the outcome. A send nobody can settle yet (ERP unreachable, another command in flight)
 * records nothing: its lease runs out and a later tick looks again, finding the first attempt's record instead of making another.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { sendMasterOnce, type SendKind } from '../../../pmo-portal/src/lib/adapterSeam/connect/sendViaOutbox.ts';
import type { PmoMaster } from '../../../pmo-portal/src/lib/adapterSeam/connect/types.ts';
import { COMMAND_IN_FLIGHT_FOR_RECORD } from '../../../pmo-portal/src/lib/adapterSeam/dispatch.ts';
import { EMPLOYEE_SEND_UNAVAILABLE_REASON } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/workflowDeclarations.ts';
import { createErpnextConnectAdapter, erpnextSendProbe } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/connectAdapter.ts';
import { createDbMoneyOutboxDeps } from '../adapter-dispatch/moneyOutboxDeps.ts';
import { erpClientForOrg } from '../_shared/erpClientForOrg.ts';
import { erpReason } from '../_shared/erpReason.ts';
import { OPEN_PROCUREMENT } from '../_shared/connectPmoMasters.ts';
import { withProbeBudget } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/client.ts';

const TIER = 'erpnext';
export const CONNECT_SENDS_PER_TICK = 10;
const NOUN: Record<string, string> = { party: 'company', project: 'project', item: 'item', employee: 'person' };
/** One tick's wall-clock allowance for sends: the sweep's other passes (and later orgs) still need the invocation after it. */
export const CONNECT_SENDS_BUDGET_MS = 40_000;

/** Plain words for the Admin (FR-ECA-022): fixed sentences, plus the ERP's own reason when it is short and carries no address or markup. */
export const CONNECT_SEND_REJECTION_TEXT = {
  gone: 'This record is no longer in PMO, or (an item) no longer on an open purchase.',
  person: `${EMPLOYEE_SEND_UNAVAILABLE_REASON} Add this person in the ERP.`,
  actor: 'The Admin who accepted this is no longer an Admin. Accept it again.',
  ambiguous: (kind: string) => `Two ERP records match this ${NOUN[kind] ?? 'record'}. Link the right one by hand.`,
  linked: 'This record is already linked to another ERP record.',
  stuck: 'We could not finish sending this record. Check it in the ERP, then try again.',
  refused: (kind: string, reason: string | null) => `The ERP refused this ${NOUN[kind] ?? 'record'}${reason ? `: ${reason}` : '. Check it in the ERP, then try again.'}`,
};

interface Claimed { id: string; kind: string; pmo_ids: string[]; decided_by: string | null }
export interface DrainResult { sent: number; rejected: number; held: number; pending: number; error?: string }

async function check<T>(q: PromiseLike<{ data: T; error: { code?: string } | null }>, what: string): Promise<T> {
  const { data, error } = await q;
  if (error) throw new Error(`${what} failed: ${error.code ?? 'unknown'}`);
  return data;
}

/** The master as PMO holds it now, scoped to the org; null when it is gone, archived, or (an item) no longer on an open purchase. */
async function pmoMasterOf(sc: SupabaseClient, orgId: string, kind: SendKind, pmoId: string): Promise<PmoMaster | null> {
  if (kind === 'party') {
    const r = await check(sc.from('companies').select('id, name, type, erp_tax_id').eq('org_id', orgId).eq('id', pmoId)
      .in('type', ['Client', 'Vendor']).is('archived_at', null).maybeSingle(), 'company read') as { id: string; name: string; type: string; erp_tax_id: string | null } | null;
    return r ? { id: r.id, name: r.name, role: r.type === 'Client' ? 'client' : 'vendor', taxId: r.erp_tax_id } : null;
  }
  if (kind === 'project') {
    const r = await check(sc.from('projects').select('id, name, code').eq('org_id', orgId).eq('id', pmoId).is('archived_at', null).maybeSingle(), 'project read') as { id: string; name: string; code: string | null } | null;
    return r ? { id: r.id, name: r.name, code: r.code } : null;
  }
  if (kind === 'item') {
    const rows = await check(sc.from('procurement_items').select('id, procurements!inner(status)').eq('org_id', orgId).eq('name', pmoId)
      .not('procurements.status', 'in', OPEN_PROCUREMENT).limit(1), 'item read') as unknown[];
    return rows.length > 0 ? { id: pmoId, name: pmoId, code: pmoId } : null;
  }
  return null;
}

/** M7: the accepting Admin still holds the role when the send goes out (a demoted or deactivated Admin's queued sends do not). */
async function actorIsAdmin(sc: SupabaseClient, orgId: string, userId: string | null): Promise<boolean> {
  if (!userId) return false;
  const r = await check(sc.from('profiles').select('id').eq('org_id', orgId).eq('id', userId).eq('role', 'Admin').eq('status', 'active').maybeSingle(), 'actor read');
  return r !== null;
}

export async function drainConnectSends(sc: SupabaseClient, org: { orgId: string; bindingId?: string | null }, budget = CONNECT_SENDS_PER_TICK,
  clock: { nowMs: () => number; budgetMs: number } = { nowMs: Date.now, budgetMs: CONNECT_SENDS_BUDGET_MS }): Promise<DrainResult> {
  const out: DrainResult = { sent: 0, rejected: 0, held: 0, pending: 0 };
  if (!org.bindingId) return out;
  const claimed = await check(sc.rpc('claim_connect_sends', { p_org_id: org.orgId, p_tier: TIER, p_limit: budget }), 'send claim') as Claimed[];
  if (claimed.length === 0) return out;

  const conn = await erpClientForOrg(sc, org.orgId, { requireCompany: true });
  if ('refusal' in conn) return { ...out, pending: claimed.length, error: `connection:${conn.refusal}` };
  const company = String(conn.config?.company);
  const adapter = createErpnextConnectAdapter(conn.client, company);
  const deadline = clock.nowMs() + clock.budgetMs;

  const record = async (c: Claimed, externalId: string | null, text: string | null) => {
    await check(sc.rpc('record_connect_send_result', { p_org_id: org.orgId, p_id: c.id, p_external_id: externalId, p_rejection: text }), 'send result');
    if (text === null) out.sent += 1; else out.rejected += 1;
  };
  const reject = (c: Claimed, text: string) => record(c, null, text);
  let stopped = false;   // a dead ERP or a spent budget ends the tick: what is left keeps its lease and a later tick looks again
  for (const c of claimed) {
    if (stopped || clock.nowMs() >= deadline) { stopped = true; out.pending += 1; continue; }
    try {
      if (c.kind === 'employee') { await reject(c, CONNECT_SEND_REJECTION_TEXT.person); continue; }   // ERPNext requires personal details PMO does not hold
      if (c.kind !== 'party' && c.kind !== 'project' && c.kind !== 'item') { await reject(c, CONNECT_SEND_REJECTION_TEXT.refused(c.kind, null)); continue; }
      const kind: SendKind = c.kind;
      // C1: a record that already has its link is never sent again (a second send makes a second ERP record); the result writer treats the same id as reconciled
      const linked = await check(sc.rpc('connect_send_existing_link', { p_org_id: org.orgId, p_tier: TIER, p_kind: kind, p_pmo: c.pmo_ids[0] }), 'link read') as string | null;
      if (linked) { await record(c, linked, null); continue; }
      const master = await pmoMasterOf(sc, org.orgId, kind, c.pmo_ids[0]);
      if (!master) { await reject(c, CONNECT_SEND_REJECTION_TEXT.gone); continue; }
      if (!(await actorIsAdmin(sc, org.orgId, c.decided_by))) { await reject(c, CONNECT_SEND_REJECTION_TEXT.actor); continue; }
      let ambiguous = false;
      const money = createDbMoneyOutboxDeps({
        serviceClient: sc as never, orgId: org.orgId, externalTier: TIER, operation: 'create',
        probeByRemarksKey: async () => {
          try { return await erpnextSendProbe(withProbeBudget(conn.client), company, kind, master); }
          catch (err) { ambiguous = (err as { code?: string }).code === 'commit-rejected'; throw err; }   // two ERP records answer: a fact, not an unknown
        },
        // ERPNext refuses a second Project with the same name and a second Item with the same code, so a probe miss proves the create never
        // landed; a company name is not unique and can be edited in Desk, so a missing company is held for a person (the Odoo rule too).
        reissueOnInconclusiveAbsence: kind !== 'party',
        actorUserId: c.decided_by ?? undefined,
      });
      try {
        const done = await sendMasterOnce({ money }, adapter, kind, master);
        await record(c, done.externalRecordId, null);
      } catch (err) {
        const code = (err as { code?: string }).code;
        if (code === 'commit-rejected') await reject(c, CONNECT_SEND_REJECTION_TEXT.refused(kind, erpReason(err)));
        else if (code === 'command-held' && ambiguous) await reject(c, CONNECT_SEND_REJECTION_TEXT.ambiguous(kind));
        else if (code === 'command-held') {
          await check(sc.rpc('record_connect_send_held', { p_org_id: org.orgId, p_id: c.id }), 'send hold');
          out.held += 1;
        } else if (code === 'external-unreachable') { out.pending += 1; stopped = true; }
        else if (code === COMMAND_IN_FLIGHT_FOR_RECORD) out.pending += 1;
        else throw err;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      out.error = `${c.kind}:${msg}`;
      try {
        // I1: a link clash (the ERP record belongs to another PMO record) can never succeed by trying again: it ends as a decision in plain words.
        // Anything else unknown is counted and ends the same way after five ticks; until then the lease runs out and a later tick looks again
        // (the first attempt's record is found, not duplicated).
        if (/\b23505\b/.test(msg)) await reject(c, CONNECT_SEND_REJECTION_TEXT.linked);
        else if (await check(sc.rpc('record_connect_send_failure', { p_org_id: org.orgId, p_id: c.id }), 'send failure') === true) out.rejected += 1;
        else out.pending += 1;
      } catch {
        out.pending += 1;
      }
    }
  }
  return out;
}
