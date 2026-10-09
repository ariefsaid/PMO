import { useQuery } from '@tanstack/react-query';
import { repositories } from '@/src/lib/repositories';
import { useAuth } from '@/src/auth/useAuth';

export function useProjectVatEditability(projectId: string) {
  const { currentUser } = useAuth();
  const orgId = currentUser?.org_id;
  return useQuery({
    queryKey: ['project-vat-editability', orgId, projectId],
    queryFn: () => repositories.project.getVatEditability(projectId),
    enabled: Boolean(orgId && projectId),
  });
}
