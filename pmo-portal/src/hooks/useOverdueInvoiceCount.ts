import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/src/auth/useAuth';
import { useFxOrgDay } from '@/src/hooks/useFxOrgDay';
import { revenueRepository } from '@/src/lib/repositories/revenue';
import { MONEY_QUERY_OPTIONS } from '@/src/lib/queryPolicies';

/** Lightweight rail badge: one narrow invoice projection, with no payments or procurement tables. */
export function useOverdueInvoiceCount(enabled = true) {
  const orgId = useAuth().currentUser?.org_id;
  const orgDay = useFxOrgDay(enabled);
  return useQuery({
    queryKey: ['overdue-invoice-count', orgId, orgDay.day],
    queryFn: () => revenueRepository.countOverdueInvoices(orgDay.day!),
    enabled: Boolean(enabled && orgId && orgDay.day),
    ...MONEY_QUERY_OPTIONS,
  });
}
