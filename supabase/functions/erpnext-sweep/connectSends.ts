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
import { createErpnextConnectAdapter, erpnextSendProbe } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/connectAdapter.ts';
import { createDbMoneyOutboxDeps } from '../adapter-dispatch/moneyOutboxDeps.ts';
import { erpClientForOrg } from '../_shared/erpClientForOrg.ts';

const TIER = 'erpnext';
export const CONNECT_SENDS_PER_TICK = 10;
const NOUN: Record<string, string> = { party: 'company', project: 'project', item: 'item', employee: 'person' };
const OPEN_PROCUREMENT = '(Paid,Cancelled)';

/** Plain words for the Admin (FR-ECA-022): fixed sentences, plus the ERP's own reason when it is short and carries no address or markup. */
export const CONNECT_SEND_REJECTION_TEXT = {
  gone: 'This record is no longer in PMO.',
  person: 'This ERP needs a birth date and gender for each person, which PMO does not hold. Add this person in the ERP.',
  refused: (kind: string, reason: string | null) => `The ERP refused this ${NOUN[kind] ?? 'record'}${reason ? `: ${reason}` : '. Check it in the ERP, then try again.'}`,
};

function erpReason(err: unknown): string | null {
  const text = String((err as { message?: unknown } | null)?.message ?? '')
    .replace(/<[^>]*>/g, ' ').replace(/[A-Za-z0-9_+/=-]{24,}/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 160);
  return text && !/:\/\/|@/.test(text) ? text : null;
}

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

export async function drainConnectSends(sc: SupabaseClient, org: { orgId: string; bindingId?: string | null }, budget = CONNECT_SENDS_PER_TICK): Promise<DrainResult> {
  const out: DrainResult = { sent: 0, rejected: 0, held: 0, pending: 0 };
  if (!org.bindingId) return out;
  const claimed = await check(sc.rpc('claim_connect_sends', { p_org_id: org.orgId, p_tier: TIER, p_limit: budget }), 'send claim') as Claimed[];
  if (claimed.length === 0) return out;

  const conn = await erpClientForOrg(sc, org.orgId, { requireCompany: true });
  if ('refusal' in conn) return { ...out, pending: claimed.length, error: `connection:${conn.refusal}` };
  const company = String(conn.config?.company);
  const adapter = createErpnextConnectAdapter(conn.client, company);

  const reject = async (c: Claimed, text: string) => {
    await check(sc.rpc('record_connect_send_result', { p_org_id: org.orgId, p_id: c.id, p_external_id: null, p_rejection: text }), 'send result');
    out.rejected += 1;
  };
  for (const c of claimed) {
    try {
      if (c.kind === 'employee') { await reject(c, CONNECT_SEND_REJECTION_TEXT.person); continue; }   // ERPNext requires personal details PMO does not hold
      if (c.kind !== 'party' && c.kind !== 'project' && c.kind !== 'item') { await reject(c, CONNECT_SEND_REJECTION_TEXT.refused(c.kind, null)); continue; }
      const kind: SendKind = c.kind;
      const master = await pmoMasterOf(sc, org.orgId, kind, c.pmo_ids[0]);
      if (!master) { await reject(c, CONNECT_SEND_REJECTION_TEXT.gone); continue; }
      const money = createDbMoneyOutboxDeps({
        serviceClient: sc as never, orgId: org.orgId, externalTier: TIER, operation: 'create',
        probeByRemarksKey: () => erpnextSendProbe(conn.client, company, kind, master),
        // ERPNext refuses a second Project with the same name and a second Item with the same code, so a probe miss proves the create never
        // landed; a company name is not unique and can be edited in Desk, so a missing company is held for a person (the Odoo rule too).
        reissueOnInconclusiveAbsence: kind !== 'party',
        actorUserId: c.decided_by ?? undefined,
      });
      try {
        const done = await sendMasterOnce({ money }, adapter, kind, master);
        await check(sc.rpc('record_connect_send_result', { p_org_id: org.orgId, p_id: c.id, p_external_id: done.externalRecordId, p_rejection: null }), 'send result');
        out.sent += 1;
      } catch (err) {
        const code = (err as { code?: string }).code;
        if (code === 'commit-rejected') await reject(c, CONNECT_SEND_REJECTION_TEXT.refused(kind, erpReason(err)));
        else if (code === 'command-held') {
          await check(sc.rpc('record_connect_send_held', { p_org_id: org.orgId, p_id: c.id }), 'send hold');
          out.held += 1;
        } else if (code === 'external-unreachable' || code === COMMAND_IN_FLIGHT_FOR_RECORD) out.pending += 1;
        else throw err;
      }
    } catch (err) {
      out.pending += 1;   // unknown trouble: the lease runs out and a later tick looks again; the first attempt's record is found, not duplicated
      out.error = `${c.kind}:${err instanceof Error ? err.message : String(err)}`;
    }
  }
  return out;
}
