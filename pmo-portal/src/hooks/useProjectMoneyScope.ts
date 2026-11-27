import { createContext, useContext } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/src/auth/useAuth';
import { useEffectiveRole } from '@/src/auth/impersonation';
import { useBuiltInRoleKey, usePermission } from '@/src/auth/usePermission';
import { moneyScoped, projectMoneyInScope } from '@/src/auth/policy';
import { repositories } from '@/src/lib/repositories';

/**
 * The project page's money scope (DD-R1125-14/15): false when a Project Manager opens a project that is not their own, so the
 * page reads like one the role has no money for. Outside a project page it is true and changes nothing.
 */
export const ProjectMoneyScopeContext = createContext(true);

/** Whether the signed-in person reads this project's money. The database decides; this mirrors it (project_money_in_scope). */
export function useProjectMoneyInScope(project: { id: string; project_manager_id?: string | null; deputy_manager_id?: string | null }): boolean {
  const { currentUser } = useAuth();
  const { realRole } = useEffectiveRole();
  const builtInRoleKey = useBuiltInRoleKey();
  const scoped = moneyScoped(realRole, builtInRoleKey);
  // Stand-ins: the database's own list, read once per session.
  const own = useQuery({
    queryKey: ['money-projects', currentUser?.id],
    queryFn: () => repositories.projectMoney.ownProjectIds(),
    enabled: scoped && Boolean(currentUser?.id),
    staleTime: 5 * 60_000,
  });
  return projectMoneyInScope(realRole, builtInRoleKey, currentUser?.id, project, own.data);
}

/** The money gate inside a project page: the role may see money, and the project is in the person's money scope. */
export function useMayViewProjectMoney(): boolean {
  const may = usePermission();
  const inScope = useContext(ProjectMoneyScopeContext);
  return may('view', 'salesInvoice') && inScope;
}
