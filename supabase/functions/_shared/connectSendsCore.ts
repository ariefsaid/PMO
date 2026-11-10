/**
 * The tier-neutral send drain (#1504 S8-T2): the claim / record / hold / reject loop for PMO masters an Admin accepted as "send"
 * (ECA3-T7, #1606, FR-ECA-020..022). Each tick leases a few waiting proposals, builds the master from the PMO row (never from the
 * proposal's snapshot), sends it through the money outbox under `seed:<kind>:<pmo id>` and records the outcome. A send nobody can
 * settle yet (ERP unreachable, another command in flight) records nothing: its lease runs out and a later tick looks again, finding
 * the first attempt's record instead of making another. A tier supplies only its connection, probe, reissue rule and error reason.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { sendMasterOnce, type SendKind } from '../../../pmo-portal/src/lib/adapterSeam/connect/sendViaOutbox.ts';
import type { ConnectAdapter, PmoMaster, PmoProjectCodeField } from '../../../pmo-portal/src/lib/adapterSeam/connect/types.ts';
import { COMMAND_IN_FLIGHT_FOR_RECORD } from '../../../pmo-portal/src/lib/adapterSeam/dispatch.ts';
import { EMPLOYEE_SEND_UNAVAILABLE_REASON } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/workflowDeclarations.ts';
import { createDbMoneyOutboxDeps } from '../adapter-dispatch/moneyOutboxDeps.ts';
import { openPurchaseStatuses } from './connectPmoMasters.ts';

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

interface Claimed { id: string; kind: string; pmo_ids: string[]; decided_by: string | null; snapshot: { auto?: boolean } | null }
export interface DrainResult { sent: number; rejected: number; held: number; pending: number; error?: string }

async function check<T>(q: PromiseLike<{ data: T; error: { code?: string } | null }>, what: string): Promise<T> {
  const { data, error } = await q;
  if (error) throw new Error(`${what} failed: ${error.code ?? 'unknown'}`);
  return data;
}

/** The master as PMO holds it now, scoped to the org; null when it is gone, archived, or (an item) no longer on an open purchase. */
export async function pmoMasterOf(sc: SupabaseClient, orgId: string, kind: SendKind, pmoId: string, openStatuses: () => Promise<string[]>,
  projectCodeField: PmoProjectCodeField = 'code'): Promise<PmoMaster | null> {
  if (kind === 'party') {
    const r = await check(sc.from('companies').select('id, name, type, erp_tax_id').eq('org_id', orgId).eq('id', pmoId)
      .in('type', ['Client', 'Vendor']).is('archived_at', null).maybeSingle(), 'company read') as { id: string; name: string; type: string; erp_tax_id: string | null } | null;
    return r ? { id: r.id, name: r.name, role: r.type === 'Client' ? 'client' : 'vendor', taxId: r.erp_tax_id } : null;
  }
  if (kind === 'project') {
    // the field the ERP's project code matches on (FR-ODC-072: Odoo names the account with the PMO project number, not the client code)
    const r = await check(sc.from('projects').select(`id, name, ${projectCodeField}`).eq('org_id', orgId).eq('id', pmoId).is('archived_at', null).maybeSingle(), 'project read') as Record<string, string | null> | null;
    return r ? { id: r.id as string, name: r.name as string, code: r[projectCodeField] ?? null } : null;
  }
  if (kind === 'item') {
    // #1736: the same definition the queue calls (connect_open_purchase_statuses, 0703) — never a second list here
    const rows = await check(sc.from('procurement_items').select('id, procurements!inner(status)').eq('org_id', orgId).eq('name', pmoId)
      .in('procurements.status', await openStatuses()).limit(1), 'item read') as unknown[];
    return rows.length > 0 ? { id: pmoId, name: pmoId, code: pmoId } : null;
  }
  return null;
}

/** M7: the accepting Admin still holds the role when the send goes out (a demoted or deactivated Admin's queued sends do not). */
export async function actorIsAdmin(sc: SupabaseClient, orgId: string, userId: string | null): Promise<boolean> {
  if (!userId) return false;
  const r = await check(sc.from('profiles').select('id').eq('org_id', orgId).eq('id', userId).eq('role', 'Admin').eq('status', 'active').maybeSingle(), 'actor read');
  return r !== null;
}

/** What a tier plugs into the loop. `open` resolves the connection only when something was claimed; a refusal keeps every claimed row pending. */
export interface SendTier {
  tier: string;
  open(): Promise<{ connect: ConnectAdapter; probe(kind: SendKind, master: PmoMaster): Promise<{ externalRecordId: string } | null> } | { refusal: string }>;
  /** True when a probe miss proves the create never landed, so the send may be issued again. */
  reissueOnInconclusiveAbsence(kind: SendKind): boolean;
  /** Short plain-words reason from a refusal, or null. */
  reasonOf(err: unknown): string | null;
  /** Plain words when this tier cannot send a record of this kind right now (checked before anything is written); null when it can. */
  refuse?(kind: SendKind, master: PmoMaster): string | null;
  /** Runs after the ERP confirmed a send and before PMO links it (the Odoo project link needs the new account mirrored first). A failure leaves the send waiting: the next look finds the confirmed outbox row and runs this again. */
  afterSent?(kind: SendKind, master: PmoMaster, externalId: string): Promise<void>;
  /** Why this ERP cannot be sent a person; defaults to the ERPNext sentence. */
  personText?: string;
}

