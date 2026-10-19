import { supabase } from '@/src/lib/supabase/client';
import { fetchAllRowsByKeyset, type PageResult } from '@/src/lib/pagedRead';
import type { Tables } from '@/src/lib/supabase/database.types';

/** A canonical PMO company to ERP Customer document-name mapping, read under external_refs RLS. */
export interface CompanyCustomerRef {
  companyId: string;
  erpCustomerId: string;
}

type ExternalRefRow = Pick<Tables<'external_refs'>, 'id' | 'pmo_record_id' | 'external_record_id'>;

const INPUT_CHUNK_SIZE = 100;
const CUSTOMER_PREFIX = 'Customer:';

function uniqueNonBlank(values: readonly string[]): string[] {
  return [...new Set(values.filter((value) => value.trim().length > 0))].sort((left, right) => left.localeCompare(right));
}

function isExactErpCustomerId(value: string): boolean {
  return value.startsWith(CUSTOMER_PREFIX) && value.slice(CUSTOMER_PREFIX.length).trim().length > 0;
}

async function listRefsBy(column: 'pmo_record_id' | 'external_record_id', values: readonly string[]): Promise<CompanyCustomerRef[]> {
  const matches = uniqueNonBlank(values);
  if (matches.length === 0) return [];

  const refs: CompanyCustomerRef[] = [];
  for (let offset = 0; offset < matches.length; offset += INPUT_CHUNK_SIZE) {
    const chunk = matches.slice(offset, offset + INPUT_CHUNK_SIZE);
    const rows = await fetchAllRowsByKeyset<ExternalRefRow>((afterId, limit) => {
      let query = supabase
        .from('external_refs')
        .select('id,pmo_record_id,external_record_id')
        .eq('domain', 'companies')
        .eq('external_tier', 'erpnext')
        .in(column, chunk)
        .order('id', { ascending: true });
      if (afterId !== null) query = query.gt('id', afterId);
      return query.limit(limit) as unknown as PromiseLike<PageResult<ExternalRefRow>>;
    });

    for (const row of rows) {
      if (!isExactErpCustomerId(row.external_record_id)) continue;
      refs.push({ companyId: row.pmo_record_id, erpCustomerId: row.external_record_id });
    }
  }

  const uniqueRefs = new Map<string, CompanyCustomerRef>();
  for (const ref of refs) uniqueRefs.set(`${ref.companyId}\u0000${ref.erpCustomerId}`, ref);
  return [...uniqueRefs.values()].sort((left, right) =>
    left.erpCustomerId.localeCompare(right.erpCustomerId) || left.companyId.localeCompare(right.companyId),
  );
}

/** Batch-load mappings for visible company IDs. RLS supplies org scope; the client sends no org ID. */
export function listCompanyCustomerRefs(companyIds: readonly string[]): Promise<CompanyCustomerRef[]> {
  return listRefsBy('pmo_record_id', companyIds);
}

/** Batch-load mappings for exact ERP Customer document IDs from an aging snapshot. */
export function listCompanyCustomerRefsByErpCustomerIds(erpCustomerIds: readonly string[]): Promise<CompanyCustomerRef[]> {
  return listRefsBy('external_record_id', erpCustomerIds.filter(isExactErpCustomerId));
}
