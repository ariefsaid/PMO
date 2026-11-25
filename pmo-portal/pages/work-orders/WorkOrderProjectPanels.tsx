import React, { useContext } from 'react';
import { QueryClientContext } from '@tanstack/react-query';
import { AuthContext } from '@/src/auth/AuthContext';

import WorkOrderPlanVsActual from '../project-detail/WorkOrderPlanVsActual';
import DisciplineProfit from '../project-detail/DisciplineProfit';
import RevenuePlanRollup from '../project-detail/RevenuePlanRollup';
import EarnedBilledProfit from '../project-detail/EarnedBilledProfit';
import DailyTargetRollup from '../project-detail/DailyTargetRollup';
import { CandidateRecords } from './CandidateRecords';

/**
 * One project's work-order panels under its work-order table (walk M1, M9, PC3): plan
 * versus actual and profit per work order, profit per discipline, the revenue plan, earned versus billed and the daily
 * target, and last any earlier candidate work orders, read-only. Each panel keeps its own gate and organisation switch and renders nothing for a reader it refuses, so a role
 * without work-order money sees no gap. Shown on the project's Work order tab and on the work-order
 * dashboard once it is narrowed to one project.
 */
const WorkOrderProjectPanelsBody: React.FC<{ projectId: string }> = ({ projectId }) => {
  return (
    <div className="mt-[var(--space-section)] flex min-w-0 flex-col gap-[var(--space-panel-gap)] empty:hidden" data-testid="work-order-project-panels">
      <WorkOrderPlanVsActual projectId={projectId} />
      <DisciplineProfit projectId={projectId} />
      <RevenuePlanRollup projectId={projectId} />
      <EarnedBilledProfit projectId={projectId} />
      <DailyTargetRollup projectId={projectId} />
      <CandidateRecords projectId={projectId} />
    </div>
  );
};

/** Renders nothing outside the auth and query providers (bare renders of the page in unit tests). */
export const WorkOrderProjectPanels: React.FC<{ projectId: string }> = (props) => {
  const auth = useContext(AuthContext);
  const queryClient = useContext(QueryClientContext);
  if (!auth || !queryClient) return null;
  return <WorkOrderProjectPanelsBody {...props} />;
};
