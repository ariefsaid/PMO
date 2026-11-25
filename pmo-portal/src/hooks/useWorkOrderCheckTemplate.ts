import { useMutation, useQueryClient } from '@tanstack/react-query';
import { repositories } from '@/src/lib/repositories';
import type { CheckTemplateInput } from '@/src/lib/db/workOrderCheckTemplate';
import { useOrgId } from '@/src/hooks/useOrgId';
import { useOrgQuery } from '@/src/hooks/useOrgQuery';

/** #2898 the standard checks copied onto each new Draft work order; org-scoped keys. */
export function useWorkOrderCheckTemplate() {
  return useOrgQuery(['workOrderCheckTemplate'], () => repositories.workOrderCheckTemplate.list());
}

export function useSaveWorkOrderCheckTemplate() {
  const orgId = useOrgId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (items: CheckTemplateInput[]) => repositories.workOrderCheckTemplate.save(items),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['workOrderCheckTemplate', orgId] }),
  });
}
