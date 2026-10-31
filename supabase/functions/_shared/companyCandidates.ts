// The ONE lookup of existing PMO companies an ERP party might already be (#1600) — used by the setup
// "bring in clients and vendors" step and by the change feed, so both match the same way.
import type { SupabaseClient } from '@supabase/supabase-js';
import { AppError } from '../../../pmo-portal/src/lib/appError.ts';
import type { PartyCandidate, PartyDoctype } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/partyAdopt.ts';

/** Same-org, same-type, same-name companies that are not yet linked to an ERP party. A company already
 *  linked to another ERP record is never a candidate: linking would re-point it. */
export async function findCompanyCandidates(client: SupabaseClient, orgId: string, doctype: PartyDoctype, name: string): Promise<PartyCandidate[]> {
  const { data, error } = await client.from('companies').select('id, erp_tax_id')
    .eq('org_id', orgId).eq('type', doctype === 'Supplier' ? 'Vendor' : 'Client').eq('name', name);
  if (error) throw new AppError(error.message, error.code);
  const rows = (data ?? []) as Array<{ id: string; erp_tax_id: string | null }>;
  if (rows.length === 0) return [];
  const { data: linked, error: linkedError } = await client.from('external_refs').select('pmo_record_id')
    .eq('org_id', orgId).eq('domain', 'companies').in('pmo_record_id', rows.map((row) => row.id));
  if (linkedError) throw new AppError(linkedError.message, linkedError.code);
  const taken = new Set(((linked ?? []) as Array<{ pmo_record_id: string }>).map((row) => row.pmo_record_id));
  return rows.filter((row) => !taken.has(row.id)).map((row) => ({ pmoRecordId: row.id, taxId: row.erp_tax_id }));
}
