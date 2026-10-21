import React, { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router';
import ProjectFormModal from '../components/ProjectFormModal';
import { AccessDenied, ConfirmDialog, useToast } from '@/src/components/ui';
import { usePermission } from '@/src/auth/usePermission';
import { useProjectMutations } from '@/src/hooks/useProjects';
import { useListReturn } from '@/src/hooks/useListReturn';
import { useUnsavedChangesGuard } from '@/src/hooks/useUnsavedChangesGuard';
import { classifyMutationError } from '@/src/lib/classifyMutationError';

/**
 * One-step project create (#806): the whole header is editable on a page that looks like the
 * detail page. Nothing is written until Save; Save replaces this entry with the saved record
 * (keeping the list-return state, so Back returns to the originating list view).
 */
const ProjectNew: React.FC = () => {
  const { t } = useTranslation();
  const { toast } = useToast();
  const may = usePermission();
  const navigate = useNavigate();
  const location = useLocation();
  const { create } = useProjectMutations();
  const { returnToList } = useListReturn({ list: 'projects' });
  const [dirty, setDirty] = useState(false);
  const [pendingLeave, setPendingLeave] = useState<(() => void) | null>(null);
  const holdLeave = useCallback((leave: () => void) => setPendingLeave(() => leave), []);
  const guardLeave = useUnsavedChangesGuard({ dirty, onBlocked: holdLeave });

  if (!may('create', 'project')) {
    return (
      <AccessDenied
        title={t('projects:create.accessDenied', "You can't create projects")}
        backLabel={t('projectDetail.backToProjects', 'Projects')}
        onBack={() => returnToList()}
      />
    );
  }

  return (
    <>
      <ProjectFormModal
        variant="page"
        onDirtyChange={setDirty}
        onClose={() => guardLeave(() => returnToList())}
        onSubmit={async (input) => {
          const row = await create.mutateAsync(input);
          toast(
            t('projects.toast.created', 'Project created'),
            row.erpSetup === 'pending'
              ? t('projectDetail.erpLink.createdPending', '{{name}} saved. ERP linking needs attention; retry from the project page.', { name: input.name })
              : input.name,
            row.erpSetup === 'pending' ? 'warning' : 'success',
          );
          navigate(`/projects/${row.id}`, { replace: true, state: location.state });
        }}
        onError={(err) => {
          const { headline, detail } = classifyMutationError(err);
          toast(headline, detail, 'warning');
        }}
      />
      <ConfirmDialog
        open={pendingLeave !== null}
        tone="default"
        title={t('entityForm.discardTitle', 'Discard your changes?')}
        description={t('entityForm.discardBody', 'This form has unsaved changes. Discarding will lose them.')}
        confirmLabel={t('projects:create.leave', 'Leave')}
        cancelLabel={t('projects:create.stay', 'Stay')}
        onConfirm={() => {
          const leave = pendingLeave;
          setPendingLeave(null);
          leave?.();
        }}
        onCancel={() => setPendingLeave(null)}
      />
    </>
  );
};

export default ProjectNew;
