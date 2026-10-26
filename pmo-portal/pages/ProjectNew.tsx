import React, { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router';
import ProjectFormModal from '../components/ProjectFormModal';
import { ConfirmDialog, useToast } from '@/src/components/ui';
import { ProjectPageFrame } from '@/src/components/projects/ProjectPageFrame';
import { usePermission } from '@/src/auth/usePermission';
import { useProjectMutations } from '@/src/hooks/useProjects';
import { useListReturn } from '@/src/hooks/useListReturn';
import { useUnsavedChangesGuard } from '@/src/hooks/useUnsavedChangesGuard';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import { readListReturnContext } from '@/src/lib/listReturnContext';
import { useEffectiveRole } from '@/src/auth/impersonation';
import { useProjectStatusLabel } from '@/src/hooks/useProjectStatusLabel';
import type { ProjectStatus } from '@/src/lib/db/projects';

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
  const { effectiveRole } = useEffectiveRole();
  const statusLabel = useProjectStatusLabel();
  const [dirty, setDirty] = useState(false);
  const [stage, setStage] = useState<ProjectStatus>('Leads');
  const [pendingLeave, setPendingLeave] = useState<(() => void) | null>(null);
  const holdLeave = useCallback((leave: () => void) => setPendingLeave(() => leave), []);
  const guardLeave = useUnsavedChangesGuard({ dirty, onBlocked: holdLeave });
  const origin = readListReturnContext(location.state, 'projects');
  const originQuery = useMemo(
    () => new URLSearchParams(origin?.path.split('?')[1] ?? ''),
    [origin?.path],
  );
  const sourceClient = originQuery.get('client');
  const initialClient = sourceClient && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(sourceClient)
    ? { client_id: sourceClient }
    : undefined;
  const defaultScope = effectiveRole === 'Engineer' ? 'My Projects' : 'All';
  const sourceScope = originQuery.get('filter') ?? defaultScope;
  const filterLabels: Record<string, string> = {
    All: t('projects.filters.all', 'All'),
    'My Projects': t('projects.filters.myProjects', 'My Projects'),
    Ongoing: t('projects.filters.ongoing', 'Ongoing'),
    Completed: t('projects.filters.completed', 'Completed'),
    'at-risk': t('projects.filters.atRisk', 'At risk'),
  };
  const viewLabels: Record<string, string> = {
    table: t('projects.view.table', 'Table'),
    cards: t('projects.view.cards', 'Cards'),
    calendar: t('projects.view.calendar', 'Calendar'),
    kanban: t('projects.view.board', 'Board'),
  };
  const sourceView = originQuery.get('view') ?? 'table';
  const originScope = origin
    ? t('projects:create.originScope', 'Projects scope: {{scope}}', { scope: filterLabels[sourceScope] ?? filterLabels[defaultScope] })
    : t('projects:create.workspaceScope', 'Workspace scope');
  const originView = viewLabels[sourceView] ?? viewLabels.table;
  const stageConsequence = stage === 'Leads'
    ? t('projects:create.leadConsequence', 'Leads are tracked in the Pipeline.')
    : t('projects:create.internalConsequence', 'Internal projects stay in the workspace.');

  if (!may('create', 'project')) {
    return (
      <ProjectPageFrame
        title={t('projects:create.accessDenied', "You can't create projects")}
        breadcrumb={(
          <button type="button" onClick={() => returnToList()} className="touch-target min-h-11 rounded-sm text-primary-text underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
            {t('projects:create.backToProjects', 'Back to Projects')}
          </button>
        )}
        scope={effectiveRole === 'Engineer'
          ? t('projects:create.engineerAccessDeniedReason', 'Engineers can find assigned work from Projects.')
          : effectiveRole === 'Finance'
            ? t('projects:create.financeAccessDeniedReason', 'Finance can review project finances from Projects.')
            : t('projects:create.accessDeniedGeneral', 'Project creation is limited to Admin, Executive, and Project Manager roles.')}
      >
      </ProjectPageFrame>
    );
  }

  return (
    <ProjectPageFrame
      title={t('projectForm.title.create', 'New project')}
      breadcrumb={(
        <button type="button" onClick={() => guardLeave(() => returnToList())} className="touch-target min-h-11 rounded-sm text-primary-text underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
          {t('projects:create.backToProjects', 'Back to Projects')}
        </button>
      )}
      scope={(
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <span className="min-w-0 break-words">{originScope}</span>
          {origin && <span className="inline-flex max-w-full items-start gap-1 whitespace-nowrap"><span aria-hidden="true">·</span><span>{originView}</span></span>}
          <span className="inline-flex max-w-full items-start gap-1"><span aria-hidden="true">·</span><span className="min-w-0 break-words">{t('projects:create.startsAs', 'Starts as {{stage}}', { stage: statusLabel(stage) })}: {stageConsequence}</span></span>
        </div>
      )}
      className="min-w-0 space-y-4"
    >
      <ProjectFormModal
        variant="page"
        initial={initialClient}
        onDirtyChange={setDirty}
        onOriginationStageChange={setStage}
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
        confirmLabel={t('projects:create.leave', 'Discard changes')}
        cancelLabel={t('projects:create.stay', 'Keep editing')}
        onConfirm={() => {
          const leave = pendingLeave;
          setPendingLeave(null);
          leave?.();
        }}
        onCancel={() => setPendingLeave(null)}
      />
    </ProjectPageFrame>
  );
};

export default ProjectNew;
