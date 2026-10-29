import { projectCodedPickerLabel } from '@/src/lib/projectDisplayName';
import React, { useMemo, useState } from 'react';
import {
  Button,
  Card,
  ConfirmDialog,
  ErrBanner,
  Icon,
  ListState,
  SelectField,
  StatusPill,
  TimesheetGrid,
  AccessDenied,
  useToast,
} from '@/src/components/ui';
import { useNavigate } from 'react-router';
import { Trans, useTranslation } from 'react-i18next';
import { usePermission } from '@/src/auth/usePermission';
import { TimesheetStatus } from '../types';
import { useTimesheets } from '@/src/hooks/useTimesheets';
import {
  useTimesheetMutations,
  useTimesheetsAwaitingApproval,
  useOwnTimesheetPushState,
} from '@/src/hooks/useTimesheetApproval';
import { PushStateBadge } from '@/src/components/timesheets/PushStateBadge';
import { useTimesheetEntryMutations } from '@/src/hooks/useTimesheetEntries';
import { useProjects } from '@/src/hooks/useProjects';
import { useAuth } from '@/src/auth/useAuth';
import { workflowVariant } from '@/src/lib/status/statusVariants';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import { formatNumberExact } from '@/src/lib/format';
import { useIsDesktop } from '@/src/components/ui/useIsDesktop';
import { weekStart, datesInWeek, entriesToGridRows, gridDaysForWeek } from './timesheets/timesheetWeekModel';
import { useTimesheetWeekEditor } from './timesheets/useTimesheetWeekEditor';
import { TimesheetWeekToolbar } from './timesheets/TimesheetWeekToolbar';
import { TimesheetWeekActions } from './timesheets/TimesheetWeekActions';

// Timesheet status pill comes from the single status registry (`workflowVariant`):
// Draft = neutral, Submitted = neutral grey `progress` (NOT the action-blue, per the
// Freed-Blue Status Rule), Approved = green `won`, Rejected = red `lost`.

// RF-061: recognizable code + short title in the picker; the added row shows the full name.
const PICKER_NAME_MAX = 36;

