import React, { useMemo, useState } from 'react';
import {
  ApprovalRow,
  Button,
  Checkbox,
  ConfirmDialog,
  GateNotice,
  Icon,
  ListState,
  StatusPill,
  TimesheetGrid,
  useToast,
  type TimesheetDay,
  type TimesheetGridRow,
} from '@/src/components/ui';
import { TimesheetStatus } from '../../types';
import { usePermission } from '@/src/auth/usePermission';
import { useTimesheetsAwaitingApproval, useTimesheetMutations } from '@/src/hooks/useTimesheetApproval';
import { timesheetActions } from '@/src/lib/db/timesheetTransition';
import type { TimesheetAwaitingApproval } from '@/src/lib/db/timesheetTransition';
import { workflowVariant } from '@/src/lib/status/statusVariants';

/** Sum a sheet's entry hours (entries are number-normalised at the DAL boundary). */
function sumHours(sheet: TimesheetAwaitingApproval): number {
  return sheet.entries.reduce((sum, e) => sum + e.hours, 0);
}

// Timesheet status pill comes from the single status registry (`workflowVariant`):
// Submitted resolves to neutral grey `progress` (NOT the action-blue), per the
// Freed-Blue Status Rule.

function weekLabel(weekStart: string): string {
  // weekStart is an ISO date (YYYY-MM-DD). Render "Week of Mon D" without TZ drift.
  const [y, m, d] = weekStart.split('-').map(Number);
  const dt = new Date(y, (m ?? 1) - 1, d ?? 1);
  return `Week of ${dt.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`;
}

/** ISO date string (YYYY-MM-DD) without TZ drift. */
function isoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

/**
 * N11: build a read-only TimesheetGrid (project rows × Mon–Sun + Total) from a
 * sheet's entries[], grouped exactly as Timesheets.tsx does — one row per project,
 * 7 day columns keyed off the sheet's week_start_date. Pure (no hooks) so it can be
 * derived per expanded row.
 */
function buildGrid(sheet: TimesheetAwaitingApproval): { days: TimesheetDay[]; rows: TimesheetGridRow[] } {
  const [y, m, d] = sheet.week_start_date.split('-').map(Number);
  const weekStart = new Date(y, (m ?? 1) - 1, d ?? 1);
  const weekDates = Array.from({ length: 7 }).map((_, i) => {
    const dt = new Date(weekStart);
    dt.setDate(dt.getDate() + i);
    return dt;
  });
  const dateStrings = weekDates.map(isoDate);

  const days: TimesheetDay[] = weekDates.map((dt) => {
    const dow = dt.getDay();
    return {
      label: dt.toLocaleDateString(undefined, { weekday: 'short' }),
      dateNum: String(dt.getDate()),
      weekend: dow === 0 || dow === 6,
    };
  });

  const map = new Map<string, TimesheetGridRow>();
  for (const e of sheet.entries) {
    const key = e.project_id;
    let row = map.get(key);
    if (!row) {
      row = {
        id: key,
        project: e.project?.name ?? 'Unknown Project',
        code: e.project?.code ?? null,
        hours: [0, 0, 0, 0, 0, 0, 0],
      };
      map.set(key, row);
    }
    const dayIdx = dateStrings.indexOf(e.entry_date);
    if (dayIdx >= 0) row.hours[dayIdx] += e.hours;
  }
  const rows = Array.from(map.values()).sort((a, b) => a.project.localeCompare(b.project));
  return { days, rows };
}

/** A staged, not-yet-committed single-row action awaiting the ConfirmDialog
 *  (owner rule: nothing approves/returns on a single click; T2/T3). */
type PendingApproval = { kind: 'approve' | 'return'; id: string; name: string };

/**
 * The manager/admin approval queue — the Timesheets "Approvals queue" toggle body,
 * and the timesheet section of the `/approvals` inbox. The SoD gate is state-driven
 * from the real role/identity: the awaiting-approval DAL excludes the caller's own
 * sheets, and `timesheetActions` never offers approve/reject on an owned sheet. The
 * RPC is the authoritative SoD enforcer; this gates affordances.
 *
 * N11 (Wave-5): each row expands in place to the read-only per-project × per-day grid.
 * N12 (Wave-5): a selection mode offers SoD-safe bulk approve — only rows the viewer
 * may approve get a checkbox; one batch confirm fires the existing per-sheet approve
 * RPC N times, resilient to partial failure, aggregated into ONE toast. Return is not
 * bulkable (it needs a per-person reason).
 */
