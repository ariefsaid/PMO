import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/src/auth/useAuth';
import { usePermission } from '@/src/auth/usePermission';
import { repositories } from '@/src/lib/repositories';

export function useProjectFinances(projectId: string, options?: { enabled?: boolean }) {
  const { currentUser } = useAuth();
  const may = usePermission();
  const orgId = currentUser?.org_id;
  return useQuery({
    queryKey: ['project-finances', orgId, projectId],
    queryFn: () => repositories.revenue.getProjectFinances(projectId),
    enabled: Boolean(orgId && projectId) && may('view', 'salesInvoice') && options?.enabled !== false,
  });
}
