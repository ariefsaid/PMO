import React from 'react';
import ProjectBudget from '../../ProjectBudget';
import BudgetProjection from '../../BudgetProjection';

export interface BudgetTabProps {
  projectId: string;
}

/**
 * Thin wrapper that mounts the already-real `<ProjectBudget>` (its
 * query/version/RPC logic is untouched; only its chrome was re-skinned to
 * tokens + StatusPill). Kept as a one-responsibility tab so the detail shell
 * never reaches into budget internals.
 *
 * P3c slice 6 (FR-BUD-151): additively mounts `<BudgetProjection>` below the existing budget grid —
 * PMO's forward view (never pushed to ERP, FR-BUD-160). It fetches + gates itself independently of
 * `<ProjectBudget>`.
 */
const BudgetTab: React.FC<BudgetTabProps> = ({ projectId }) => (
  <>
    <ProjectBudget projectId={projectId} />
    <BudgetProjection projectId={projectId} />
  </>
);

export default BudgetTab;
