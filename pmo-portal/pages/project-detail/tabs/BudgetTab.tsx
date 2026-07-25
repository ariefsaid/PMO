import React from 'react';
import ProjectBudget from '../../ProjectBudget';
import BudgetProjection from '../../BudgetProjection';
import { useErpnextBinding } from '@/src/hooks/useErpnextBinding';

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
 *
 * ⚑ LOW-2(a) (money-safety audit round 7): the projection panel is a view onto an EXTERNAL system's
 * enforcement state, so it is mounted ONLY for an org that actually employs ERPNext. For any other org
 * there is never a mirror row, never an actuals snapshot and never an ETC control (it renders inside
 * `rows.map`), so the panel is permanently its own empty state — whose remedy copy tells the reader to
 * "push it to the ERP", a route they do not have. Unfollowable advice is worse than an absent panel: it
 * implies their data is incomplete when nothing is wrong.
 *
 * ⚑ THE EMPLOY SIGNAL (FR-BUD-006(a)/FR-BUD-010): employment is the ACTIVE ERPNext BINDING, never a
 * `domain_externally_owned('budget')` flip — the spec forbids that row ever being created (budget is
 * Posture B, PMO stays SoT). This mirrors the server-side `orgEmploysErpnext` predicate (an active
 * erpnext binding) and the `get_budget_push_status` gate; the FE gate is UX only and fails CLOSED.
 *
 * Fails CLOSED — an unknown/loading/errored/absent/disconnected binding does NOT mount it, so there is no
 * flash of an empty ERP panel and no unfollowable advice on a failed read. `<ProjectBudget>` is
 * deliberately unconditional: it is PMO-SoT and has nothing to do with any external system.
 */
const BudgetTab: React.FC<BudgetTabProps> = ({ projectId }) => {
  const { data: erpnextBinding } = useErpnextBinding();
  const employsExternalBudget = erpnextBinding?.status === 'active';
  return (
    <>
      <ProjectBudget projectId={projectId} />
      {employsExternalBudget && <BudgetProjection projectId={projectId} />}
    </>
  );
};

export default BudgetTab;