export async function drainSends(sc: SupabaseClient, org: { orgId: string; bindingId?: string | null }, t: SendTier, budget = CONNECT_SENDS_PER_TICK,
  clock: { nowMs: () => number; budgetMs: number } = { nowMs: Date.now, budgetMs: CONNECT_SENDS_BUDGET_MS }): Promise<DrainResult> {
  const out: DrainResult = { sent: 0, rejected: 0, held: 0, pending: 0 };
  if (!org.bindingId) return out;
  // ECA3-T12 (FR-ECA-016): after setup a new item on an open purchase is queued here, then claimed below like any accepted send. A failure here
  // is reported and must not hold back the sends already waiting.
  let queueError: string | undefined;
  try { await check(sc.rpc('enqueue_new_item_sends', { p_org_id: org.orgId, p_tier: t.tier }), 'send queue'); }
  catch (err) { queueError = `enqueue:${err instanceof Error ? err.message : String(err)}`; }
  if (queueError) out.error = queueError;
  const claimed = await check(sc.rpc('claim_connect_sends', { p_org_id: org.orgId, p_tier: t.tier, p_limit: budget }), 'send claim') as Claimed[];
  if (claimed.length === 0) return out;

  const conn = await t.open();
  if ('refusal' in conn) return { ...out, pending: claimed.length, error: `connection:${conn.refusal}` };
  const adapter = conn.connect;
  const deadline = clock.nowMs() + clock.budgetMs;
  // #1736: the open-purchase definition is read once per tick and shared by every item in it; a failed read surfaces as that send's own
  // failure, never as a tick that cannot start.
  let openStatuses: Promise<string[]> | null = null;
  const statuses = () => (openStatuses ??= openPurchaseStatuses(sc));

  const record = async (c: Claimed, externalId: string | null, text: string | null) => {
    await check(sc.rpc('record_connect_send_result', { p_org_id: org.orgId, p_id: c.id, p_external_id: externalId, p_rejection: text }), 'send result');
    if (text === null) out.sent += 1; else out.rejected += 1;
  };
  const reject = (c: Claimed, text: string) => record(c, null, text);
  // Anything unknown is counted and ends as a review row after five ticks (I1 of 0494); until then a later tick looks again
  const countFailure = async (c: Claimed) => {
    try {
      if (await check(sc.rpc('record_connect_send_failure', { p_org_id: org.orgId, p_id: c.id }), 'send failure') === true) out.rejected += 1;
      else out.pending += 1;
    } catch {
      out.pending += 1;
    }
  };
  let stopped = false;   // a dead ERP or a spent budget ends the tick: what is left keeps its lease and a later tick looks again
  for (const c of claimed) {
    if (stopped || clock.nowMs() >= deadline) { stopped = true; out.pending += 1; continue; }
    try {
      if (c.kind === 'employee') { await reject(c, t.personText ?? CONNECT_SEND_REJECTION_TEXT.person); continue; }   // ERPNext requires personal details PMO does not hold
      if (c.kind !== 'party' && c.kind !== 'project' && c.kind !== 'item') { await reject(c, CONNECT_SEND_REJECTION_TEXT.refused(c.kind, null)); continue; }
      const kind: SendKind = c.kind;
      // C1: a record that already has its link is never sent again (a second send makes a second ERP record); the result writer treats the same id as reconciled
      const linked = await check(sc.rpc('connect_send_existing_link', { p_org_id: org.orgId, p_tier: t.tier, p_kind: kind, p_pmo: c.pmo_ids[0] }), 'link read') as string | null;
      if (linked) { await record(c, linked, null); continue; }
      const master = await pmoMasterOf(sc, org.orgId, kind, c.pmo_ids[0], statuses, adapter.projectCodeField);
      if (!master) { await reject(c, CONNECT_SEND_REJECTION_TEXT.gone); continue; }
      // a send the sweep queued itself (T12) has no accepting Admin; every other send still needs the Admin to hold the role
      const queuedBySweep = c.kind === 'item' && c.decided_by === null && c.snapshot?.auto === true;
      if (!queuedBySweep && !(await actorIsAdmin(sc, org.orgId, c.decided_by))) { await reject(c, CONNECT_SEND_REJECTION_TEXT.actor); continue; }
      const refusal = t.refuse?.(kind, master) ?? null;
      if (refusal) { await reject(c, refusal); continue; }
      let ambiguous = false;
      const money = createDbMoneyOutboxDeps({
        serviceClient: sc as never, orgId: org.orgId, externalTier: t.tier, operation: 'create',
        probeByRemarksKey: async () => {
          try { return await conn.probe(kind, master); }
          catch (err) { ambiguous = (err as { code?: string }).code === 'commit-rejected'; throw err; }   // two ERP records answer: a fact, not an unknown
        },
        reissueOnInconclusiveAbsence: t.reissueOnInconclusiveAbsence(kind),
        actorUserId: c.decided_by ?? undefined,
      });
      try {
        const done = await sendMasterOnce({ money }, adapter, kind, master);
        if (t.afterSent) {
          try { await t.afterSent(kind, master, done.externalRecordId); }
          catch { await countFailure(c); continue; }   // the ERP record is confirmed, so a later try adopts it; the mirror must not retry for ever
        }
        await record(c, done.externalRecordId, null);
      } catch (err) {
        const code = (err as { code?: string }).code;
        if (code === 'commit-rejected') await reject(c, CONNECT_SEND_REJECTION_TEXT.refused(kind, t.reasonOf(err)));
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
      out.error = [out.error, `${c.kind}:${msg}`].filter(Boolean).join('; ');
      // I1: a link clash (the ERP record belongs to another PMO record) can never succeed by trying again: it ends as a decision in plain words.
      if (/\b23505\b/.test(msg)) {
        try { await reject(c, CONNECT_SEND_REJECTION_TEXT.linked); } catch { out.pending += 1; }
      } else await countFailure(c);
    }
  }
  return out;
}
