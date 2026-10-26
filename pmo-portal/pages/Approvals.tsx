import { approvalStatusLabel } from './approvals/statusLabel';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { Trans, useTranslation } from 'react-i18next';
import { AccessDenied, Button, Card, Checkbox, ConfirmDialog, ListState, StatusPill, TextArea, ViewToggle, useToast } from '@/src/components/ui';
import { describePushMutationError } from '@/src/lib/adapterSeam/pushErrorCopy';
import { usePermission } from '@/src/auth/usePermission';
import { useProcurements } from '@/src/hooks/useProcurements';
import {
  useTimesheetsAwaitingApproval,
  usePushesNeedingAttention,
  useEmployeeLinkConfirm,
  useReopenableApprovedTimesheets,
  useTimesheetMutations,
} from '@/src/hooks/useTimesheetApproval';
import { useAuth } from '@/src/auth/useAuth';
import { useEffectiveRole } from '@/src/auth/impersonation';
import { TimesheetApprovalPreview } from './timesheets/ApprovalsQueue';
import { TimesheetBulkConfirm, TimesheetBulkSelect, TimesheetBulkToolbar, useTimesheetBulkApprove, weekLabel, type BulkController } from './timesheets/TimesheetBulkApprove';
import { ExpenseClaimApprovalSection } from './approvals/ExpenseClaimApprovalSection';
import { SalesInvoiceApprovalSection } from './approvals/SalesInvoiceApprovalSection';
import { useInvoicesAwaitingViewer } from '@/src/hooks/useInvoicesAwaitingViewer';
import { ProcurementApprovalPreview, ProcurementApprovalRow } from './approvals/ProcurementApprovalRow';
import { pendingProcurementApprovals, type ApprovalScope } from '@/src/lib/selectors/approvals';
import { useExpenseClaimsAwaitingDecision, type ExpenseClaimAwaiting } from '@/src/hooks/useExpenseClaims';
import { claimsAwaitingViewer } from '@/src/lib/expenses/expenseRules';
import { workflowVariant } from '@/src/lib/status/statusVariants';
import { formatCurrencyAuto, formatNumberExact } from '@/src/lib/format';
import { PushStateBadge } from '@/src/components/timesheets/PushStateBadge';
import { EmployeeLinkConfirm } from '@/src/components/timesheets/EmployeeLinkConfirm';
import { employeeChoiceLabels } from '@/src/components/timesheets/employeeChoiceLabels';
import type { ProcurementWithRefs } from '@/src/lib/db/procurements';
import { REOPENABLE_WINDOW_DAYS } from '@/src/lib/db/timesheetTransition';
import type { TimesheetAwaitingApproval } from '@/src/lib/db/timesheetTransition';
import WorkPageHeading from './WorkPageHeading';
import type { SalesInvoiceRow } from '@/src/lib/db/revenue';

/** `lg` breakpoint — the two-pane triage activates here. */
const TRIAGE_QUERY = '(min-width: 1024px)';

type Scope = ApprovalScope;

type QueueItem =
  | { key: string; kind: 'procurement'; row: ProcurementWithRefs }
  | { key: string; kind: 'timesheets'; row: TimesheetAwaitingApproval }
  | { key: string; kind: 'expense'; row: ExpenseClaimAwaiting }
  | { key: string; kind: 'invoice'; row: SalesInvoiceRow };

function useIsLargeScreen(): boolean {
  const [matches, setMatches] = useState(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return true;
    return window.matchMedia(TRIAGE_QUERY).matches;
  });

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mql = window.matchMedia(TRIAGE_QUERY);
    setMatches(mql.matches);
    const onChange = (e: MediaQueryListEvent) => setMatches(e.matches);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, []);

  return matches;
}


function sumHours(sheet: TimesheetAwaitingApproval): number {
  return sheet.entries.reduce((sum, e) => sum + e.hours, 0);
}

