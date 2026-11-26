import React, { useMemo } from 'react';
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useToast } from '@/src/components/ui';
import { currencySymbol } from '@/src/lib/format';
import { useWorkOrderMutations } from '@/src/hooks/useWorkOrders';
import WorkOrderFormModal from '../project-detail/WorkOrderFormModal';
import type { WorkOrderProjectChoice } from '@/src/hooks/useWorkOrderProjectChoices';

/**
 * Create a work order from the Work orders page (project chosen in the form) or from one project's Work orders tab
 * (`projectId`: preset and locked). Same form, same write; the new Draft opens on its own page, where its checks are
 * added and it is issued.
 */
export const NewWorkOrderModal: React.FC<{ projects: WorkOrderProjectChoice[]; projectId?: string; onClose: () => void }> = ({ projects, projectId, onClose }) => {
  const { t } = useTranslation('project');
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
        toast(t('projectDetail.workOrders.toast.created', 'Draft work order created'), input.title, 'success');
        onClose();
        if (created?.id) navigate(`/work-orders/${created.id}`);
      }}
    />
  );
};
