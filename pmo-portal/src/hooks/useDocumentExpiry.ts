import { useQuery } from '@tanstack/react-query';
import { repositories } from '@/src/lib/repositories';
import { useAuth } from '@/src/auth/useAuth';
import { EXPIRY_WINDOW_DAYS } from '@/src/lib/db/documentExpiry';

/** The expiry list (#2527) over the repository seam; the key carries org_id (tenant scope). */
export function useExpiringDocuments(days: number = EXPIRY_WINDOW_DAYS) {
  const orgId = useAuth().currentUser?.org_id;
  return useQuery({
    queryKey: ['document-expiry', orgId, days],
    queryFn: () => repositories.documentExpiry.listExpiring(days),
    enabled: Boolean(orgId),
  });
}
