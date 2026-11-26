import React, { useMemo } from 'react';
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/src/auth/useAuth';
import { useToast } from '@/src/components/ui';
import { repositories } from '@/src/lib/repositories';
import { projectDisplayName, projectOptionSub } from '@/src/lib/projectDisplayName';
import { currencySymbol } from '@/src/lib/format';
import { useWorkOrderMutations } from '@/src/hooks/useWorkOrders';
import WorkOrderFormModal, { type WorkOrderProjectChoice } from '../project-detail/WorkOrderFormModal';

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

/**
 * Create a work order from the Work orders page (project chosen in the form) or from one project's Work orders tab
 * (`projectId`: preset and locked). Same form, same write; the new Draft opens on its own page, where its checks are
 * added and it is issued.
 */
export const NewWorkOrderModal: React.FC<{ projects: WorkOrderProjectChoice[]; projectId?: string; onClose: () => void }> = ({ projects, projectId, onClose }) => {
  const { t } = useTranslation('workOrders');
  const { toast } = useToast();
  const navigate = useNavigate();
  const { create } = useWorkOrderMutations('');
  const preset = useMemo(() => projects.find((p) => p.value === projectId), [projects, projectId]);

  return (
    <WorkOrderFormModal
      workOrder={null}
      currencySymbolPrefix={currencySymbol(preset?.currency ?? 'IDR')}
      onClose={onClose}
      project={{ options: projects, lockedId: preset?.value }}
      onCreate={async (input, chosen) => {
        const created = await create.mutateAsync({ input, projectId: chosen });
        toast(t('new.created', 'Draft work order created'), input.title, 'success');
        onClose();
        if (created?.id) navigate(`/work-orders/${created.id}`);
      }}
    />
  );
};