export const ApprovalsQueue: React.FC = () => {
  const { data: queue, isPending, isError, refetch } = useTimesheetsAwaitingApproval();
  const { approve, reject } = useTimesheetMutations();
  const { toast } = useToast();
  const may = usePermission();
  // A-2 (rbac-visibility §I + OD-W2-2): Approve/Return is offered ONLY to the actual approver
  // roles (Admin·Exec·PM via approval.transition). Finance·Engineer = ○. A non-approver who can
  // still READ the queue sees read-only rows (owner + hours + status, no action buttons). The
  // queue already excludes the caller's own sheets (SoD); the RPC is the authority (ADR-0016).
  const isApprover = may('transition', 'approval');
  const [pending, setPending] = useState<PendingApproval | null>(null);

  // N11: independently-expandable rows (an approver can compare two reports side by side).
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggleExpanded = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  // N12: selection mode + the staged batch awaiting the bulk confirm.
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmBulk, setConfirmBulk] = useState(false);
  const [bulkRunning, setBulkRunning] = useState(false);

  const sheets = useMemo(() => queue ?? [], [queue]);

  // Approvable sheets — the ONLY rows that may be bulk-selected (SoD-safe). isOwner=false
  // because the DAL already excludes own sheets; isApprover gates the rest.
  const approvableIds = useMemo(
    () =>
      new Set(
        sheets
          .filter((s) => timesheetActions(s.status as TimesheetStatus, false, isApprover).approve)
          .map((s) => s.id),
      ),
    [sheets, isApprover],
  );

  const exitSelection = () => {
    setSelecting(false);
    setSelected(new Set());
  };

  const toggleSelected = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  // Only currently-approvable ids count: prune stale selections left over from a
  // refetch (a sheet may have left the queue or stopped being approvable). Keeps the
  // bulk count + confirm label honest vs what commitBulk actually fires (review #2/#3).
  const effectiveSelected = useMemo(
    () => new Set([...selected].filter((id) => approvableIds.has(id))),
    [selected, approvableIds],
  );
  const allSelected =
    approvableIds.size > 0 && effectiveSelected.size === approvableIds.size;
  const someSelected = effectiveSelected.size > 0 && !allSelected;
  const toggleSelectAll = () => {
    if (effectiveSelected.size > 0) setSelected(new Set());
    else setSelected(new Set(approvableIds));
  };

  // T2/T3: commit the staged single-row action and toast on resolve.
  const commitApproval = () => {
    if (!pending) return;
    const mutation = pending.kind === 'approve' ? approve : reject;
    const okHeadline = pending.kind === 'approve' ? 'Timesheet approved' : 'Timesheet returned';
    const okDetail =
      pending.kind === 'approve'
        ? `${pending.name}'s week approved`
        : `Sent back to ${pending.name} for changes`;
    mutation.mutate(
      { id: pending.id },
      {
        onSuccess: () => {
          setPending(null);
          toast(okHeadline, okDetail, 'success');
        },
        onError: (err: unknown) => {
          setPending(null);
          toast('Action failed', err instanceof Error ? err.message : undefined, 'warning');
        },
      },
    );
  };

  // N12: commit the batch. Fire the existing per-sheet approve RPC for each selected id;
  // resilient — one SoD/stale failure must NOT abort the rest. Aggregate into ONE toast.
  const commitBulk = () => {
    const ids = sheets.filter((s) => effectiveSelected.has(s.id)).map((s) => s.id);
    if (ids.length === 0) {
      setConfirmBulk(false);
      return;
    }
    setBulkRunning(true);
    let settled = 0;
    let ok = 0;
    let failed = 0;
    const total = ids.length;
    const finish = () => {
      if (settled < total) return;
      setBulkRunning(false);
      setConfirmBulk(false);
      exitSelection();
      if (failed === 0) {
        toast('Timesheets approved', `${ok} approved`, 'success');
      } else if (ok === 0) {
        toast('Couldn’t approve', `${failed} failed (separation of duties or stale)`, 'warning');
      } else {
        toast('Partially approved', `${ok} approved, ${failed} failed (separation of duties or stale)`, 'warning');
      }
    };
    ids.forEach((id) => {
      approve.mutate(
        { id },
        {
          onSuccess: () => {
            ok += 1;
            settled += 1;
            finish();
          },
          onError: () => {
            failed += 1;
            settled += 1;
            finish();
          },
        },
      );
    });
  };

  if (isPending) {
    return (
      <div className="rounded-lg border border-border bg-card" data-testid="approvals-loading">
        <ListState variant="loading" rows={4} />
      </div>
    );
  }

  if (isError) {
    return (
      <ListState
        variant="error"
        title="Couldn't load the approval queue"
        sub="Something went wrong fetching timesheets awaiting your approval."
        onRetry={() => refetch()}
      />
    );
  }

  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <div className="mb-3 flex flex-wrap items-center gap-2.5">
        <h2 className="text-sm font-semibold">Team approvals queue</h2>
        <span className="flex-1" />
        {sheets.length > 0 && (
          <StatusPill variant="overdue" aria-label={`${sheets.length} awaiting you`}>
            {sheets.length} awaiting you
          </StatusPill>
        )}
        {/* N12: a Select toggle enters bulk-selection mode — only shown to approvers with
            at least one approvable row (otherwise there is nothing to bulk-approve). */}
        {isApprover && approvableIds.size > 0 && !selecting && (
          <Button variant="outline" size="sm" onClick={() => setSelecting(true)}>
            <Icon name="check" />
            Select
          </Button>
        )}
      </div>

      <GateNotice variant="blocked" className="mb-3">
        <b>Separation of duties.</b> You cannot approve your own timesheet — only a line manager can
        approve, and never their own week.
      </GateNotice>

      {/* N12: bulk-action cluster on a primary/6% wash with a count pill (DESIGN.md Toolbar
          selection-mode pattern). Announced as a labelled region. */}
      {selecting && (
        <div
          role="group"
          aria-label="Bulk approve"
          className="mb-3 flex flex-wrap items-center gap-2.5 rounded-lg bg-primary/[0.06] px-3 py-2.5"
        >
          <Checkbox
            checked={allSelected ? true : someSelected ? 'mixed' : false}
            onChange={toggleSelectAll}
            label="Select all approvable weeks"
          />
          <span className="inline-flex items-center rounded-full bg-secondary px-2 py-0.5 text-[12px] font-semibold tabular text-muted-foreground">
            {effectiveSelected.size} selected
          </span>
          <span className="flex-1" />
          <Button
            variant="primary"
            size="sm"
            disabled={effectiveSelected.size === 0 || bulkRunning}
            loading={bulkRunning}
            onClick={() => setConfirmBulk(true)}
          >
            <Icon name="check" />
            Approve {effectiveSelected.size}
          </Button>
          <Button variant="outline" size="sm" onClick={exitSelection} disabled={bulkRunning}>
            Clear
          </Button>
        </div>
      )}

      {sheets.length === 0 ? (
        <div data-testid="approvals-empty">
          <ListState
            variant="empty"
            icon="check"
            title="Nothing awaiting you"
            sub="Submitted timesheets from your reports will appear here for review."
          />
        </div>
      ) : (
        <div>
          {sheets.map((sheet) => {
            const total = sumHours(sheet);
            const actions = timesheetActions(sheet.status as TimesheetStatus, false, isApprover);
            const name = sheet.owner?.full_name ?? 'Unknown';
            const isExpanded = expanded.has(sheet.id);
            const panelId = `ts-breakdown-${sheet.id}`;
            const canSelect = approvableIds.has(sheet.id);
            return (
              <div key={sheet.id}>
                {/* N11: disclosure slot — chevron sits BEFORE the avatar (AC-JR-W3-01 / T20). */}
                <ApprovalRow
                  name={name}
                  week={weekLabel(sheet.week_start_date)}
                  hours={total}
                  status={
                    <StatusPill variant={workflowVariant(sheet.status)}>{sheet.status}</StatusPill>
                  }
                  disclosure={
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-expanded={isExpanded}
                      aria-controls={panelId}
                      aria-label={`Show hours for ${name}`}
                      onClick={() => toggleExpanded(sheet.id)}
                      className={isExpanded ? '[&_svg]:rotate-90 [&_svg]:transition-transform' : '[&_svg]:transition-transform'}
                    >
                      <Icon name="chev" />
                    </Button>
                  }
                >
                  {/* N12: per-row checkbox in selection mode. Only approvable rows get one;
                      non-approvable rows render WITHOUT a checkbox (SoD). */}
                  {selecting && canSelect && (
                    <Checkbox
                      checked={selected.has(sheet.id)}
                      onChange={() => toggleSelected(sheet.id)}
                      label={`Select ${name}'s week`}
                    />
                  )}
                  {actions.approve && !selecting && (
                    <Button
                      variant="primary"
                      size="sm"
                      onClick={() => setPending({ kind: 'approve', id: sheet.id, name })}
                      loading={approve.isPending}
                    >
                      <Icon name="check" />
                      Approve
                    </Button>
                  )}
                  {actions.reject && !selecting && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setPending({ kind: 'return', id: sheet.id, name })}
                      loading={reject.isPending}
                    >
                      Return
                    </Button>
                  )}
                </ApprovalRow>

                {/* N11: expanded breakdown — read-only TimesheetGrid + repeated actions in the foot. */}
                {isExpanded && (
                  <div id={panelId} className="mb-2 rounded-lg border border-border bg-secondary/20 p-2">
                    {(() => {
                      const { days, rows } = buildGrid(sheet);
                      return rows.length === 0 ? (
                        <p className="px-2 py-3 text-[13px] text-muted-foreground">
                          No hours recorded for this week.
                        </p>
                      ) : (
                        <TimesheetGrid days={days} rows={rows} />
                      );
                    })()}
                    {(actions.approve || actions.reject) && !selecting && (
                      <div className="mt-2 flex flex-wrap items-center justify-end gap-2">
                        {actions.approve && (
                          <Button
                            variant="primary"
                            size="sm"
                            onClick={() => setPending({ kind: 'approve', id: sheet.id, name })}
                            loading={approve.isPending}
                          >
                            <Icon name="check" />
                            Approve
                          </Button>
                        )}
                        {actions.reject && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setPending({ kind: 'return', id: sheet.id, name })}
                            loading={reject.isPending}
                          >
                            Return
                          </Button>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* T2 approve = default-tone confirm; T3 return = destructive modal. */}
      {pending && (
        <ConfirmDialog
          open
          tone={pending.kind === 'approve' ? 'default' : 'destructive'}
          title={
            pending.kind === 'approve'
              ? `Approve ${pending.name}'s week?`
              : `Return ${pending.name}'s timesheet?`
          }
          description={
            pending.kind === 'approve'
              ? `This approves ${pending.name}'s submitted week. You can't approve your own timesheet — separation of duties is enforced.`
              : `This sends ${pending.name}'s week back for changes. They'll need to correct and resubmit it.`
          }
          confirmLabel={pending.kind === 'approve' ? 'Approve' : 'Return timesheet'}
          loading={pending.kind === 'approve' ? approve.isPending : reject.isPending}
          onCancel={() => setPending(null)}
          onConfirm={commitApproval}
        />
      )}

      {/* N12: ONE batch confirm — lists the N owners + weeks + hours in the body. */}
      {confirmBulk && (
        <ConfirmDialog
          open
          tone="default"
          title={`Approve ${effectiveSelected.size} timesheet${effectiveSelected.size === 1 ? '' : 's'}?`}
          description={
            <span className="block">
              This approves the selected weeks. You can&rsquo;t approve your own timesheet —
              separation of duties is enforced.
              <span className="mt-2 block space-y-0.5">
                {sheets
                  .filter((s) => effectiveSelected.has(s.id))
                  .map((s) => (
                    <span key={s.id} className="block text-[13px]">
                      {s.owner?.full_name ?? 'Unknown'} · {weekLabel(s.week_start_date)} ·{' '}
                      <span className="tabular">{sumHours(s).toFixed(1)}</span> h
                    </span>
                  ))}
              </span>
            </span>
          }
          confirmLabel={`Approve ${effectiveSelected.size}`}
          loading={bulkRunning}
          onCancel={() => setConfirmBulk(false)}
          onConfirm={commitBulk}
        />
      )}
    </section>
  );
};
