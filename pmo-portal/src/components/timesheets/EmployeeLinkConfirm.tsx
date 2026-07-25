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
 *
 * ⚑ C-6 / C-7 (rendered Discover pass, 2026-07-22) — AND THE DECISION NAMES BOTH PARTIES, OR IS NOT
 * OFFERED. The paragraph above was true and the screen still made the decision impossible to make
 * responsibly: the dialog said the hours would go "to the matched PMO user" and never named that user
 * (`profile_id` was on the row, unused), while `Confirm` was offered on rows that identified nobody at
 * all (`Unknown employee` / `No email`) even though `employee_number` — the one stable identifier —
 * was fetched and never displayed. An Admin could re-point a week of someone's cost with zero
 * identifying facts on screen. Both ends are now named, and an unidentifiable end withholds the
 * decision rather than dressing it up.
 */

/** The ERP side is identifiable if ANY of its three identifying facts is present. */
const erpIdentity = (l: ProposedEmployeeLink): string | null =>
  l.employee_name ?? l.employee_number ?? l.work_email ?? null;

/** The PMO side is identifiable only if the destination profile is actually resolvable. */
const pmoIdentity = (l: ProposedEmployeeLink): string | null =>
  l.profile_id ? (l.profile_name ?? l.profile_email ?? null) : null;

const isDecidable = (l: ProposedEmployeeLink): boolean =>
  erpIdentity(l) !== null && pmoIdentity(l) !== null;

/**
 * ⚑ NEW-7 / NEW-8 — the supporting facts, MINUS whatever is already the headline.
 *
 * `erpIdentity` falls back name → number → email, so on a record with no name the headline IS the
 * employee number — and both the card's detail line and the dialog's parenthetical then repeated it,
 * rendering "ERP employee HR-EMP-00112 (HR-EMP-00112)". On an irreversible attribution decision a
 * duplicated identifier reads as a bug in the very fact the operator is being asked to trust. The
 * disambiguator is still shown whenever it disambiguates anything.
 */
const erpSupportingFacts = (l: ProposedEmployeeLink): string[] => {
  const headline = erpIdentity(l);
  return [l.employee_number, l.work_email].filter((f): f is string => Boolean(f) && f !== headline);
};

export const EmployeeLinkConfirm: React.FC<EmployeeLinkConfirmProps> = ({
  links,
  canConfirm,
  onConfirm,
  confirmingId = null,
}) => {
  const [pending, setPending] = useState<ProposedEmployeeLink | null>(null);

  if (links.length === 0) return null;

  return (
    <div className="space-y-2">
      {links.map((link) => {
        const erp = erpIdentity(link);
        const pmo = pmoIdentity(link);
        const decidable = erp !== null && pmo !== null;
        return (
          <div
            key={link.id}
            className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-card px-3 py-2.5"
          >
            <div className="min-w-0">
              {/* C-7: the ERP side — name if known, else the stable employee number, else the email. */}
              <div className="text-sm font-medium">{link.employee_name ?? erp ?? 'Unidentified ERP employee'}</div>
              <div className="mt-0.5 text-[12px] text-muted-foreground">
                {erpSupportingFacts(link).join(' · ') || 'No further identifying details on record'}
              </div>
              {/* C-6: the DESTINATION. This is what the confirm actually decides, so it is stated on the
                  card, not only in the dialog. */}
              <div className="mt-1 text-[12px]">
                {pmo ? (
                  <>
                    <span className="text-muted-foreground">Hours would be attributed to </span>
                    <b className="font-semibold">{pmo}</b>
                  </>
                ) : (
                  <span className="text-muted-foreground">No PMO user is matched to this employee.</span>
                )}
              </div>
              {link.link_proposed_reason && (
                <div className="mt-0.5 text-[12px] text-muted-foreground">{link.link_proposed_reason}</div>
              )}
              {/* An unidentifiable end is not a disabled button with no explanation — it is a stated
                  reason, because the operator's next act depends on WHICH end is missing. */}
              {!decidable && (
                <div className="mt-1 text-[12px] text-muted-foreground">
                  This link cannot be confirmed:{' '}
                  {erp === null
                    ? 'the ERP record carries no name, employee number or work email, so there is nothing to confirm it against.'
                    : 'no PMO user is matched to it yet.'}
                </div>
              )}
            </div>
            {canConfirm && decidable && (
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
        );
      })}

      {pending && isDecidable(pending) && (
        <ConfirmDialog
          open
          tone="default"
          title={`Attribute ${erpIdentity(pending)}'s hours to ${pmoIdentity(pending)}?`}
          description={`ERP employee ${erpIdentity(pending)}${
            // NEW-7: only when it adds something the headline does not already say.
            pending.employee_number && pending.employee_number !== erpIdentity(pending)
              ? ` (${pending.employee_number})`
              : ''
          } will have their ERP timesheet hours attributed to the PMO user ${pmoIdentity(pending)}${
            pending.profile_email ? ` (${pending.profile_email})` : ''
          } from now on. An ERP-side email change can never silently re-point a confirmed link.`}
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
