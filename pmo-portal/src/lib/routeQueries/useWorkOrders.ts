import { repositories } from '../repositories';
import type { Profile } from '@/src/auth/AuthContext';

export const projectWorkOrdersQuery = (user: ProjectOrdersViewer | null | undefined, projectId: string) => ({
  queryKey: ['work-orders', user?.org_id, projectId, user?.id, user?.role, user?.manager_id],
  queryFn: () => repositories.workOrder.list(projectId),
  enabled: Boolean(user?.org_id) && Boolean(projectId),
});

export type ProjectOrdersViewer = Pick<Profile, 'org_id' | 'id' | 'role' | 'manager_id'>;
