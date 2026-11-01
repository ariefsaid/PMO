import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { EntityFormModal, useToast } from '@/src/components/ui';
import { useAuth } from '@/src/auth/useAuth';
import { usePermission } from '@/src/auth/usePermission';
import { useProjectTransition, winEligibilityQueryOptions } from '@/src/hooks/useProjectTransitions';
import { useOptimisticMoves } from '@/src/components/kanban/useOptimisticMoves';
import { projectDisplayName } from '@/src/lib/projectDisplayName';
import { useSalesStageLabel } from '@/src/hooks/useProjectStatusLabel';
import { LEGAL_PROJECT_TRANSITIONS, type ProjectStatus, type TransitionProjectOpts } from '@/src/lib/db/projectTransitions';
import type { PipelineProject } from '@/src/lib/db/dashboard';
import SalesKanbanBoard from '../../components/SalesKanbanBoard';
import { SALES_COLUMNS, resolveProjectDrop } from '../../components/salesPipeline';
import { ProjectTransitionConfirm } from '../../components/project-status/ProjectTransitionConfirm';
import { WinDetailsFields } from '../../components/project-status/WinDetailsFields';
import { winDetailsComplete, winEligibilityMessage } from '../../components/project-status/projectTransitionCopy';

type Pending =
  | { kind: 'confirm'; project: PipelineProject; target: ProjectStatus; choice?: ProjectStatus[] }
  | { kind: 'win'; project: PipelineProject };

const BOARD_ROOTS = ['sales-pipeline', 'won-deals', 'lost-deals'] as const;
const colById = (id: string) => SALES_COLUMNS.find((c) => c.testId === id)!;

/**
 * Sales Pipeline drop controller (DND, #1637). A drop is a second way to ask for the transition the
 * "Change status" menu offers: same rule table, same confirm, same win-details form, same write.
 * `can()` is UX only; `transition_project` stays the authority and a refusal rolls the card back.
 */
export const DraggableSalesBoard: React.FC<{
  projects: PipelineProject[];
  onOpen: (p: PipelineProject) => void;
  selectedStageIndex?: number | null;
}> = ({ projects, onOpen, selectedStageIndex }) => {
  const { t } = useTranslation('boardDrag');
  const qc = useQueryClient();
  const { currentUser } = useAuth();
  const may = usePermission();
  const mutation = useProjectTransition();
  const { toast } = useToast();
  const moves = useOptimisticMoves();
  const stageLabel = useSalesStageLabel();
  const [pending, setPending] = useState<Pending | null>(null);
  const [contractRef, setContractRef] = useState('');
  const [contractDate, setContractDate] = useState('');
  const byId = useMemo(() => new Map(projects.map((p) => [p.id, p])), [projects]);
  const mayTransition = may('transition', 'project');

  // The board has no inline slot for the menu's ERP-linking note, so it surfaces as a toast.
  useEffect(() => {
    if (mutation.erpSetupPending)
      toast(t('projectDetail.erpLink.statusPending', 'Project status saved. ERP linking needs attention; retry from the project page.'), undefined, 'info');
  }, [mutation.erpSetupPending, toast, t]);

  // Awaits the refetch `invalidateProjectProjections` already started, without cancelling it.
  const refreshBoard = () => Promise.all(BOARD_ROOTS.map((root) =>
    qc.invalidateQueries({ queryKey: [root, currentUser?.org_id] }, { cancelRefetch: false })));

  const reset = () => { setPending(null); setContractRef(''); setContractDate(''); };
  const cancel = () => { if (pending) moves.release(pending.project.id); reset(); };

  const commit = async (project: PipelineProject, to: ProjectStatus, opts?: TransitionProjectOpts) => {
    reset();
    moves.save(project.id);
    try {
      await mutation.mutateAsync({ id: project.id, to, opts });
      toast('Project updated', `Moved to ${to}`, 'success');
      await refreshBoard();
      // Let the refetched rows render before the card stops being held, so it never flickers back (FR-DND-033).
      await new Promise((resolve) => setTimeout(resolve, 0));
    } catch (err) {
      toast('Status change failed', err instanceof Error ? err.message : undefined, 'warning');
    } finally {
      moves.release(project.id);
    }
  };

  const onMove = async (projectId: string, columnId: string) => {
    const project = byId.get(projectId);
    if (!project || !mayTransition || pending) return;
    const column = colById(columnId);
    const r = resolveProjectDrop(project.status as ProjectStatus, column);
    if (r.kind === 'noop') return;
    if (r.kind === 'refused') {
      toast(t('boardDrag:refusedTitle', 'Move not allowed'), t('boardDrag:refused', "{{name}} can't move from {{from}} to {{to}}.", {
        name: projectDisplayName(project),
        from: stageLabel(SALES_COLUMNS.find((c) => c.statuses.includes(project.status))!),
        to: stageLabel(column),
      }), 'warning');
      return;
    }
    moves.hold(projectId, columnId);
    if (r.kind === 'choice') { setPending({ kind: 'confirm', project, target: r.options[0], choice: r.options }); return; }
    if (r.to !== 'Won, Pending KoM') { setPending({ kind: 'confirm', project, target: r.to }); return; }
    // Win: the same read-only preflight the menu uses. Anything but 'allowed' (or a failed check) refuses.
    const decision: string | null = await qc.fetchQuery(winEligibilityQueryOptions(currentUser, project.id)).catch(() => null);
    if (decision === 'allowed') { setPending({ kind: 'win', project }); return; }
    moves.release(projectId);
    toast(t('boardDrag:refusedTitle', 'Move not allowed'), winEligibilityMessage(t, decision), 'warning');
  };

  const canDrop = (projectId: string, columnId: string) => {
    const p = byId.get(projectId);
    if (!p) return false;
    const k = resolveProjectDrop(p.status as ProjectStatus, colById(columnId)).kind;
    return k === 'target' || k === 'choice';
  };

  return (
    <>
      <SalesKanbanBoard
        projects={projects}
        onOpen={onOpen}
        selectedStageIndex={selectedStageIndex}
        drag={{
          columnOf: moves.columnOf,
          stateOf: moves.stateOf,
          canDrag: (p) => mayTransition && (LEGAL_PROJECT_TRANSITIONS[p.status] ?? []).length > 0,
          canDrop,
          onMove: (id, col) => void onMove(id, col),
        }}
      />
      {pending?.kind === 'confirm' && (
        <ProjectTransitionConfirm
          target={pending.target}
          choice={pending.choice}
          loading={mutation.isPending}
          onCancel={cancel}
          onConfirm={(to) => void commit(pending.project, to)}
        />
      )}
      {pending?.kind === 'win' && (
        <EntityFormModal
          open
          title="Win — enter contract details"
          submitLabel="Confirm"
          submitDisabled={!winDetailsComplete(contractRef, contractDate)}
          dirty={contractRef !== '' || contractDate !== ''}
          onClose={cancel}
          onSubmit={(e) => {
            e.preventDefault();
            if (winDetailsComplete(contractRef, contractDate))
              void commit(pending.project, 'Won, Pending KoM', { customerContractRef: contractRef.trim(), contractDate });
          }}
        >
          <WinDetailsFields idPrefix={`drop-${pending.project.id}`} contractRef={contractRef} contractDate={contractDate} onRef={setContractRef} onDate={setContractDate} />
        </EntityFormModal>
      )}
    </>
  );
};

export default DraggableSalesBoard;
