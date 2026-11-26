import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/src/auth/useAuth';
import { repositories } from '@/src/lib/repositories';
import { projectDisplayName, projectOptionSub } from '@/src/lib/projectDisplayName';
import type { ComboboxOption } from '@/src/components/ui';

/** A project a work order can be created on; `currency` sets the money prefix once it is chosen. */
export interface WorkOrderProjectChoice extends ComboboxOption {
  currency: string;
}

/**
 * The projects a work order can be created on: the delivery projects (on hand and internal, never a pipeline deal), as
 * the project's own Work orders tab is offered for exactly these. Row access is the same RLS the create runs under.
 */
export function useWorkOrderProjectChoices(enabled: boolean) {
  const orgId = useAuth().currentUser?.org_id;
  return useQuery<WorkOrderProjectChoice[]>({
    queryKey: ['wo-create-projects', orgId],
    queryFn: async () => (await repositories.project.list()).map((p) => ({
      value: p.id, label: projectDisplayName(p), sub: projectOptionSub(p), currency: p.currency,
    })),
    enabled: enabled && Boolean(orgId),
    staleTime: 5 * 60_000,
  });
}