function QueueButton({
  item,
  selected,
  onSelect,
  bulk,
}: {
  item: QueueItem;
  selected: boolean;
  onSelect: () => void;
  bulk?: BulkController;
}) {
  const { t } = useTranslation();
  if (item.kind === 'procurement') {
    return <ProcurementApprovalRow row={item.row} selected={selected} onSelect={onSelect} />;
  }

  if (item.kind === 'expense' || item.kind === 'invoice') {
    const expense = item.kind === 'expense' ? item.row.claim : null;
    const invoice = item.kind === 'invoice' ? item.row : null;
    const label = item.kind === 'expense'
      ? t('work:approvals.group.expense.title', 'Expense claims')
      : t('work:approvals.group.invoice.title', 'Customer invoices');
    const identity = expense
      ? expense.claim_number ?? expense.title
      : invoice?.customer_name ?? t('work:approvals.unknownCustomer', 'Unknown customer');
    const detail = expense
      ? expense.claimant?.full_name ?? t('approvals.unknownOwner', 'Unknown')
      : invoice?.reference_number ?? invoice?.si_number ?? t('work:approvals.noInvoiceReference', 'Invoice draft');
    const amount = expense
      ? formatCurrencyAuto(Number(expense.amount), expense.currency)
      : invoice?.amount != null ? formatCurrencyAuto(invoice.amount, invoice.currency) : '—';
    const status = expense?.status ?? invoice?.status ?? 'Submitted';

    return (
      <button
        type="button"
        onClick={onSelect}
        aria-pressed={selected}
        data-testid={`approval-item-${item.kind}-${item.key.split(':')[1]}`}
        className={[
          'w-full min-h-11 rounded-lg border px-3 py-3 text-left transition-colors',
          selected ? 'border-foreground/20 bg-secondary/70' : 'border-transparent hover:border-border hover:bg-secondary/40',
        ].join(' ')}
      >
        <div className="mb-1 text-xs font-semibold text-muted-foreground">{label}</div>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <span className="min-w-0 break-words text-sm font-normal">{identity}</span>
          <StatusPill variant={workflowVariant(status)}>{approvalStatusLabel(status, t)}</StatusPill>
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs font-semibold text-muted-foreground">
          <span className="min-w-0 break-words">{detail}</span>
          <span className="text-sm tabular font-normal text-foreground">{amount}</span>
        </div>
      </button>
    );
  }

  const row = item.row;
  const canSelect = bulk?.approvableIds.has(row.id) ?? false;
  const rowButton = (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={[
        'min-w-0 flex-1 rounded-lg border px-3 py-3 text-left transition-colors',
        selected ? 'border-foreground/20 bg-secondary/70' : 'border-transparent hover:border-border hover:bg-secondary/40',
      ].join(' ')}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="break-words text-sm font-normal">
            {row.owner?.full_name ?? t('approvals.unknownOwner', 'Unknown')}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs font-semibold text-muted-foreground">
            <span>{weekLabel(row.week_start_date, t)}</span>
            <span>·</span>
            <span>{row.entries[0]?.project?.name ?? t('approvals.noProjectLinked', 'No project linked')}</span>
          </div>
        </div>
        <StatusPill variant={workflowVariant(row.status)}>{approvalStatusLabel(row.status, t)}</StatusPill>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs font-semibold text-muted-foreground">
        <span>
          {row.entries.length}{' '}
          {row.entries.length === 1
            ? t('approvals.entryOne', 'entry')
            : t('approvals.entryOther', 'entries')}
        </span>
        <span className="text-sm tabular font-normal text-foreground">{formatNumberExact(sumHours(row))}</span>
      </div>
    </button>
  );
  return bulk?.selecting && canSelect ? (
    <div className="flex items-center gap-2">
      <Checkbox checked={bulk.selected.has(row.id)} onChange={() => bulk.toggleSelected(row.id)} label={t('approvals.bulk.rowSelect', "Select {{owner}}'s {{week}}", { owner: row.owner?.full_name ?? t('approvals.unknownOwner', 'Unknown'), week: weekLabel(row.week_start_date, t) })} />
      {rowButton}
    </div>
  ) : rowButton;
}

