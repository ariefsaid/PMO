import React, { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router';
import ProjectFormModal from '../components/ProjectFormModal';
import { AccessDenied, UnsavedChangesDialog, useToast } from '@/src/components/ui';
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
  const guardLeave = useUnsavedChangesGuard({ dirty, guardHistory: true, onBlocked: holdLeave });

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
            t('projects:create.savedDetail', '{{name}} saved.', { name: input.name }),
            'success',
          );
          navigate(`/projects/${row.id}`, { replace: true, state: location.state });
        }}
        onError={(err) => {
          // FR-PLN-011 / AC-PLN-010: the plan's active-project cap (migration 0535, typed PL002)
          // refuses the create. Localised copy — never the DB's English sentence on screen.
          const { headline, detail } = classifyMutationError(err, {
            PL002: t('projects:create.limitReached', "You've reached your plan's active-project limit"),
          }, {
            module: 'projects',
            operation: 'create',
            detailOverrides: {
              PL002: t(
                'projects:create.limitReachedDetail',
                'Nothing was created. Archive a project you no longer need, or ask your Operator to upgrade the plan.',
              ),
            },
          });
          toast(headline, detail, 'warning');
        }}
      />
      <UnsavedChangesDialog
        open={pendingLeave !== null}
        onDiscard={() => {
          const leave = pendingLeave;
          setPendingLeave(null);
          leave?.();
        }}
        onKeepEditing={() => setPendingLeave(null)}
      />
    </>
  );
};

export default ProjectNew;
