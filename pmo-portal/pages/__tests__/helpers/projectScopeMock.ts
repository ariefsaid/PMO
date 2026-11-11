// Shared stub for `@/src/hooks/useProjects` in tests that render the whole ProcurementDetails page.
// Usage, at the start of a line:
//   vi.mock('@/src/hooks/useProjects', () => import('@/pages/__tests__/helpers/projectScopeMock'));
// The page resolves the project's manager (Project Manager scope) through useProject. By default the
// signed-in user manages the project; set `projectScope.managerId` to model a PM who does not.
import { useAuth } from '@/src/auth/useAuth';

export const projectScope: { managerId?: string | null } = {};
export const useProject = () => {
  const { currentUser } = useAuth();
  const managerId = projectScope.managerId === undefined ? currentUser?.id : projectScope.managerId;
  return { data: { project_manager_id: managerId }, isPending: false, isError: false };
};
