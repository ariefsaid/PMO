import { useContext, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AuthContext } from '@/src/auth/AuthContext';
import { repositories } from '@/src/lib/repositories';
import { queryClient } from '@/src/lib/queryClient';
import { vendorTaxDefaultOf, type VendorTaxDefault } from '@/src/lib/vendorWithholding';

/**
 * #876 slice 2 (OD-VWH-1) — the procurement vendor's default tax treatment, for PRE-FILLING a new bill only
 * (DD-VWH-19: no write path reads it). Shares `useCompany`'s cache key, so saving the defaults on the company page
 * refreshes an open bill form. Null while unknown, on a read failure, or when the vendor states no default — the
 * form then pre-fills nothing (unknown is never guessed).
 */
export function useVendorTaxDefault(vendorId: string | null | undefined): VendorTaxDefault | null {
  const orgId = useContext(AuthContext)?.currentUser?.org_id;
  const query = useQuery(
    {
      queryKey: ['company', orgId, vendorId],
      queryFn: () => repositories.company.get(vendorId as string),
      enabled: Boolean(vendorId),
      staleTime: 30_000,
      retry: false,
    },
    queryClient,
  );
  return useMemo(() => vendorTaxDefaultOf(query.data), [query.data]);
}
