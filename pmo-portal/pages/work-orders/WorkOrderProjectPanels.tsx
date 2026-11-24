import React from 'react';
import { useProject } from '@/src/hooks/useProjects';
import { CandidateWorkOrders } from '../project-detail/tabs/CandidateWorkOrders';
import WorkOrderPlanVsActual from '../project-detail/WorkOrderPlanVsActual';
import DisciplineProfit from '../project-detail/DisciplineProfit';
import RevenuePlanRollup from '../project-detail/RevenuePlanRollup';
import EarnedBilledProfit from '../project-detail/EarnedBilledProfit';
import DailyTargetRollup from '../project-detail/DailyTargetRollup';

/**
 * One project's work-order panels under its work-order table (walk M1, M9, PC3, PC12): candidates to assess, then plan
 * versus actual and profit per work order, profit per discipline, the revenue plan, earned versus billed and the daily
 * target. Each panel keeps its own gate and organisation switch and renders nothing for a reader it refuses, so a role
 * without work-order money sees the candidates and no gap. Shown on the project's Work order tab and on the work-order
 * dashboard once it is narrowed to one project.
 */
export const WorkOrderProjectPanels: React.FC<{ projectId: string }> = ({ projectId }) => {
  const project = useProject(projectId);
  return (
    <div className="mt-[var(--space-section)] flex min-w-0 flex-col gap-[var(--space-panel-gap)] empty:hidden" data-testid="work-order-project-panels">
      {project.data && <CandidateWorkOrders projectId={projectId} projectManagerId={project.data.project_manager_id ?? null} />}
      <WorkOrderPlanVsActual projectId={projectId} />
      <DisciplineProfit projectId={projectId} />
      <RevenuePlanRollup projectId={projectId} />
      <EarnedBilledProfit projectId={projectId} />
      <DailyTargetRollup projectId={projectId} />
    </div>
  );
};
