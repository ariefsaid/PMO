// The ONE lookup of existing PMO companies an ERP party might already be (#1600) - used by the setup
// "bring in clients and vendors" step and by the change feed, so both match the same way.
import type { SupabaseClient } from '@supabase/supabase-js';
import { AppError } from '../../../pmo-portal/src/lib/appError.ts';
import { normalizePartyName, type PartyCandidate, type PartyDoctype } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/partyAdopt.ts';

type CompanyRow = { id: string; name: string; erp_tax_id: string | null };

/** Same-org, same-type, live companies the party might be that are not yet linked to an ERP party: those whose name equals
 *  `name` once normalised (`normalizePartyName`, legal-form suffixes dropped) and those carrying the same tax id (the shared
 *  matcher links on the tax id first, FR-ECA-011). A company already linked to another ERP record is never a candidate:
 *  linking would re-point it. An archived company is never a candidate: it is hidden from every picker. The matcher
 *  (`connect/match.ts`) decides among the candidates; two same-name candidates are a review row (FR-ECA-011). */
export async function findCompanyCandidates(client: SupabaseClient, orgId: string, doctype: PartyDoctype, name: string, taxId?: string | null): Promise<PartyCandidate[]> {
  const wanted = normalizePartyName(name);
  const type = doctype === 'Supplier' ? 'Vendor' : 'Client';
  const base = () => client.from('companies').select('id, name, erp_tax_id').eq('org_id', orgId).eq('type', type).is('archived_at', null);
  // ponytail: SQL narrows by the longest word (case-insensitive), the normalised compare is exact in code; a
  // word split by punctuation inside the stored name ("A.C.M.E") is the ceiling. The tax id is compared as stored.
  const word = wanted.split(' ').sort((a, b) => b.length - a.length)[0] ?? '';
  const byName = word ? await base().ilike('name', `%${word.replace(/[\\%_]/g, '\\$&')}%`) : { data: [], error: null };
  if (byName.error) throw new AppError(byName.error.message, byName.error.code);
  const byTax = taxId?.trim() ? await base().eq('erp_tax_id', taxId.trim()) : { data: [], error: null };
  if (byTax.error) throw new AppError(byTax.error.message, byTax.error.code);
  const found = new Map<string, CompanyRow>();
  for (const row of (byName.data ?? []) as CompanyRow[]) if (normalizePartyName(row.name) === wanted) found.set(row.id, row);
  for (const row of (byTax.data ?? []) as CompanyRow[]) found.set(row.id, row);
  const rows = [...found.values()];
  if (rows.length === 0) return [];
  const { data: linked, error: linkedError } = await client.from('external_refs').select('pmo_record_id')
    .eq('org_id', orgId).eq('domain', 'companies').in('pmo_record_id', rows.map((row) => row.id));
  if (linkedError) throw new AppError(linkedError.message, linkedError.code);
  const taken = new Set(((linked ?? []) as Array<{ pmo_record_id: string }>).map((row) => row.pmo_record_id));
  return rows.filter((row) => !taken.has(row.id)).map((row) => ({ pmoRecordId: row.id, taxId: row.erp_tax_id }));
}
