import React from 'react';
import ProjectBudget from '../../ProjectBudget';

export interface BudgetTabProps {
  projectId: string;
}

/**
 * Thin wrapper that mounts the already-real `<ProjectBudget>` (its
 * query/version/RPC logic is untouched; only its chrome was re-skinned to
 * tokens + StatusPill). Kept as a one-responsibility tab so the detail shell
 * never reaches into budget internals.
 */
const BudgetTab: React.FC<BudgetTabProps> = ({ projectId }) => <ProjectBudget projectId={projectId} />;

export default BudgetTab;
