import React from 'react';
import { ApprovalsQueue } from './timesheets/ApprovalsQueue';

/**
 * Legacy `/approvals` route — preserved as a deep-link. In IA-3 the approval
 * queue is the Timesheets "Approvals queue" view toggle; this standalone route
 * renders the same shared `ApprovalsQueue` body so the URL stays valid and the
 * SoD-gated approve/return affordances behave identically.
 */
const ApprovalsPage: React.FC = () => (
  <div>
    <div className="mb-4">
      <h1 className="text-[24px] font-bold tracking-[-0.02em]">Approvals</h1>
      <p className="mt-0.5 max-w-[72ch] text-sm text-muted-foreground">
        Review and approve the timesheets your reports have submitted. You can never approve your own
        week — separation of duties is enforced.
      </p>
    </div>
    <ApprovalsQueue />
  </div>
);

export default ApprovalsPage;
