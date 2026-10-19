import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/src/auth/useAuth';
import { usePermission } from '@/src/auth/usePermission';
import { repositories } from '@/src/lib/repositories';
import type { CompanyCustomerRef } from '@/src/lib/db/companyCollections';
import type { ErpAgingSnapshotRow } from '@/src/lib/db/erpSnapshots';
import {
  composeCompanyCollections,
  customerLinksForVisibleCompanies,
  type CompanyCollectionsComposition,
} from '@/src/lib/repositories/companyCollections';
import { useArAgingSnapshot } from './useErpSnapshots';

const EMPTY_AGING_ROWS: ErpAgingSnapshotRow[] = [];
const EMPTY_CUSTOMER_REFS: CompanyCustomerRef[] = [];

export interface CompanyCollectionsHookResult {
  rows: ErpAgingSnapshotRow[];
  refsBySnapshotCustomer: CompanyCustomerRef[];
  byCompany: ReadonlyMap<string, CompanyCollectionsComposition>;
  customerLinks: ReadonlyMap<string, string>;
  isEnabled: boolean;
  isPending: boolean;
  isError: boolean;
  error: unknown;
  refetch: () => Promise<void>;
}

function exactCustomerIds(rows: readonly ErpAgingSnapshotRow[]): string[] {
  return [...new Set(rows
    .filter((row) => row.partyType === 'Customer' && typeof row.party === 'string'
      && row.party.startsWith('Customer:') && row.party.slice('Customer:'.length).trim().length > 0)
    .map((row) => row.party!))].sort((left, right) => left.localeCompare(right));
}

/**
 * Read-only collections composition. It reuses the established org-scoped AR snapshot query and
 * batches exact canonical Customer references; no company-name join or per-row lookup is performed.
 */
export function useCompanyCollections(
  companyIds: readonly string[],
  options?: { enabled?: boolean },
): CompanyCollectionsHookResult {
  const { currentUser } = useAuth();
  const may = usePermission();
  const orgId = currentUser?.org_id;
  const sortedCompanyIds = useMemo(
    () => [...new Set(companyIds.filter((id) => id.trim().length > 0))].sort((left, right) => left.localeCompare(right)),
    [companyIds],
  );
  const isEnabled = Boolean(orgId) && may('view', 'salesInvoice') && options?.enabled !== false;

  const arAging = useArAgingSnapshot({ enabled: isEnabled });
  const rows = arAging.data ?? EMPTY_AGING_ROWS;
  const erpCustomerIds = useMemo(() => exactCustomerIds(rows), [rows]);

  const refsBySnapshotCustomerQuery = useQuery({
    queryKey: ['uxs36', 'company-customer-ref-parties', orgId, erpCustomerIds],
    queryFn: () => repositories.companyCollections.listForErpCustomerIds(erpCustomerIds),
    enabled: isEnabled && !arAging.isPending && !arAging.isError && erpCustomerIds.length > 0,
  });

  const refsBySnapshotCustomer = refsBySnapshotCustomerQuery.data ?? EMPTY_CUSTOMER_REFS;
  const byCompany = useMemo(() => new Map(sortedCompanyIds.map((companyId) => [
    companyId,
    composeCompanyCollections(rows, refsBySnapshotCustomer, companyId),
  ])), [refsBySnapshotCustomer, rows, sortedCompanyIds]);
  const customerLinks = useMemo(
    () => customerLinksForVisibleCompanies(refsBySnapshotCustomer, sortedCompanyIds),
    [refsBySnapshotCustomer, sortedCompanyIds],
  );

  const hasPartyRefQuery = isEnabled && !arAging.isPending && !arAging.isError && erpCustomerIds.length > 0;
  const isPending = isEnabled && (
    arAging.isPending
    || (hasPartyRefQuery && refsBySnapshotCustomerQuery.isPending)
  );
  const isError = isEnabled && (
    arAging.isError
    || (hasPartyRefQuery && refsBySnapshotCustomerQuery.isError)
  );
  const error = arAging.error
    ?? (hasPartyRefQuery ? refsBySnapshotCustomerQuery.error : null)
    ?? null;

  const refetch = async () => {
    if (!isEnabled) return;
    const pendingRefetches: Promise<unknown>[] = [arAging.refetch()];
    if (erpCustomerIds.length > 0) pendingRefetches.push(refsBySnapshotCustomerQuery.refetch());
    await Promise.all(pendingRefetches);
  };

  return {
    rows,
    refsBySnapshotCustomer,
    byCompany,
    customerLinks,
    isEnabled,
    isPending,
    isError,
    error,
    refetch,
  };
}