function QueueGroup({
  title,
  items,
  selectedKey,
  onSelect,
  isPending,
  isError,
  onRetry,
  emptyTitle,
  emptyAction,
  bulk,
}: {
  title: string;
  items: QueueItem[];
  selectedKey: string | null;
  onSelect: (key: string) => void;
  isPending: boolean;
  isError: boolean;
  onRetry: () => void;
  emptyTitle: string;
  emptyAction?: { label: string; onClick: () => void };
  bulk?: BulkController;
}) {
  const { t } = useTranslation();
  return (
    <section>
      {isPending ? (
        <ListState variant="loading" rows={2} className="rounded-lg border border-border/70 p-0" />
      ) : isError ? (
        <ListState
          variant="error"
          title={t('approvals.queue.loadError', "Couldn't load {{queue}}", {
            queue: title.toLowerCase(),
          })}
          sub={t('approvals.queue.loadErrorSub', 'Try again to refresh this queue.')}
          onRetry={onRetry}
        />
      ) : items.length === 0 ? (
        <div
          data-testid="approval-scope-empty"
          role="status"
          className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-secondary/40 px-3 py-2.5 text-sm"
        >
          <span>{emptyTitle}</span>
          {emptyAction && (
            <Button variant="ghost" size="sm" className="touch-target" onClick={emptyAction.onClick}>
              {emptyAction.label}
            </Button>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          {items.map((item, index) => (
            <div key={item.key} className={index > 0 && items[index - 1].kind !== item.kind ? 'pt-4' : undefined}>
              {(index === 0 || items[index - 1].kind !== item.kind) && (
                <h3 className="mb-2 text-xl font-bold text-foreground">
                  {item.kind === 'procurement' ? t('work:approvals.group.procurement.title', 'Purchase requests')
                    : item.kind === 'timesheets' ? t('work:approvals.group.timesheets.hoursTitle', 'Timesheets · hours')
                      : item.kind === 'expense' ? t('work:approvals.group.expense.title', 'Expense claims')
                        : t('work:approvals.group.invoice.title', 'Customer invoices')}
                </h3>
              )}
              <QueueButton
                item={item}
                selected={selectedKey === item.key}
                onSelect={() => onSelect(item.key)}
                bulk={bulk}
              />
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

/**
 * P3b (FR-TSP-085) — the "needs attention" ERP-push queue. Every `failed`/`held` push visible to the
 * caller (RLS is the only scoping authority, task 4.x). NOTHING renders when the list is empty — an
 * unflipped org, or one with no failures, sees no trace of this section (FR-TSP-173).
 */
function PushAttentionSection() {
  const { t } = useTranslation();
  const { currentUser } = useAuth();
  const may = usePermission();
  const { toast } = useToast();
  const { data, isPending, isError, retry: retryMutation } = usePushesNeedingAttention();
  const [retryingId, setRetryingId] = useState<string | null>(null);

  if (isPending || isError || !data || data.length === 0) return null;

  return (
    <section
      className="mb-4"
      aria-label={t('approvals.pushAttention.title', 'ERP pushes needing attention')}
    >
      <h2 className="mb-2 text-xl font-bold text-foreground">
        {t('approvals.pushAttention.title', 'ERP pushes needing attention')}
      </h2>
      <div className="space-y-1.5">
        {data.map((row) => {
          const canRetry = may('push_timesheet', 'timesheet', {
            currentUserId: currentUser?.id,
            record: { approved_by: row.approved_by },
          });
          return (
            <div
              key={row.timesheet_id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-card px-3 py-2.5"
            >
              <div className="min-w-0">
                <div className="text-sm font-normal">{row.owner_name}</div>
                <div className="mt-0.5 text-xs font-semibold text-muted-foreground">
                  {weekLabel(row.week_start_date, t)}
                </div>
              </div>
              <PushStateBadge
                state={{ push_state: row.push_state, push_error: row.push_error, ts_number: row.ts_number }}
                canRetry={canRetry}
                retryLoading={retryingId === row.timesheet_id && retryMutation.isPending}
                // ⚑ I-13 (rendered Discover pass, 2026-07-22) — this Retry gave ZERO feedback: no
                // toast, no state change, no console error, while the budget surface's Retry two
                // screens away toasts both outcomes. A silent retry is indistinguishable from a dead
                // button, so an operator either gives up or clicks it repeatedly. BOTH outcomes are
                // now stated, at the call site that knows which row they belong to.
                onRetry={() => {
                  setRetryingId(row.timesheet_id);
                  retryMutation.mutate(
                    { timesheetId: row.timesheet_id },
                    {
                      onSuccess: () =>
                        toast(
                          t('approvals.pushAttention.retrySuccess', 'Timesheet pushed to ERPNext'),
                          `${row.owner_name} · ${weekLabel(row.week_start_date, t)}`,
                          'success',
                        ),
                      // ⚑ NEW-2 (rendered re-verification, 2026-07-22) — I-13 gave this Retry a
                      // voice and gave it the WRONG one. `classifyMutationError` is the generic CRUD
                      // classifier: it passes the server's message through as `detail`, so the toast
                      // read "That timesheet could not be pushed — timesheet-not-approved (status
                      // Submitted)" — a raw adapter token on an operator surface, the precise thing
                      // `pushErrorCopy` exists to prevent and which the badge two lines above already
                      // obeys. A push failure is translated by the push vocabulary, on EVERY path.
                      onError: (err) => {
                        const copy = describePushMutationError(err);
                        toast(
                          t(
                            'approvals.pushAttention.retryFailure',
                            'That timesheet could not be pushed',
                          ),
                          copy.remedy ? `${copy.message} ${copy.remedy}` : copy.message,
                          'warning',
                        );
                      },
                      onSettled: () => setRetryingId(null),
                    },
                  );
                }}
              />
            </div>
          );
        })}
      </div>
    </section>
  );
}

/**
 * P3b (OQ-TSP-10(C) — the owner ruling) — the Employee-adopt-link Admin queue. Renders nothing when
 * there is no proposed link (the common case for every org that hasn't flipped `timesheets`).
 */
function EmployeeLinkConfirmSection() {
  const { t } = useTranslation();
  const may = usePermission();
  const { links, profiles, confirm } = useEmployeeLinkConfirm();
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const profileOptions = useMemo(() => employeeChoiceLabels(
    (Array.isArray(profiles) ? profiles : []).map((profile) => ({
      value: profile.id,
      name: profile.full_name,
      email: profile.email,
    })),
  ), [profiles]);

  if (links.isPending || links.isError || !links.data || links.data.length === 0) return null;

  return (
    <section
      className="mb-4"
      aria-label={t('approvals.employeeLinks.title', 'Employee links awaiting confirmation')}
    >
      <h2 className="mb-2 text-xl font-bold text-foreground">
        {t('approvals.employeeLinks.title', 'Employee links awaiting confirmation')}
      </h2>
      <EmployeeLinkConfirm
        links={links.data}
        profileOptions={profileOptions}
        canConfirm={may('confirm_employee_link', 'employeeLink')}
        confirmingId={confirmingId}
        onConfirm={async (link) => {
          setConfirmingId(link.id);
          try {
            await confirm.mutateAsync({ erpEmployeeId: link.id, profileId: link.profile_id! });
          } finally {
            setConfirmingId(null);
          }
        }}
      />
    </section>
  );
}

/**
 * Slice A (FR-TSC-060, AC-TSC-R3, FENCE 5) — the Approved sheets an approver may re-open for
 * correction.
 *
 * ⚑ SURFACE HONESTY IS THE POINT, not the button. An Approved sheet may return to Draft ONLY while
 * ERP holds no document for it; the RPC is the authority and it FAILS CLOSED on any doubt. So a row
 * that cannot be re-opened must say WHY — a disabled control with no reason reads as a dead button
 * (the I-13 lesson two sections up: a silent affordance is indistinguishable from a broken one).
 * Hence four distinct renderings, never a greyed-out button:
 *   • no mirror row                    → "Re-open for correction" (the action)
 *   • mirror.ts_number set             → "Already pushed to ERP — correction path coming" (Slice B)
 *   • mirror.post_submit_unknown_at    → "ERP result unknown — an administrator must confirm what
 *                                        ERPNext holds" (⚑ round-8 BLOCK: NOT visible from push_state,
 *                                        which reads an ordinary `failed` once a hold is released)
 *   • push in flight                   → "Push in progress" (transient; retry later)
 * The RPC's own refusals (`reopen-erp-document-held` / `reopen-push-outcome-unknown` /
 * `reopen-push-in-flight`) are classified to the
 * same honest wording — the client's read can be stale, so the server always gets the last word.
 */
function ReopenableApprovedSection({ hasPending }: { hasPending: boolean }) {
  const { t } = useTranslation();
  const may = usePermission();
  const { toast } = useToast();
  const { data, isPending, isError } = useReopenableApprovedTimesheets();
  const { reopenApproved, attestNoErpDocument } = useTimesheetMutations();
  const [reopeningId, setReopeningId] = useState<string | null>(null);
  // ⚑ SHOULD-FIX 1 (Luna FU-1a round-12) — the attestation is the ONLY route out of an ERP unknown.
  // Admin-only on the REAL role (`can()` is UX; the RPC re-asserts org + Admin + active membership).
  // Reason-required (the RPC demands it), so the confirm is a dialog, not a one-click write.
  const canAttest = may('manage', 'pushHold');
  const [attestFor, setAttestFor] = useState<{ id: string; owner: string } | null>(null);
  const [attestReason, setAttestReason] = useState('');

  const closeAttest = () => {
    setAttestFor(null);
    setAttestReason('');
  };

  const submitAttest = () => {
    if (!attestFor || attestReason.trim() === '') return;
    const target = attestFor;
    attestNoErpDocument.mutate(
      { id: target.id, reason: attestReason.trim() },
      {
        onSuccess: () => {
          closeAttest();
          toast(
            t('approvals.reopen.attestSuccess', 'Confirmed — the week is clear to re-open'),
            `${target.owner}: ${t('approvals.reopen.attestSuccessDetail', 'ERPNext holds no document')}`,
            'success',
          );
        },
        // I-13: a silent affordance reads as broken, so BOTH outcomes speak. The server's fail-closed
        // refusals (42501 not-authorized, P0001 nothing-to-attest) are surfaced in the user's terms.
        onError: (err: unknown) => {
          const msg = err instanceof Error ? err.message : String(err);
          toast(t('approvals.reopen.attestFailure', 'Could not confirm the ERP result'), msg, 'warning');
        },
      },
    );
  };

  if (isPending || isError || !data || data.length === 0) return null;

  return (
    <section
      className="mb-4"
      aria-label={t(
        'approvals.reopen.sectionLabel',
        'Approved timesheets from the last {{days}} days that can be re-opened for correction',
        { days: String(REOPENABLE_WINDOW_DAYS) },
      )}
    >
      <details open={!hasPending} className="rounded-lg border border-border/70 px-3 py-2">
        <summary className="touch-target flex min-h-11 cursor-pointer items-center text-xl font-bold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
          {t('approvals.reopen.heading', 'Approved history and corrections')} <span className="text-xs font-semibold tabular text-muted-foreground">{data.length}</span> <span className="text-[11px] font-semibold text-muted-foreground">({t('approvals.reopen.window', 'last {{days}} days', { days: String(REOPENABLE_WINDOW_DAYS) })})</span>
        </summary>
        <div className="mt-2 space-y-1.5">
        {data.map((row) => {
          // The SAME two pieces of evidence the RPC's precondition weighs (migration 0151 §A): a live
          // mirror document, and a NON-TERMINAL push command. ⚑ SHOULD-FIX 4 (Luna code review): the
          // in-flight test used to read `mirror.push_state`, but the mirror row is written only AFTER
          // the ERP call settles — so a queued/committing/committed push arrived here as `mirror: null`
          // and rendered an ACTIVE button the server would refuse, while the two states it did test for
          // (`pending`/`pushing`) are written by no shipped writer at all.
          const pushed = Boolean(row.mirror?.ts_number) && !row.mirror?.erp_cancelled_at;
          // ⚑ Luna FU-1a round-8 BLOCK — the week whose ERP outcome PMO never learned. Independent of
          // push_state on purpose: once an Admin releases the hold (to restore the backstop route) this
          // row reads `failed` like any rejected push, and the server still refuses it. Classifying on
          // the witness is the only way the surface agrees with the RPC.
          // ⚑ Luna FU-1a round-10 S3 — the mirror's own `held` state is the SAME server refusal. 0157 §4
          // keeps `push_state = 'held'` as an INDEPENDENT predicate for the pre-0157 residue (a row parked
          // `held` before the witness column existed), so classifying on the witness alone rendered an
          // active button the server could only refuse.
          const hasWitness = !pushed && Boolean(row.mirror?.post_submit_unknown_at);
          const outcomeUnknown = hasWitness || (!pushed && row.mirror?.push_state === 'held');
          const inFlight = !pushed && !outcomeUnknown && row.pushCommandState !== null;
          // The attestation clears a WITNESS (0157 §5). A pre-0157-residue `held` mirror carries none,
          // so the RPC would refuse it — offer the affordance ONLY where it can succeed (a real
          // witness). Those residue rows keep the note; their route out is documented separately.
          const offerAttest = canAttest && hasWitness;
          return (
            <div
              key={row.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-card px-3 py-2.5"
            >
              <div className="min-w-0">
                <div className="text-sm font-normal">
                  {row.owner?.full_name ?? t('approvals.unknownOwner', 'Unknown')}
                </div>
                <div className="mt-0.5 text-sm text-muted-foreground">
                  {weekLabel(row.week_start_date, t)}
                </div>
              </div>
              {pushed ? (
                <span className="text-sm text-muted-foreground">
                  {t('approvals.reopen.alreadyPushed', 'Already pushed to ERP — correction path coming')}
                </span>
              ) : outcomeUnknown ? (
                <div className="flex flex-wrap items-center justify-end gap-2">
                  <span className="text-sm text-muted-foreground">
                    {t(
                      'approvals.reopen.outcomeUnknown',
                      'ERP result unknown — an administrator must confirm what ERPNext holds',
                    )}
                  </span>
                  {offerAttest && (
                    <button
                      type="button"
                      className="touch-target h-8 rounded-md border border-border px-3 text-xs font-semibold hover:bg-accent"
                      onClick={() => {
                        setAttestReason('');
                        setAttestFor({
                          id: row.id,
                          owner: row.owner?.full_name ?? t('approvals.unknownOwner', 'Unknown'),
                        });
                      }}
                    >
                      {t('approvals.reopen.confirmErpButton', 'Confirm what ERPNext holds')}
                    </button>
                  )}
                </div>
              ) : inFlight ? (
                <span className="text-sm text-muted-foreground">
                  {t('approvals.reopen.pushInProgress', 'Push in progress')}
                </span>
              ) : (
                <button
                  type="button"
                  className="touch-target h-8 rounded-md border border-border px-3 text-xs font-semibold hover:bg-accent disabled:opacity-50"
                  disabled={reopeningId === row.id && reopenApproved.isPending}
                  onClick={() => {
                    setReopeningId(row.id);
                    reopenApproved.mutate(
                      { id: row.id },
                      {
                        onSuccess: () => {
                          setReopeningId(null);
                          toast(
                            t(
                              'approvals.reopen.success',
                              'Re-opened — the week is back in Draft for editing.',
                            ),
                            'success',
                          );
                        },
                        onError: (err: unknown) => {
                          setReopeningId(null);
                          const msg = err instanceof Error ? err.message : String(err);
                          // The server's fail-closed refusals, said in the user's terms. Anything
                          // else is surfaced verbatim rather than flattened to "something went wrong".
                          if (msg.includes('reopen-erp-document-held')) {
                            toast(
                              t(
                                'approvals.reopen.errorDocumentHeld',
                                'Already in ERP — this week cannot be re-opened yet.',
                              ),
                              'error',
                            );
                          } else if (msg.includes('reopen-push-outcome-unknown')) {
                            // Migrations 0152 §B / 0157 §4: the ERP push SUCCEEDED and its read-back
                            // failed, so nobody knows whether ERPNext holds a document for this week.
                            // "Try again shortly" would be false, and so would "an administrator must
                            // release the held push" (⚑ round-8 BLOCK): a release re-queues the command
                            // and learns nothing about ERPNext, so it does NOT lift this refusal. The
                            // only true instruction is that someone must go and establish what ERP holds.
                            toast(
                              t(
                                'approvals.reopen.errorOutcomeUnknown',
                                'This week’s ERP result is unknown — an administrator must confirm what ERPNext holds before it can be re-opened.',
                              ),
                              'error',
                            );
                          } else if (msg.includes('reopen-push-in-flight')) {
                            toast(
                              t(
                                'approvals.reopen.errorPushInFlight',
                                'A push is in flight for this week — try again shortly.',
                              ),
                              'error',
                            );
                          } else {
                            toast(`${t('approvals.reopen.errorGeneric', 'Could not re-open')}: ${msg}`, 'error');
                          }
                        },
                      },
                    );
                  }}
                >
                  {t('approvals.reopen.action', 'Re-open for correction')}
                </button>
              )}
            </div>
          );
        })}
        </div>
      </details>

      {/* ⚑ SHOULD-FIX 1 — the attestation confirm. Reason-required (the confirm is gated until the
          textarea is non-empty, matching the RPC's own P0001 refusal on an empty reason). Nothing
          writes on a single click (owner rule); the RPC is Admin-only + audited. */}
      <ConfirmDialog
        open={attestFor !== null}
        title={t('approvals.attest.title', 'Confirm what ERPNext holds')}
        description={
          <div className="space-y-3">
            <p>
              {/* #571 — ONE sentence, not five fragments: the emphasis and the person are
                  placeholders a translator moves, so a language that orders the clause
                  differently still reads as prose. */}
              <Trans
                i18nKey="approvals.attest.body"
                defaults="Certify that you have checked ERPNext and it holds <strong>no Timesheet</strong> for {{person}}’s week. This records an audited attestation and re-opens the week for correction — it does not contact ERPNext."
                values={{
                  person: attestFor
                    ? attestFor.owner
                    : t('approvals.attest.thisPerson', 'this person'),
                }}
                components={{ strong: <strong /> }}
              />
            </p>
            <TextArea
              label={t('approvals.attest.reasonLabel', 'What did you check in ERPNext?')}
              required
              value={attestReason}
              onChange={setAttestReason}
              placeholder={t(
                'approvals.attest.reasonPlaceholder',
                'e.g. Searched Timesheets for this employee and week — none exists.',
              )}
            />
          </div>
        }
        confirmLabel={t('approvals.attest.confirmLabel', 'Confirm — no ERP document')}
        cancelLabel={t('approvals.attest.cancelLabel', 'Cancel')}
        loading={attestNoErpDocument.isPending}
        confirmDisabled={attestReason.trim() === ''}
        onConfirm={submitAttest}
        onCancel={closeAttest}
      />
    </section>
  );
}

const ApprovalsPage: React.FC = () => {
  const { t } = useTranslation();
  const may = usePermission();
  const navigate = useNavigate();
  const { currentUser } = useAuth();
  const selfId = currentUser?.id;
  const { realRole } = useEffectiveRole();
  const [searchParams, setSearchParams] = useSearchParams();
  const isLargeScreen = useIsLargeScreen();

  const canApproveProcurement = may('transition', 'procurement');
  const canApproveTimesheets = may('transition', 'approval');
  const canApproveExpenses = ['Admin', 'Executive', 'Finance', 'Project Manager'].includes(realRole ?? '');
  const canApproveInvoices = may('transition', 'salesInvoice');

  const { data: procurements, isPending: procPending, isError: procError, refetch: refetchProc } = useProcurements();
  const { data: timesheets, isPending: tsPending, isError: tsError, refetch: refetchTimesheets } = useTimesheetsAwaitingApproval();
  // #784 C-1: the same source the "Customer invoices awaiting you" section lists, so the page never claims "all caught
  // up" above a waiting invoice.
  const invoices = useInvoicesAwaitingViewer();
  const expenseQuery = useExpenseClaimsAwaitingDecision();
  const expenseRows = useMemo(
    () => canApproveExpenses
      ? claimsAwaitingViewer(expenseQuery.data ?? [], selfId, realRole)
      : [],
    [canApproveExpenses, expenseQuery.data, selfId, realRole],
  );

  const procurementRows = useMemo(
    () => pendingProcurementApprovals(procurements, selfId, realRole === 'Admin').sort(
      (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
    ),
    [procurements, selfId, realRole],
  );
  const timesheetRows = useMemo(() => timesheets ?? [], [timesheets]);
  const timesheetBulk = useTimesheetBulkApprove(timesheetRows);

  const canShowExpenses = canApproveExpenses && (expenseRows.length > 0 || expenseQuery.isPending || expenseQuery.isError);
  const canShowInvoices = canApproveInvoices && (invoices.rows.length > 0 || invoices.isPending || invoices.isError);
  const availableKinds: Scope[] = [
    ...(canApproveProcurement ? ['procurement' as const] : []),
    ...(canApproveTimesheets ? ['timesheets' as const] : []),
    ...(canApproveExpenses ? ['expense' as const] : []),
    ...(canApproveInvoices && invoices.enabled !== false ? ['invoice' as const] : []),
  ];
  const availableScopes: Scope[] = [
    ...(availableKinds.length > 1 ? (['all'] as const) : []),
    ...availableKinds,
  ];
  const hasTabs = availableScopes.length > 1;
  const urlScope = searchParams.get('scope') as Scope | null;
  const activeScope: Scope =
    urlScope && availableScopes.includes(urlScope)
      ? urlScope
      : availableScopes[0];

  const selectScope = (next: Scope) => {
    const params = new URLSearchParams(searchParams);
    params.set('scope', next);
    setSearchParams(params, { replace: true });
  };

  const pendingProc = canApproveProcurement ? procurementRows.length : 0;
  const pendingTs = canApproveTimesheets ? timesheetRows.length : 0;

  const procSettledEmpty = !canApproveProcurement || (!procPending && !procError && pendingProc === 0);
  const tsSettledEmpty = !canApproveTimesheets || (!tsPending && !tsError && pendingTs === 0);
  const pendingInv = canShowInvoices ? invoices.rows.length : 0;
  const pendingExpense = canShowExpenses ? expenseRows.length : 0;
  const invSettledEmpty = !invoices.isPending && !invoices.isError && pendingInv === 0;
  const expenseSettledEmpty = !expenseQuery.isPending && !expenseQuery.isError && pendingExpense === 0;
  const allCaughtUp = procSettledEmpty && tsSettledEmpty && invSettledEmpty && expenseSettledEmpty;
  const pendingRowsCount = (canApproveProcurement ? procurementRows.length : 0)
    + (canApproveTimesheets ? timesheetRows.length : 0)
    + (canShowExpenses ? expenseRows.length : 0)
    + (canShowInvoices ? invoices.rows.length : 0);
  const scopeLabels: Record<Scope, string> = {
    all: t('approvals.scope.all', 'All pending'),
    procurement: t('approvals.scope.procurement', 'Purchase requests'),
    timesheets: t('approvals.scope.timesheets', 'Timesheets'),
    expense: t('approvals.scope.expense', 'Expense claims'),
    invoice: t('approvals.scope.invoice', 'Customer invoices'),
  };
  // Only name queues this viewer can act on; the empty state must not imply inaccessible work is theirs.
  const caughtUpLabels = availableKinds.map((kind) => scopeLabels[kind].toLowerCase());
  const caughtUpKinds = caughtUpLabels.length === 0
    ? t('approvals.caughtUp.noKinds', 'approvals')
    : caughtUpLabels.length === 1
      ? caughtUpLabels[0]
      : `${caughtUpLabels.slice(0, -1).join(', ')} ${t('approvals.caughtUp.and', 'and')} ${caughtUpLabels[caughtUpLabels.length - 1]}`;

  const queueItems = useMemo<QueueItem[]>(() => {
    const items: QueueItem[] = [];
    if ((activeScope === 'all' || activeScope === 'procurement') && canApproveProcurement) {
      items.push(...procurementRows.map((row) => ({ key: `procurement:${row.id}`, kind: 'procurement' as const, row })));
    }
    if ((activeScope === 'all' || activeScope === 'timesheets') && canApproveTimesheets) {
      items.push(...timesheetRows.map((row) => ({ key: `timesheets:${row.id}`, kind: 'timesheets' as const, row })));
    }
    if ((activeScope === 'all' || activeScope === 'expense') && canApproveExpenses) {
      items.push(...expenseRows.map((row) => ({ key: `expense:${row.claim.id}`, kind: 'expense' as const, row })));
    }
    if ((activeScope === 'all' || activeScope === 'invoice') && canApproveInvoices && invoices.enabled !== false) {
      items.push(...invoices.rows.map((row) => ({ key: `invoice:${row.id}`, kind: 'invoice' as const, row })));
    }
    return items.sort((a, b) => {
      const timestamp = (item: QueueItem) => {
        const date = item.kind === 'timesheets' ? item.row.week_start_date
          : item.kind === 'expense' ? item.row.claim.created_at
            : item.row.created_at;
        const parsed = Date.parse(date);
        return Number.isFinite(parsed) ? parsed : 0;
      };
      return timestamp(a) - timestamp(b) || a.key.localeCompare(b.key);
    });
  }, [activeScope, canApproveProcurement, canApproveTimesheets, canApproveExpenses, canApproveInvoices, invoices.enabled, invoices.rows, procurementRows, timesheetRows, expenseRows]);

  const selectedKey = searchParams.get('selected');
  const setSelectedKey = useCallback((key: string | null) => {
    const next = new URLSearchParams(searchParams);
    if (key) next.set('selected', key);
    else next.delete('selected');
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  useEffect(() => {
    if (queueItems.length === 0) {
      if (selectedKey) setSelectedKey(null);
      return;
    }
    if (selectedKey && !queueItems.some((item) => item.key === selectedKey)) {
      setSelectedKey(null);
      return;
    }
    if (isLargeScreen && !selectedKey) {
      setSelectedKey(queueItems[0].key);
    }
  }, [isLargeScreen, queueItems, selectedKey, setSelectedKey]);

  const pickItem = (key: string) => setSelectedKey(key);
  const selectedItem = queueItems.find((item) => item.key === selectedKey) ?? null;

  const stateForKind = (kind: Scope): { pending: boolean; error: boolean; retry: () => void } => {
    switch (kind) {
      case 'procurement': return { pending: procPending, error: procError, retry: () => void refetchProc() };
      case 'timesheets': return { pending: tsPending, error: tsError, retry: () => void refetchTimesheets() };
      case 'expense': return { pending: expenseQuery.isPending, error: expenseQuery.isError, retry: () => void expenseQuery.refetch() };
      case 'invoice': return { pending: invoices.isPending, error: invoices.isError, retry: () => void invoices.refetch() };
      case 'all': return { pending: false, error: false, retry: () => undefined };
      default: return { pending: false, error: false, retry: () => undefined };
    }
  };
  const scopeKinds = activeScope === 'all' ? availableKinds : activeScope ? [activeScope] : [];
  const activeScopePending = scopeKinds.some((kind) => stateForKind(kind).pending);
  const activeScopeError = scopeKinds.some((kind) => stateForKind(kind).error);
  const retryActiveScope = () => scopeKinds.forEach((kind) => { if (stateForKind(kind).error) stateForKind(kind).retry(); });
  const countAvailable = (scope: Scope) => !(scope === 'all' ? availableKinds : [scope]).some((kind) => {
    const state = stateForKind(kind);
    return state.pending || state.error;
  });
  const countFor = (scope: Scope) => ({
    all: pendingProc + pendingTs + pendingExpense + pendingInv,
    procurement: pendingProc,
    timesheets: pendingTs,
    expense: pendingExpense,
    invoice: pendingInv,
  }[scope]);
  const emptyQueueTitle = activeScope && activeScope !== 'all'
    ? t('work:approvals.queueEmptyScopeTitle', 'No {{scope}} awaiting your decision', { scope: scopeLabels[activeScope].toLowerCase() })
    : t('work:approvals.queueEmptyTitle', 'No requests awaiting your decision');
  const emptyQueueAction = activeScope !== 'all' && availableScopes.includes('all')
    ? { label: t('work:approvals.showAllPending', 'Show all pending'), onClick: () => selectScope('all') }
    : undefined;

  if (!canApproveProcurement && !canApproveTimesheets && !canApproveExpenses && !canApproveInvoices) {
    return (
      <>
        <WorkPageHeading title={t('work:workPageHeading.approvals', 'Approvals')} scope={t('work:workPageHeading.approvalsScope', 'My decisions')} />
        <AccessDenied
          title={t('approvals.accessDenied.title', "You don't have access to approvals")}
          sub={t(
            'approvals.accessDenied.sub',
            'Approvals are for the roles that sign off purchase requests or timesheets. Your work lives on your dashboard, projects, and tasks.',
          )}
          onBack={() => navigate('/')}
        />
      </>
    );
  }

  const previewFallback = (() => {
    if (queueItems.length > 0) return null;
    if (activeScopePending) return <ListState variant="loading" rows={4} />;
    if (activeScopeError) {
      return (
        <ListState
          variant="error"
          title={t('approvals.previewError.title', "Couldn't load the selected queue")}
          sub={t(
            'approvals.previewError.sub',
            'Retry from the queue pane to refresh the latest approvals.',
          )}
        />
      );
    }
    return (
      <ListState
        variant="empty"
        icon="inbox"
        title={t('approvals.previewEmpty.title', 'Select an approval item')}
        sub={t(
          'approvals.previewEmpty.sub',
          'When a pending request is available, its preview and actions appear here.',
        )}
      />
    );
  })();

  const selectedPreview = selectedItem ? (
    selectedItem.kind === 'procurement' ? <ProcurementApprovalPreview row={selectedItem.row} />
      : selectedItem.kind === 'timesheets' ? <TimesheetApprovalPreview sheet={selectedItem.row} surface="panel" />
        : selectedItem.kind === 'expense' ? <ExpenseClaimApprovalSection selectedClaimId={selectedItem.row.claim.id} />
          : <SalesInvoiceApprovalSection selectedInvoiceId={selectedItem.row.id} />
  ) : previewFallback;

  return (
    <div>
      <WorkPageHeading
        title={t('approvals.title', 'Approvals')}
        scope={t('work:workPageHeading.approvalsScope', 'My decisions')}
        kind="review"
      />

      {hasTabs && !allCaughtUp && (
        <div className="mb-4 min-w-0">
          <div data-testid="approvals-scope-filters" className="min-w-0">
            <ViewToggle<Scope>
              className="max-w-full flex-wrap"
              options={availableScopes.map((scope) => ({
                value: scope,
                label: scopeLabels[scope],
                icon: ({ all: 'grid', procurement: 'cart', timesheets: 'clock', expense: 'file', invoice: 'file' } as const)[scope],
                ...(countAvailable(scope) ? { count: countFor(scope) } : {}),
              }))}
              value={activeScope}
              onChange={selectScope}
              ariaLabel={t('approvals.scopeToggleLabel', 'Approvals scope')}
            />
          </div>
        </div>
      )}

      {allCaughtUp ? (
        <div
          className="flex flex-col items-center justify-center gap-2 rounded-lg border border-border bg-card px-6 py-14 text-center"
          data-testid="approvals-caught-up"
        >
          <h2 className="text-xl font-bold">
            {t('approvals.caughtUp.title', 'You’re all caught up')}
          </h2>
          <p className="max-w-[44ch] text-sm text-muted-foreground">
            {t(
              'approvals.caughtUp.sub',
              'Nothing is waiting on your approval in PMO right now. New {{kinds}} entered in PMO will appear here. Documents entered directly in ERPNext are approved in ERPNext.',
              { kinds: caughtUpKinds },
            )}
          </p>
        </div>
      ) : (
        <>
        {!isLargeScreen && selectedItem ? (
          <div className="space-y-3">
            <Button variant="outline" size="sm" onClick={() => setSelectedKey(null)}>{t('work:approvals.backToQueue', 'Back to queue')}</Button>
            <Card variant="bare" role="region" aria-label={t('approvals.previewRegionLabel', 'Approval preview')} id="approvals-preview" data-testid="approvals-preview-region" className="min-w-0">
              {selectedPreview}
            </Card>
          </div>
        ) : (
        <div className="grid gap-8 lg:grid-cols-[minmax(0,360px)_minmax(0,1fr)] lg:items-start">
          <Card
            variant="bare"
            role="region"
            aria-label={t('approvals.queueRegionLabel', 'Approvals queue')}
            data-testid="approvals-queue-region"
            className="min-w-0"
          >
            <div className="mb-4 flex items-center justify-between gap-2 border-b border-border pb-3">
              <div>
                <h2 className="text-xl font-bold">
                  {t('approvals.queueHeading', 'Approvals queue')}
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">{t('work:approvals.oldestFirst', 'Oldest first')}</p>
              </div>
              <div className="flex items-center gap-2">
                {(activeScope === 'all' || activeScope === 'timesheets') && canApproveTimesheets && <TimesheetBulkSelect controller={timesheetBulk} />}
              </div>
            </div>

            {(activeScope === 'all' || activeScope === 'timesheets') && canApproveTimesheets && (
              <>
                <TimesheetBulkToolbar controller={timesheetBulk} />
                <TimesheetBulkConfirm controller={timesheetBulk} sheets={timesheetRows} />
              </>
            )}

            <div className="space-y-3">
              <QueueGroup
                title={t('approvals.queueHeading', 'Approvals queue')}
                items={queueItems}
                selectedKey={selectedKey}
                onSelect={pickItem}
                isPending={activeScopePending && queueItems.length === 0}
                isError={activeScopeError && queueItems.length === 0}
                onRetry={retryActiveScope}
                emptyTitle={emptyQueueTitle}
                emptyAction={emptyQueueAction}
                bulk={timesheetBulk}
              />
              {activeScopeError && queueItems.length > 0 && (
                <div role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-secondary/40 px-3 py-2.5 text-sm">
                  <span>{t('work:approvals.queuePartialError', 'Some approval items could not be loaded.')}</span>
                  <Button variant="outline" size="sm" onClick={retryActiveScope}>
                    {t('work:approvals.queueRetry', 'Retry')}
                  </Button>
                </div>
              )}
            </div>
          </Card>

          {isLargeScreen && (
            <Card
              variant="bare"
              role="region"
              aria-label={t('approvals.previewRegionLabel', 'Approval preview')}
              id="approvals-preview"
              data-testid="approvals-preview-region"
              className="min-w-0"
            >
              {selectedPreview}
            </Card>
          )}
        </div>
        )}
        </>
      )}

      {canApproveTimesheets && <PushAttentionSection />}
      {canApproveTimesheets && <EmployeeLinkConfirmSection />}
      {canApproveTimesheets && <ReopenableApprovedSection hasPending={pendingRowsCount > 0 || procPending || tsPending || expenseQuery.isPending || invoices.isPending} />}
    </div>
  );
};

export default ApprovalsPage;
