import React, { useState } from 'react';
import { Button, ConfirmDialog } from '@/src/components/ui';
import type { ProposedEmployeeLink } from '@/src/lib/db/timesheetPush';

export interface EmployeeLinkConfirmProps {
  links: ProposedEmployeeLink[];
  /** ADR-0016 UX gate result — `can('confirm_employee_link', 'employeeLink', ctx)` (Admin only). The
   *  RPC (`confirm_erp_employee_link`) is the real authority regardless of this flag. */
  canConfirm: boolean;
  onConfirm: (link: ProposedEmployeeLink) => void;
  /** the `erp_employees.id` currently being confirmed (mutation in flight) — disables its row. */
  confirmingId?: string | null;
}

/**
 * P3b (OQ-TSP-10(C) — the owner ruling) — the Employee-adopt-link Admin queue. A link the adopt probe
 * PROPOSED on a unique work-email match is NEVER auto-confirmed: re-pointing which PMO user a week of
 * ERP hours is attributed to is an identity decision, so it goes through an explicit `ConfirmDialog`
 * step, never a single click.
 */
export const EmployeeLinkConfirm: React.FC<EmployeeLinkConfirmProps> = ({
  links,
  canConfirm,
  onConfirm,
  confirmingId = null,
}) => {
  const [pending, setPending] = useState<ProposedEmployeeLink | null>(null);

  if (links.length === 0) return null;

  return (
    <div className="space-y-2" role="region" aria-label="Employee links awaiting confirmation">
      {links.map((link) => (
        <div
          key={link.id}
          className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-card px-3 py-2.5"
        >
          <div className="min-w-0">
            <div className="text-sm font-medium">{link.employee_name ?? 'Unknown employee'}</div>
            <div className="mt-0.5 text-[12px] text-muted-foreground">
              {link.work_email ?? 'No email'}
              {link.link_proposed_reason ? ` · ${link.link_proposed_reason}` : ''}
            </div>
          </div>
          {canConfirm && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPending(link)}
              loading={confirmingId === link.id}
              disabled={confirmingId === link.id}
            >
              Confirm
            </Button>
          )}
        </div>
      ))}

      {pending && (
        <ConfirmDialog
          open
          tone="default"
          title={`Confirm ${pending.employee_name ?? 'this employee'}'s link?`}
          description={`This attributes ${pending.employee_name ?? 'this employee'}'s ERP timesheet hours to the matched PMO user going forward. An ERP-side email change can never silently re-point a confirmed link.`}
          confirmLabel="Confirm link"
          loading={confirmingId === pending.id}
          onCancel={() => setPending(null)}
          onConfirm={() => {
            onConfirm(pending);
            setPending(null);
          }}
        />
      )}
    </div>
  );
};
