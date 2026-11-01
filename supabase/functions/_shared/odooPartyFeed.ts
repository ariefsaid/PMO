/**
 * The Odoo partner feed match (#1504 S6-T5, FR-ECA-014/016): a partner the sweep has just mirrored runs through the shared
 * matcher. Once the Admin has accepted the party kind (PD-ECA-15), a clean outcome applies without a person (link, or bring
 * in); a doubtful pair, or a link the database refuses, becomes a review row. Before that first accept the setup run owns
 * the decision, so nothing is applied and a partner seen in the meantime waits for the next setup run.
 *
 * Runs after `apply_odoo_master_page` has committed the page, so it never throws: a failure is logged by class and the next
 * overlap read repeats the decision, which the database applies exactly once (`external_refs` uniqueness).
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { proposeMatches, reviewReasonText } from '../../../pmo-portal/src/lib/adapterSeam/connect/match.ts';
import type { NormalisedMaster, PmoMaster } from '../../../pmo-portal/src/lib/adapterSeam/connect/types.ts';
import type { DirectoryRow } from '../../../pmo-portal/src/lib/adapterSeam/odoo/kinds.ts';
import { normaliseParty } from '../../../pmo-portal/src/lib/adapterSeam/odoo/normalise.ts';
import { findCompanyCandidates } from './companyCandidates.ts';

const TIER = 'odoo';
const DOCTYPE = { vendor: 'Supplier', client: 'Customer' } as const;
const CHUNK = 100;

async function check<T>(q: PromiseLike<{ data: T; error: { code?: string } | null }>): Promise<T> {
  const { data, error } = await q;
  if (error) throw new Error(`read failed: ${error.code ?? 'unknown'}`);
  return data;
}

/** The mirrored partner row in the shape `normaliseParty` reads. */
const rawPartner = (r: DirectoryRow) => ({
  id: Number(r.external_id), name: r.name, vat: r.attrs.vat ?? false, ref: r.code ?? false, is_company: r.attrs.is_company === true,
  parent_id: r.parent_external_id === null ? false : [Number(r.parent_external_id), ''], active: r.active,
  supplier_rank: r.attrs.supplier_rank, customer_rank: r.attrs.customer_rank,
});

const accepted = async (sc: SupabaseClient, orgId: string) =>
  (await check(sc.from('erp_connect_census').select('accepted_at').eq('org_id', orgId).eq('external_tier', TIER).eq('kind', 'party').maybeSingle()) as { accepted_at: string | null } | null)?.accepted_at != null;

/** A company's partner carries the company's name, and the mirror holds the database's companies: PMO's own organisation is never brought in. */
async function ownNames(sc: SupabaseClient, orgId: string): Promise<Set<string>> {
  const rows = await check(sc.from('external_master_records').select('name').eq('org_id', orgId).eq('external_tier', TIER).eq('kind', 'company')) as Array<{ name: string }>;
  return new Set(rows.map((r) => r.name.toLowerCase()));
}

async function withoutRef(sc: SupabaseClient, orgId: string, parties: NormalisedMaster[]): Promise<NormalisedMaster[]> {
  const known = new Set<string>();
  for (let i = 0; i < parties.length; i += CHUNK) {
    const ids = parties.slice(i, i + CHUNK).map((p) => p.externalId);
    const refs = await check(sc.from('external_refs').select('external_record_id').eq('org_id', orgId).eq('domain', 'companies').in('external_record_id', ids)) as Array<{ external_record_id: string }>;
    for (const r of refs) known.add(r.external_record_id);
  }
  return parties.filter((p) => !known.has(p.externalId));
}

async function candidatesFor(sc: SupabaseClient, orgId: string, parties: NormalisedMaster[]): Promise<PmoMaster[]> {
  const found = new Map<string, PmoMaster>();
  for (const p of parties) {
    for (const c of await findCompanyCandidates(sc, orgId, DOCTYPE[p.role!], p.name, p.taxId)) {
      found.set(c.pmoRecordId, { id: c.pmoRecordId, name: '', role: p.role, taxId: c.taxId });
    }
  }
  const ids = [...found.keys()];
  for (let i = 0; i < ids.length; i += CHUNK) {
    const names = await check(sc.from('companies').select('id, name').eq('org_id', orgId).in('id', ids.slice(i, i + CHUNK))) as Array<{ id: string; name: string }>;
    for (const n of names) found.set(n.id, { ...found.get(n.id)!, name: n.name });
  }
  return [...found.values()];
}

async function review(sc: SupabaseClient, orgId: string, pmoIds: string[], externalIds: string[], reason: 'ambiguous' | 'tax-conflict') {
  const { error } = await sc.rpc('record_connect_review', {
    p_org_id: orgId, p_tier: TIER, p_kind: 'party', p_pmo_ids: pmoIds, p_external_ids: externalIds, p_reason: reason,
    p_reason_text: reviewReasonText('party', { reason, pmoIds, externalIds }),
  });
  if (error) console.error('record_connect_review failed', error.code ?? 'unknown');
}

export async function matchNewPartners(sc: SupabaseClient, orgId: string, rows: DirectoryRow[]): Promise<void> {
  try {
    const mine = rows.flatMap((r) => normaliseParty(rawPartner(r))).filter((p) => p.role !== undefined && p.active);
    if (mine.length === 0 || !(await accepted(sc, orgId))) return;
    const own = await ownNames(sc, orgId);
    const fresh = await withoutRef(sc, orgId, mine.filter((p) => !own.has(p.name.toLowerCase())));
    if (fresh.length === 0) return;
    const byId = new Map(fresh.map((p) => [p.externalId, p]));
    const snapshot = (id: string) => { const p = byId.get(id)!; return { name: p.name, taxId: p.taxId ?? null, code: p.code ?? null, role: p.role }; };
    for (const o of proposeMatches('party', await candidatesFor(sc, orgId, fresh), fresh)) {
      try {
        if (o.outcome === 'review') { await review(sc, orgId, o.pmoIds, o.externalIds, o.reason === 'tax-conflict' ? 'tax-conflict' : 'ambiguous'); continue; }
        if (o.outcome === 'send') continue;   // a PMO-only company is the setup run's to send, not the feed's
        const { data, error } = await sc.rpc('apply_connect_outcome', {
          p_org_id: orgId, p_tier: TIER, p_kind: 'party', p_outcome: o.outcome, p_pmo_id: o.outcome === 'link' ? o.pmoId : null, p_external_id: o.externalId,
          p_snapshot: o.outcome === 'link' ? { ...snapshot(o.externalId), matchKey: o.key } : snapshot(o.externalId),
        });
        if (error) throw new Error(error.code ?? 'unknown');
        // A link the database refuses (the company already has another partner) needs a person; an incomplete bring-in is left for the next setup run.
        if (typeof data === 'string' && o.outcome === 'link') await review(sc, orgId, [o.pmoId], [o.externalId], 'ambiguous');
      } catch (err) {
        console.error('odoo party feed: one partner failed', err instanceof Error ? err.message.slice(0, 40) : 'unknown');
      }
    }
  } catch (err) {
    console.error('odoo party feed failed', err instanceof Error ? err.message.slice(0, 40) : 'unknown');
  }
}