const TimesheetsPage: React.FC = () => {
  const { t } = useTranslation(['common', 'timesheets']);
  const isDesktop = useIsDesktop();
  const { data: sheets, isPending, isError, refetch } = useTimesheets();
  const { submit, reopen } = useTimesheetMutations();
  const { currentUser } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const may = usePermission();
  // A-6 / OD-W2 (rbac-visibility §I): Finance has NO Workforce surface (Timesheets ○,
  // Approvals ○) and `timesheet.create` excludes Finance. When Finance reaches /timesheets by
  // URL they get a clean access-denied surface — no entry/save affordance. This is the FE
  // clarity gate ONLY this wave (ADR-0016: the FE may be stricter than RLS); the server-side
  // RLS tightening (Finance cannot insert timesheet_entries) is a SEPARATE pgTAP-owned security
  // follow-up, not built here.
  const canEnterTimesheet = may('create', 'timesheet');
  // CW-6 (was AC-W3-N2): the approvals queue no longer lives on this page — it has ONE home at
  // /approvals. Timesheets shows only a cross-link there, gated on the same approval capability
  // as the rail's Approvals item — `may('transition','approval')` (DELIVERY = Admin·Exec·PM).
  // Engineer cannot approve timesheets (OD-W2-2), so showing them the cross-link is a RBAC leak.
  const isApprover = may('transition', 'approval');
  const signedInUserId = currentUser?.id;
  // Pending-approval count for the queue toggle badge (shared cache; cheap).
  const { data: awaiting } = useTimesheetsAwaitingApproval();
  const pendingCount = awaiting?.length ?? 0;

  const [currentDate, setCurrentDate] = useState(new Date());

  const { date: weekStartDate, key: weekStartString } = weekStart(currentDate);
  const weekDates = useMemo(() => datesInWeek(weekStartDate), [weekStartDate]);

  const currentTimesheet = useMemo(
    () => (sheets ?? []).find((t) => t.week_start_date === weekStartString) ?? null,
    [sheets, weekStartString]
  );

  const currentWeekEntries = useMemo(
    () => currentTimesheet?.entries ?? [],
    [currentTimesheet]
  );

  // ⚑ I-16/I-17 — the owner's own ERP push state (rendered by `PushStateBadge` beside the status pill
  // below). Declared here, with the other top-level reads, so it stays above every early return.
  const { data: ownPushState } = useOwnTimesheetPushState(currentTimesheet?.id);

  const gridRows = useMemo(() => entriesToGridRows(currentWeekEntries, weekDates, t('timesheets.unknownProject', 'Unknown Project')), [currentWeekEntries, weekDates, t]);
  const gridDays = useMemo(() => gridDaysForWeek(weekDates), [weekDates]);

  // ── timesheet-entry: editable-state machine (FR-TSE-001/002/003) ───────────
  // Editable iff the sheet is absent, or the signed-in user owns it AND it is Draft.
  const editable =
    currentTimesheet == null ||
    (currentTimesheet.user_id === signedInUserId && currentTimesheet.status === 'Draft');

  const entryMutations = useTimesheetEntryMutations();
  const { saveWeek, deleteRow, isReconciling, retryDeleteRefresh } = entryMutations;
  const { data: allProjects, isPending: projectsPending, isError: projectsError, refetch: refetchProjects } = useProjects();

  const editor = useTimesheetWeekEditor({
    currentTimesheet, currentWeekEntries, gridRows, weekDates, weekStartDate, weekStartString,
    allProjects, signedInUserId, currentDate, setCurrentDate, entryMutations, submit,
  });
  const { pickerOptions, invalidCells, editValid, editTotals, editGridRows, editNotes,
    editRawHours, rowToDelete, dirty, weeklyTotal, pendingWeekDelta, weekRangeLabel,
    isOwner, editBufferHasHours, canSubmit, confirmSubmit } = editor.view;
  const { setCell, setNote, addProject, requestDelete, cancelDelete, confirmDeleteRow,
    commitSave, stepWeek, cancelWeekChange, confirmWeekChange, requestSubmit,
    cancelSubmit, commitSubmit } = editor.actions;

  const actionProps = {
    total: editTotals.weekly, dirty, editValid, canSubmit, hasHours: editBufferHasHours,
    hasEntries: currentWeekEntries.length > 0, saving: saveWeek.isPending, submitting: submit.isPending,
    deleting: deleteRow.isPending, isReconciling, onSave: commitSave, onSubmit: requestSubmit,
  };

  // T1 confirm dialog — shared across the grid-view renders below.
  // OD-W3-1: no longer requires `currentTimesheet` to be non-null — on a fresh (no-prior-Save)
  // week the confirm still shows and commitSubmit auto-saves first, then submits.
  const submitConfirm = confirmSubmit && (
    <ConfirmDialog
      open
      tone="default"
      title={t('timesheets.submitConfirm.title', 'Submit this week for approval?')}
      description={t(
        'timesheets.submitConfirm.description',
        "This sends the whole week to your line manager. You can't edit it again until it's returned.",
      )}
      confirmLabel={t('timesheets.submitConfirm.confirmLabel', 'Submit timesheet')}
      loading={submit.isPending || saveWeek.isPending}
      onCancel={cancelSubmit}
      onConfirm={() => void commitSubmit()}
    />
  );

  // A-6 page view-gate (after all hooks — Rules of Hooks): a denied role (Finance) gets the
  // shared access-denied surface, not a savable grid or the approvals queue.
  if (!canEnterTimesheet) {
    return (
      <AccessDenied
        title={t('timesheets.accessDenied.title', "You don't have access to Timesheets")}
        sub={t(
          'timesheets.accessDenied.sub',
          'Timesheets and approvals are part of the workforce surface. Finance work lives on your dashboard, projects, and procurement.',
        )}
        onBack={() => navigate('/')}
      />
    );
  }

  const head = <TimesheetWeekToolbar
    weekRangeLabel={weekRangeLabel} isApprover={isApprover} pendingCount={pendingCount}
    weekStartDate={weekStartDate} busy={deleteRow.isPending || isReconciling || saveWeek.isPending || submit.isPending}
    stepWeek={stepWeek} pendingWeekDelta={pendingWeekDelta}
    onCancelDiscard={cancelWeekChange}
    onConfirmDiscard={confirmWeekChange}
  />;

  // ── Weekly grid view ────────────────────────────────────────────────────────
  if (isPending) {
    return (
      <div>
        {head}
        <div className="rounded-lg border border-border bg-card" data-testid="timesheets-loading">
          <ListState variant="loading" rows={5} />
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <div>
        {head}
        <ListState
          variant="error"
          title={t('timesheets.error.title', "Couldn't load timesheets")}
          sub={t('timesheets.error.sub', 'Something went wrong fetching your hours.')}
          onRetry={() => refetch()}
        />
      </div>
    );
  }

  const status = (currentTimesheet?.status as TimesheetStatus | undefined) ?? null;
  const statusCopy: Record<TimesheetStatus, string> = {
    [TimesheetStatus.Draft]: t('timesheets.status.Draft', 'Draft'),
    [TimesheetStatus.Submitted]: t('timesheets.status.Submitted', 'Submitted'),
    [TimesheetStatus.Approved]: t('timesheets.status.Approved', 'Approved'),
    [TimesheetStatus.Rejected]: t('timesheets.status.Rejected', 'Returned for changes'),
  };
  const returned = status === TimesheetStatus.Rejected;

  // AC-W3-B1: "Revise this week" — single-click routine reversible step (OD-UX-1: no confirm).
  // Available only to the OWNER of a Rejected sheet; the RPC is the real authority.
  const canRevise = returned && isOwner && !!currentTimesheet?.id;
  const commitReopen = () => {
    if (!currentTimesheet?.id || reopen.isPending) return;
    reopen.mutate(
      { id: currentTimesheet.id },
      {
        onSuccess: () => toast(
            t('timesheets.toast.reopened.headline', 'Reopened for editing'),
            t(
              'timesheets.toast.reopened.detail',
              'Week moved back to Draft — make your changes and resubmit.',
            ),
            'success',
          ),
        onError: (err: unknown) => {
          const { headline, detail } = classifyMutationError(err);
          toast(headline, detail, 'warning');
        },
      },
    );
  };

  return (
    <div>
      {head}

      {/* Returned-for-changes is an expected, recoverable state (role=status). */}
      {returned && (
        <ErrBanner
          title={t('timesheets.returned.title', 'This week was returned for changes')}
          sub={t(
            'timesheets.returned.sub',
            'Your line manager sent it back. Review the flagged days, correct them, and resubmit.',
          )}
          action={
            canRevise
              ? {
                  label: t('timesheets.returned.revise', 'Revise this week'),
                  onClick: commitReopen,
                  disabled: reopen.isPending,
                }
              : undefined
          }
        />
      )}

      <Card
        clip
        className={editable ? 'pb-[calc(8rem+env(safe-area-inset-bottom))] md:pb-0' : undefined}
      >
        <div className="flex flex-wrap items-center gap-2 border-b border-border px-3.5 py-2.5">
          <StatusPill variant={status ? workflowVariant(status) : 'neutral'}>
            {status === TimesheetStatus.Draft || !status
              ? t('timesheets.status.draftNotSubmitted', 'Draft — not submitted')
              : statusCopy[status]}
          </StatusPill>
          {/* ⚑ I-16/I-17 (rendered Discover pass, 2026-07-22) — the OWNER'S view of their own ERP
              push. `timesheet_erp_mirror_select` RLS deliberately grants the sheet's owner this read,
              and nothing consumed it: the person whose week it is — the one who has to re-do it if
              the hours never reach payroll costing — was the only one who could not find out. No
              Retry here: re-driving is the approver's act (`can('push_timesheet', …)`), and this
              badge is supplementary — a null state renders nothing and never gates the page. */}
          <PushStateBadge state={ownPushState ?? null} canRetry={false} />
          {editable && (
            <div className="inline-flex min-w-0 max-w-full items-center gap-1.5 text-[13px] font-medium text-muted-foreground">
              <Icon name="plus" aria-hidden />
              <span>{t('timesheets.addProject', 'Add project')}</span>
              {/* max-w cap + min-w-0: the closed picker only shows the short placeholder,
                  so capping its width is safe; options still show in full. Use the shared
                  DS SelectField so dark mode keeps the tokened field shell. */}
              <div className="min-w-0 max-w-[160px] flex-1">
                {projectsPending ? (
                  <span role="status">{t('timesheets:picker.loading', 'Loading projects…')}</span>
                ) : projectsError ? (
                  <span role="alert">
                    {t('timesheets:picker.error', 'Could not load projects.')}
                    <Button variant="outline" onClick={() => refetchProjects()}>
                      {t('timesheets:picker.retry', 'Retry projects')}
                    </Button>
                  </span>
                ) : (
                  <SelectField
                    id="ts-add-project"
                    hideLabel
                    label={t('timesheets.addAProject', 'Add a project')}
                    value=""
                    onChange={(value) => {
                      if (value) addProject(value);
                    }}
                    disabled={pickerOptions.length === 0}
                    options={pickerOptions.map((p) => ({ value: p.id, label: projectCodedPickerLabel(p, PICKER_NAME_MAX) }))}
                    placeholder={
                      pickerOptions.length === 0
                        ? t('timesheets.picker.none', 'No projects to add')
                        : t('timesheets.picker.select', 'Select a project…')
                    }
                    className="touch-target min-w-0 max-w-[160px] text-[13px]"
                  />
                )}
              </div>
            </div>
          )}
          {editable && (
            <span
              data-testid="timesheets-save-status"
              role="status"
              className="text-[13px] text-muted-foreground"
            >
              {deleteRow.isPending || isReconciling
                ? t('timesheets:reconcile.message', 'Refresh this week before continuing.')
                : dirty
                ? t('uxs28.save.dirty', 'Unsaved changes')
                : currentWeekEntries.length > 0
                  ? t('uxs28.save.saved', 'All changes saved')
                  : t('uxs28.save.nothing', 'Nothing to save yet')}
            </span>
          )}
          <span
            data-testid="timesheets-weekly-total"
            className="ml-auto text-[13px] tabular text-muted-foreground"
          >
            {t('timesheets.hoursThisWeek', '{{hours}} hours this week', {
              hours: formatNumberExact(editable ? editTotals.weekly : weeklyTotal),
            })}
          </span>
        </div>

        {editable ? (
          editGridRows.length === 0 ? (
            <div data-testid="timesheets-empty" className="px-3.5 py-8 text-center">
              <p className="text-sm font-medium text-foreground">
                {t('timesheets.emptyEdit.title', 'No hours logged this week')}
              </p>
              <p className="mt-1 text-[13px] text-muted-foreground">
                {t('timesheets.emptyEdit.sub', 'Use “Add a project” above to start logging hours.')}
              </p>
            </div>
          ) : (
            <TimesheetGrid
              days={gridDays}
              rows={editGridRows}
              editable
              notes={editNotes}
              rawHours={editRawHours}
              invalidCells={invalidCells}
              onCellChange={setCell}
              onNoteChange={setNote}
              onDeleteRow={requestDelete}
            />
          )
        ) : gridRows.length === 0 ? (
          <div data-testid="timesheets-empty">
            <ListState
              variant="empty"
              icon="clock"
              title={t('timesheets.empty.title', 'No hours logged this week')}
              sub={t(
                'timesheets.empty.sub',
                'Add a project to start logging hours, or use the week controls to find another week.',
              )}
            />
          </div>
        ) : (
          <TimesheetGrid days={gridDays} rows={gridRows} />
        )}

        {editable && isDesktop && <TimesheetWeekActions mode="desktop" {...actionProps} />}
      </Card>

      {editable && !isDesktop && <TimesheetWeekActions mode="mobile" {...actionProps} />}

      {/* AC-IXD-TS-004: the per-project + recent-entries rollup panels are removed — the grid's own
          TOTAL column + daily-total row + header weekly total are the single source of truth; the
          rollups live on the Engineer dashboard only (plan task 16). */}

      {isReconciling && !deleteRow.isPending && (
        <div role="alert">
          {t('timesheets:reconcile.message', 'Refresh this week before continuing.')}
          <Button variant="outline" onClick={() => void retryDeleteRefresh()}>
            {t('timesheets:reconcile.retry', 'Retry week refresh')}
          </Button>
        </div>
      )}
      {submitConfirm}

      {rowToDelete && (
        <ConfirmDialog
          open
          tone="destructive"
          title={t('timesheets.deleteRow.title', 'Delete this project row?')}
          description={
            <Trans
              i18nKey="timesheets.deleteRow.description"
              defaults="This removes <strong>{{project}}</strong> and all its hours from this week. You can add it back, but the entered hours won’t be restored."
              values={{ project: rowToDelete.project }}
              components={{ strong: <strong /> }}
            />
          }
          confirmLabel={t('timesheets.deleteRow.confirmLabel', 'Delete row')}
          loading={deleteRow.isPending}
          onCancel={cancelDelete}
          onConfirm={confirmDeleteRow}
        />
      )}
    </div>
  );
};

export default TimesheetsPage;
