import { supabase } from '@/src/lib/supabase/client';
import { fetchAllRowsByKeyset, mapBounded, type PageResult } from '@/src/lib/pagedRead';
import type { Tables } from '@/src/lib/supabase/database.types';

/** A canonical PMO company to ERP Customer document-name mapping, read under external_refs RLS. */
export interface CompanyCustomerRef {
  companyId: string;
  erpCustomerId: string;
}

type ExternalRefRow = Pick<Tables<'external_refs'>, 'id' | 'pmo_record_id' | 'external_record_id'>;

const INPUT_CHUNK_SIZE = 100;
const CUSTOMER_PREFIX = 'Customer:';
// DAL01-006/DAL03-007: the input chunks are independent (each has its own keyset cursor), so they
// fetch in parallel instead of paying one round trip per chunk serially. The bound keeps a huge
// company set from opening unbounded sockets; each chunk's keyset traversal stays sequential.
const CHUNK_CONCURRENCY = 4;

function uniqueNonBlank(values: readonly string[]): string[] {
  return [...new Set(values.filter((value) => value.trim().length > 0))].sort((left, right) => left.localeCompare(right));
}

function isExactErpCustomerId(value: string): boolean {
  return value.startsWith(CUSTOMER_PREFIX) && value.slice(CUSTOMER_PREFIX.length).trim().length > 0;
}

async function listRefsBy(column: 'pmo_record_id' | 'external_record_id', values: readonly string[], includeSuppliers = false): Promise<CompanyCustomerRef[]> {
  const matches = uniqueNonBlank(values);
  if (matches.length === 0) return [];

  const chunks: string[][] = [];
  for (let offset = 0; offset < matches.length; offset += INPUT_CHUNK_SIZE) {
    chunks.push(matches.slice(offset, offset + INPUT_CHUNK_SIZE));
  }

  // Bounded-concurrent chunks (DAL01-006); each chunk's keyset traversal stays sequential and the
  // flattened results keep input-chunk order, so the final dedupe + sort below are deterministic.
  const chunkRefs = await mapBounded(chunks, CHUNK_CONCURRENCY, async (chunk) => {
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

    const found: CompanyCustomerRef[] = [];
    for (const row of rows) {
      if (!isExactErpCustomerId(row.external_record_id) && !(includeSuppliers && /^Supplier:.+$/.test(row.external_record_id))) continue;
      found.push({ companyId: row.pmo_record_id, erpCustomerId: row.external_record_id });
    }
    return found;
  });
  const refs = chunkRefs.flat();

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

/** Visible company IDs with a Customer or Supplier mapping, scoped by RLS. */
export async function listCompanyPartyRefs(companyIds: readonly string[]): Promise<string[]> {
  const refs = await listRefsBy('pmo_record_id', companyIds, true);
  return [...new Set(refs.map((ref) => ref.companyId))].sort();
}
