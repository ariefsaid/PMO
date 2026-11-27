import { repositories } from '../repositories';
import { projectKeys } from '@/src/hooks/projectQueryKeys';

export const projectQuery = (orgId: string | undefined, id: string | undefined) => ({
  queryKey: projectKeys.detail(orgId, id),
  queryFn: () => repositories.project.getWithRefs(id!),
  enabled: Boolean(orgId && id),
});
