import { toAppError } from '@/src/lib/appError';
import type { ErpAgingSnapshotRow } from '@/src/lib/db/erpSnapshots';
import {
  listCompanyCustomerRefs,
  listCompanyCustomerRefsByErpCustomerIds,
  type CompanyCustomerRef,
} from '@/src/lib/db/companyCollections';

export interface CompanyCollectionsComposition {
  state: 'known' | 'unavailable' | 'ambiguous';
  positions: ErpAgingSnapshotRow[];
}

export const companyCollectionsRepository = {
  async listForCompanies(companyIds: readonly string[]): Promise<CompanyCustomerRef[]> {
    try {
      return await listCompanyCustomerRefs(companyIds);
    } catch (error) {
      throw toAppError(error);
    }
  },
  async listForErpCustomerIds(erpCustomerIds: readonly string[]): Promise<CompanyCustomerRef[]> {
    try {
      return await listCompanyCustomerRefsByErpCustomerIds(erpCustomerIds);
    } catch (error) {
      throw toAppError(error);
    }
  },
};

export function composeCompanyCollections(
  rows: readonly ErpAgingSnapshotRow[],
  refs: readonly CompanyCustomerRef[],
  companyId: string,
): CompanyCollectionsComposition {
  const customerIds = new Set(
    refs
      .filter((ref) => ref.companyId === companyId && ref.erpCustomerId.startsWith('Customer:') && ref.erpCustomerId.slice('Customer:'.length).trim().length > 0)
      .map((ref) => ref.erpCustomerId),
  );
  if (customerIds.size === 0) return { state: 'unavailable', positions: [] };

  const positions = rows.filter((row) => row.partyType === 'Customer' && row.party !== null && customerIds.has(row.party));
  if (positions.length === 0) return { state: 'unavailable', positions: [] };

  const companiesByCustomerId = new Map<string, Set<string>>();
  for (const ref of refs) {
    if (!customerIds.has(ref.erpCustomerId)) continue;
    const companies = companiesByCustomerId.get(ref.erpCustomerId) ?? new Set<string>();
    companies.add(ref.companyId);
    companiesByCustomerId.set(ref.erpCustomerId, companies);
  }
  const ambiguous = positions.some((row) => row.party !== null && (companiesByCustomerId.get(row.party)?.size ?? 0) > 1);
  return { state: ambiguous ? 'ambiguous' : 'known', positions: [...positions] };
}

export function customerLinksForVisibleCompanies(
  refs: readonly CompanyCustomerRef[],
  visibleCompanyIds: readonly string[],
): ReadonlyMap<string, string> {
  const visible = new Set(visibleCompanyIds);
  const companiesByCustomerId = new Map<string, Set<string>>();
  for (const ref of refs) {
    if (!ref.erpCustomerId.startsWith('Customer:') || ref.erpCustomerId.slice('Customer:'.length).trim().length === 0) continue;
    const companies = companiesByCustomerId.get(ref.erpCustomerId) ?? new Set<string>();
    companies.add(ref.companyId);
    companiesByCustomerId.set(ref.erpCustomerId, companies);
  }

  const links = new Map<string, string>();
  for (const [erpCustomerId, companies] of companiesByCustomerId) {
    const [companyId] = [...companies];
    if (companies.size === 1 && companyId !== undefined && visible.has(companyId)) links.set(erpCustomerId, companyId);
  }
  return links;
}
