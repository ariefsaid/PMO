// The ONE lookup of existing PMO companies an ERP party might already be (#1600) — used by the setup
// "bring in clients and vendors" step and by the change feed, so both match the same way.
import type { SupabaseClient } from '@supabase/supabase-js';
import { AppError } from '../../../pmo-portal/src/lib/appError.ts';
import { normalizePartyName, type PartyCandidate, type PartyDoctype } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/partyAdopt.ts';

/** Same-org, same-type, live companies whose name equals `name` once normalised (`normalizePartyName`) and that
 *  are not yet linked to an ERP party. A company already linked to another ERP record is never a candidate:
 *  linking would re-point it. An archived company is never a candidate: it is hidden from every picker.
 *  Two ERP parties with one name still link one and mint one: FR-ECA-011's review for that belongs to ECA-2. */
export async function findCompanyCandidates(client: SupabaseClient, orgId: string, doctype: PartyDoctype, name: string): Promise<PartyCandidate[]> {
  const wanted = normalizePartyName(name);
  // ponytail: SQL narrows by the longest word (case-insensitive), the normalised compare is exact in code; a
  // word split by punctuation inside the stored name ("A.C.M.E") is the ceiling. ECA-2's matcher can index it.
  const word = wanted.split(' ').sort((a, b) => b.length - a.length)[0] ?? '';
  if (!word) return [];
  const { data, error } = await client.from('companies').select('id, name, erp_tax_id')
    .eq('org_id', orgId).eq('type', doctype === 'Supplier' ? 'Vendor' : 'Client').is('archived_at', null)
    .ilike('name', `%${word.replace(/[\\%_]/g, '\\$&')}%`);
  if (error) throw new AppError(error.message, error.code);
  const rows = ((data ?? []) as Array<{ id: string; name: string; erp_tax_id: string | null }>)
    .filter((row) => normalizePartyName(row.name) === wanted);
  if (rows.length === 0) return [];
  const { data: linked, error: linkedError } = await client.from('external_refs').select('pmo_record_id')
    .eq('org_id', orgId).eq('domain', 'companies').in('pmo_record_id', rows.map((row) => row.id));
  if (linkedError) throw new AppError(linkedError.message, linkedError.code);
  const taken = new Set(((linked ?? []) as Array<{ pmo_record_id: string }>).map((row) => row.pmo_record_id));
  return rows.filter((row) => !taken.has(row.id)).map((row) => ({ pmoRecordId: row.id, taxId: row.erp_tax_id }));
}
