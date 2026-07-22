import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ListState, GateNotice, Button, StatusPill, NumberField, useToast } from '@/src/components/ui';
import { usePermission } from '@/src/auth/usePermission';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import { describePushError } from '@/src/lib/adapterSeam/pushErrorCopy';
import { formatCurrency, parseMoneyInput, pct } from '@/src/lib/format';
import {
  fetchBudgetProjection,
  fetchBudgetPushStatus,
  listBudgetFiscalYears,
  upsertBudgetProjectionEtc,
  retryActiveBudgetPush,
  type BudgetFiscalYearRow,
  type BudgetProjectionCellRow,
  type BudgetPushStatusRow,
  type BudgetCategory,
} from '@/src/lib/repositories/budgetProjection';

/**
 * BudgetProjection (P3c slice 6, FR-BUD-151/152/153) — PMO's FORWARD VIEW for a project.
 *
 * ⚑ "Projection" here = PMO's own forward-looking derived view, per category: Budget (PMO) | Actuals
 * to date (ERP GL, P2's shipped snapshot) | ETC (PMO, editable) | Projected final (EAC) | Variance |
 * Utilization. This is NEVER ADR-0055 §6's "projected into the ERP object" (that means PUSHED — see
 * `erpnext/bodies/budget.ts`); nothing rendered or edited here is ever sent to ERP (FR-BUD-160,
 * structural proof: `budgetNeverPushesProjection.test.ts`).
 *
 * ⚑ Divergence (FR-BUD-152): PMO's own budget figure stays authoritative and displayed regardless of
 * push health — a failed/held push is reported via the banner below, never substituted for the figure.
 *
 * ⚑ The ETC cell is editable only under OD-BUDGET-3 (`can('edit', 'budgetLine', ctx)` — the shipped
 * MASTER_DATA set: Admin/Executive/Project Manager/Finance, the same role gate as
 * `budget_projections_write`). This is UX only; RLS is the authority (ADR-0016).
 *
 * ⚑ MONEY HONESTY (rendered Discover pass, 2026-07-22 — C-1/C-2/C-3). A figure the system cannot know
 * is NEVER rendered as a number. `actualsToDate === null` means "this category has no ERP account
 * mapped, so its spend is unreadable" — not zero — and every figure derived from it is unavailable
 * too. `$0.00` is reserved for a real, computed zero. See `money`/`Unavailable` below.
 */

export interface BudgetProjectionProps {
  projectId: string;
}

/** Where an Admin fixes the category↔ERP-account map (a section of the Administration page). */
const ACCOUNT_MAP_HREF = '/administration#budget-account-map';

const CATEGORY_LABELS: Record<string, string> = {}; // reserved for future per-org relabeling; identity today.
const labelFor = (c: string) => CATEGORY_LABELS[c] ?? c;

/**
 * ⚑ C-1/C-2 — the em-dash is not a formatting choice, it is a STATEMENT, and a bare one reads as "we
 * forgot". `reason` becomes the cell's `title` + accessible text so the absence explains itself in
 * both the visual and the accessibility tree.
 */
const Unavailable: React.FC<{ reason: string }> = ({ reason }) => (
  <span title={reason}>
    <span aria-hidden>—</span>
    <span className="sr-only">{reason}</span>
  </span>
);

const NO_ERP_ACCOUNT =
  'Not available: no ERP account is mapped for this category, so its spend cannot be read from the ledger.';
const NO_BUDGET_LINE = 'Not available: the active budget version has no line for this category.';

const money = (v: number | null, reason: string): React.ReactNode =>
  v === null ? <Unavailable reason={reason} /> : formatCurrency(v);

// ── C-5: every push state gets its own statement. A state that renders nothing is a defect, not a
// default — silence is indistinguishable from absence (DESIGN.md §Data & States).
const QUIET_STATES: Record<string, { label: string; variant: 'neutral' | 'progress' | 'won'; detail: string }> = {
  pending: {
    label: 'Waiting to reach ERPNext',
    variant: 'neutral',
    detail: 'This budget is queued for ERPNext and has not been sent yet.',
  },
  pushing: {
    label: 'Sending to ERPNext',
    variant: 'progress',
    detail: 'This budget is being sent to ERPNext now.',
  },
  pushed: {
    label: 'Enforced by ERPNext',
    variant: 'won',
    detail: 'ERPNext is enforcing this budget.',
  },
};

const BLOCKED_STATES = new Set(['failed', 'held', 'never-pushed', 'unstamped-activation']);

const BudgetProjection: React.FC<BudgetProjectionProps> = ({ projectId }) => {
  const may = usePermission();
  const canEditEtc = may('edit', 'budgetLine');
  const { toast } = useToast();
  const qc = useQueryClient();

  // ⚑ H-4 (Luna audit round 3): the fiscal year is READ, never synthesized. `fiscal_year` on both
  // `erp_actuals_snapshot` and `budget_version_erp_mirror` carries the ERPNext `Fiscal Year` NAME the
  // client declared (round-2 OQ-BUD-3b: "a fiscal year is whatever the client declares"), and every
  // read joins it by EQUALITY. Synthesizing `new Date().getFullYear()` therefore joined NOTHING for any
  // non-calendar client — a Jul–Jun client's year is named '2025-2026' — so this screen showed actuals
  // 0.00, variance = the entire budget, utilization ~0 and NO push banner, silently, with no option in
  // the selector that could reach the real data. PMO does not own the client's calendar and must never
  // guess its format: the selector offers exactly the years that exist, so every option can return rows.
  const yearsQuery = useQuery<BudgetFiscalYearRow[]>({
    queryKey: ['budget-fiscal-years', projectId],
    queryFn: () => listBudgetFiscalYears(projectId),
  });
  const fiscalYears = useMemo(() => yearsQuery.data ?? [], [yearsQuery.data]);

  // Derived, never an effect: the user's pick wins; otherwise the year the ACTIVE version was pushed
  // against; otherwise the newest on record; otherwise `null` = "no fiscal year on record" (a real
  // state, not a placeholder). A pick that is no longer offered falls back the same way.
  const [pickedYear, setPickedYear] = useState<string | null>(null);
  const fiscalYear = useMemo<string | null>(() => {
    if (pickedYear && fiscalYears.some((y) => y.fiscalYear === pickedYear)) return pickedYear;
    return fiscalYears.find((y) => y.isActivePush)?.fiscalYear ?? fiscalYears[0]?.fiscalYear ?? null;
  }, [pickedYear, fiscalYears]);

  const queryKey = useMemo(() => ['budget-projection', projectId, fiscalYear] as const, [projectId, fiscalYear]);
  const { data, isPending, isError, refetch } = useQuery<BudgetProjectionCellRow[]>({
    queryKey,
    queryFn: () => fetchBudgetProjection(projectId, fiscalYear),
    // Never read the projection off a GUESSED year: until the real years are known (or their read has
    // failed) there is no honest year to ask for.
    enabled: yearsQuery.isSuccess,
  });

  // ⚑ C-3/C-5 — the push status is read at PROJECT grain, independently of the fiscal year and of the
  // grid having rows. It used to ride on `rows[0]`, which made a project-wide money alarm hostage to
  // both: the moment the projection became honestly year-scoped (C-3), "ERPNext is enforcing nothing"
  // would have gone silent for exactly the projects most likely to be in that state.
  const pushKey = useMemo(() => ['budget-push-status', projectId] as const, [projectId]);
  const pushQuery = useQuery<BudgetPushStatusRow>({
    queryKey: pushKey,
    queryFn: () => fetchBudgetPushStatus(projectId),
  });
  const push = pushQuery.data ?? null;

  const etcMutation = useMutation({
    // The fiscal year travels WITH the write: an ETC is only ever authored against a year the client
    // actually declared, never against a placeholder.
    mutationFn: (v: { fiscalYear: string; category: BudgetCategory; pmoEtc: number }) =>
      upsertBudgetProjectionEtc(projectId, v.fiscalYear, v.category, v.pmoEtc),
    onSuccess: () => qc.invalidateQueries({ queryKey }),
  });

  const [editingCategory, setEditingCategory] = useState<BudgetCategory | null>(null);
  const [etcInput, setEtcInput] = useState('');
  const [etcError, setEtcError] = useState<string | null>(null);

  // ⚑ I-3 — focus was dumped to `<body>` on open, cancel AND save, so a keyboard user lost their place
  // in the table entirely. The trigger is the anchor: focus goes into the editor on open and returns to
  // the trigger that opened it on every exit (the shipped unmount-focus-restore lesson).
  const triggerRefs = useRef<Partial<Record<BudgetCategory, HTMLButtonElement | null>>>({});
  const restoreFocusTo = useRef<BudgetCategory | null>(null);
  useEffect(() => {
    if (editingCategory !== null || restoreFocusTo.current === null) return;
    const target = triggerRefs.current[restoreFocusTo.current];
    restoreFocusTo.current = null;
    target?.focus();
  }, [editingCategory]);

  const openEdit = (row: BudgetProjectionCellRow) => {
    setEditingCategory(row.category);
    setEtcInput(String(row.pmoEtc));
    setEtcError(null);
  };
  const closeEdit = useCallback((category: BudgetCategory) => {
    restoreFocusTo.current = category;
    setEditingCategory(null);
    setEtcError(null);
  }, []);

  const saveEdit = async (category: BudgetCategory) => {
    if (fiscalYear === null) return; // unreachable: the edit affordance is not offered without a year
    const parsed = parseMoneyInput(etcInput);
    if (parsed === null || parsed < 0) {
      setEtcError('Enter a valid, non-negative amount');
      return;
    }
    try {
      await etcMutation.mutateAsync({ fiscalYear, category, pmoEtc: parsed });
      toast('Estimate to complete saved', `${category} · ${fiscalYear}`, 'success');
      closeEdit(category);
    } catch (err) {
      const { headline, detail } = classifyMutationError(err);
      toast(headline, detail, 'warning');
    }
  };

  // FR-BUD-123: the push-state banner — project-wide (see the `pushQuery` note above).
  //
  // ⚑ HIGH-C: `'never-pushed'` is in this set. It is what `get_budget_push_status` reports when the
  // project HAS an Active, activated version and the org has handed the budget domain to ERPNext, yet
  // no mirror row exists at all — i.e. the push never reached the edge function (dropped connection,
  // tab closed mid-request, platform 502). Every mirror writer lives inside `adapter-dispatch`, and the
  // sweep backstop's work queue IS that mirror, so nothing re-drives it and nobody is notified. It used
  // to render as a NULL push_state, i.e. a completely clean screen.
  //
  // ⚑ H-3 (audit round 3): `'unstamped-activation'` joins it. That is an Active version carrying no
  // `activated_at` — the population mig 0139 created by adding the column nullable — and it was
  // INVISIBLE, because the alarm above required the stamp. Its consequence is identical (ERPNext
  // enforces nothing) but its remedy is NOT: the push cannot be re-driven at all, since both
  // `budgetPushKey` and the server-side budget gate refuse an unstamped version. That refusal is
  // correct and deliberate — the stamp is the deterministic key's own input, so inventing one would key
  // a money command on a fiction and could mint a SECOND ERP Budget. So it is banner-ed with its own
  // cause and its own real route out (activate a fresh version, which records a true activation act),
  // and NO retry button, rather than a button that can only ever fail.
  const pushState = push?.pushState ?? null;
  const isBlocked = pushState !== null && BLOCKED_STATES.has(pushState);
  const isUnstamped = pushState === 'unstamped-activation';
  const neverArrived = pushState === 'never-pushed' || isUnstamped;
  // ⚑ I-5/I-15 — `push_error` is a MACHINE token and is NEVER rendered. One tested translation for both
  // push surfaces (`pushErrorCopy.ts`), which also decides retryability and transport-vs-rule.
  const errorCopy = describePushError(push?.pushError ?? null);
  // NEW-6: the blocking category names, when the failure is a map gap. The repository already
  // normalizes "none on record" to `null`, so there is exactly one falsy case to test here.
  const unmappedCategories = push?.unmappedCategories ?? null;

  // HIGH-D: the recovery affordance. `held`/`failed`/`never-pushed` are all re-drivable — under the
  // OPERATOR's own JWT, which is the authenticated actor the sweep backstop can never synthesize
  // (FR-BUD-102). Without it, fixing the blocking cause (mapping the missing category) changed nothing:
  // the backstop excludes `held`, and re-activating is refused by the Draft-only guard.
  //
  // ⚑ I-14 — but ONLY where a retry can actually work. `unstamped-activation` already had this
  // contract right; it now extends to every ERP-side cause (`describePushError().retryable`), because a
  // button that can only ever fail is worse than no button: it tells the operator the problem is
  // transient when it is structural.
  const retryMutation = useMutation({
    mutationFn: () => retryActiveBudgetPush(projectId),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey });
      void qc.invalidateQueries({ queryKey: pushKey });
    },
  });
  const offerRetry = isBlocked && !isUnstamped && errorCopy.retryable;

  const retryPush = async () => {
    try {
      const { pushState: next } = await retryMutation.mutateAsync();
      if (next === 'pushed') {
        toast('Budget pushed to ERPNext', 'ERPNext is now enforcing the active budget.', 'success');
      } else {
        // ⚑ I-6 — a transport failure is not a gate rejection. "The reason shown above may need fixing
        // first" was false for a 502/503, where nothing above was fixable and the command never
        // reached ERPNext at all; it sent operators hunting for a cause that was not on the screen.
        toast(
          'The push did not complete',
          errorCopy.transport
            ? 'ERPNext could not be reached. Nothing on this screen needs fixing — try again shortly.'
            : 'The reason shown above may need fixing first.',
          'warning',
        );
      }
    } catch (err) {
      const { headline, detail } = classifyMutationError(err);
      toast(headline, detail, 'warning');
    }
  };

  // ⚑ Error BEFORE loading: the projection query is `enabled` on the fiscal-year read, and a DISABLED
  // react-query stays `pending` forever — so checking loading first would render an eternal skeleton
  // instead of naming a failed year read.
  //
  // A failed fiscal-year read is reported, never worked around: falling back to a guessed year would
  // put a zeroed money screen in front of the user with no sign anything went wrong (H-4).
  if (yearsQuery.isError || isError) {
    return (
      <ListState
        variant="error"
        title="Couldn't load the budget projection"
        sub="The request failed. Check your connection and try again."
        onRetry={() => {
          void (yearsQuery.isError ? yearsQuery.refetch() : refetch());
        }}
      />
    );
  }

  if (yearsQuery.isPending || isPending) {
    return (
      <div className="rounded-lg border border-border bg-card">
        <ListState variant="loading" rows={5} testId="budget-projection-loading" />
      </div>
    );
  }

  const rows = data ?? [];
  const quiet = pushState !== null ? QUIET_STATES[pushState] : undefined;

  return (
    <section aria-label="Budget projection" className="mt-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-[15px] font-semibold tracking-[-0.01em]">Budget projection</h2>
          <p className="mt-1 text-[13px] text-muted-foreground">
            PMO&rsquo;s forward view — actuals from the ERP ledger, your own estimate to complete.
          </p>
        </div>
        {fiscalYears.length > 0 ? (
          <label className="flex items-center gap-1.5 text-[13px] text-muted-foreground">
            Fiscal year
            <select
              aria-label="Fiscal year"
              value={fiscalYear ?? ''}
              onChange={(e) => setPickedYear(e.target.value)}
              className="h-8 rounded-md border border-input bg-background px-2 text-[13px] outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              {fiscalYears.map((y) => (
                <option key={y.fiscalYear} value={y.fiscalYear}>
                  {y.fiscalYear}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <p className="text-[13px] text-muted-foreground">No fiscal year on record</p>
        )}
      </div>

      {/* ⚑ C-5 — `pending`, `pushing` and `pushed` rendered NOTHING, so they were indistinguishable
          from each other AND from "this org has no ERP at all", while `erp_budget_name` (the ERP
          document the push created) was stored and read by nothing. The timesheet `PushStateBadge`
          does exactly the opposite in the same product. A NULL state still renders nothing — that is
          the one case where silence IS the truth (there is nothing to report). */}
      {quiet && (
        <div className="mt-3.5 flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card px-3.5 py-2.5 text-[13px]">
          <StatusPill variant={quiet.variant}>{quiet.label}</StatusPill>
          <span className="text-muted-foreground">{quiet.detail}</span>
          {push?.fiscalYear && <span className="text-muted-foreground">Fiscal year {push.fiscalYear}</span>}
          {push?.erpBudgetName && (
            <span className="font-mono text-[12px] text-muted-foreground">{push.erpBudgetName}</span>
          )}
        </div>
      )}

      {isBlocked && (
        <GateNotice variant="blocked" className="mt-3.5">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              {/* ⚑ I-7 — "still enforcing the PREVIOUS budget" is materially WRONG for a push that
                  never arrived: if this was the first push, ERPNext is enforcing NOTHING, which is a
                  worse situation, not a milder one. The headline now follows the actual state. */}
              <b className="font-semibold">
                {neverArrived
                  ? 'ERPNext is not enforcing any budget for this project.'
                  : 'ERPNext is still enforcing the previous budget for this project.'}
              </b>
              <div className="mt-1">
                {isUnstamped
                  ? 'This budget version has no record of when it was activated, so it cannot be handed to ERPNext. Activate a new version to push the current budget.'
                  : pushState === 'never-pushed'
                    ? 'The activated budget never reached ERPNext — it was not recorded as pushed at all, so no budget of any kind was created there.'
                    : errorCopy.message}
              </div>
              {/* ⚑ I-11 — a withheld Retry needs a real route out, and naming the remedy without naming
                  the CONTROL that performs it is still a dead end. "Clone to revise" is the button on
                  the version above; activating the clone records a TRUE activation act. */}
              {isUnstamped && (
                <div className="mt-1">
                  Use <b>Clone to revise</b> on the active version above, then activate the clone — that records a real
                  activation and can be pushed.
                </div>
              )}
              {!isUnstamped && errorCopy.remedy && <div className="mt-1">{errorCopy.remedy}</div>}
              {/* ⚑ NEW-6 (audit round 4): the actionable half of the failure. The dispatch gate records
                  WHICH categories have no ERP account (FR-BUD-113 collected the names on purpose), but
                  nothing read them back — so this banner could only ever show the bare code
                  `budget-category-unmapped`, telling an Admin that something is broken while withholding
                  the one fact that makes it fixable. These names ARE the to-do list, so they are marked
                  up as one: a real <ul> with an accessible name, not a comma-joined sentence. */}
              {unmappedCategories && (
                <div className="mt-2">
                  <p className="text-[13px] font-medium">Map these categories to an ERP account, then retry:</p>
                  {/* A STABLE accessible name, deliberately not `aria-labelledby` the sentence above:
                      the list's identity should not change every time that copy is reworded. */}
                  <ul aria-label="Categories that need an ERP account" className="mt-1 list-disc pl-5 text-[13px]">
                    {unmappedCategories.map((c) => (
                      <li key={c}>{c}</li>
                    ))}
                  </ul>
                  {/* ⚑ I-8 — naming the to-do is half the job; the banner must reach the place it is
                      done. Without this the operator is told what is wrong and left to find the screen. */}
                  <Link
                    to={ACCOUNT_MAP_HREF}
                    className="mt-1.5 inline-block font-medium underline underline-offset-2 hover:no-underline"
                  >
                    Open the budget account map
                  </Link>
                </div>
              )}
            </div>
            {offerRetry && (
              <Button variant="outline" size="sm" loading={retryMutation.isPending} onClick={() => void retryPush()}>
                Retry the push
              </Button>
            )}
          </div>
        </GateNotice>
      )}

      {rows.length === 0 ? (
        <div className="mt-3.5">
          <ListState
            variant="empty"
            icon="folder"
            title={fiscalYear === null ? 'No fiscal year on record yet' : `No projection data yet for ${fiscalYear}`}
            // ⚑ C-3 — this state is now REACHABLE (the projection is honestly year-scoped), so it has
            // to be a route rather than a shrug: it names the three acts that actually produce a
            // fiscal year, in the order a team performs them.
            sub="Activate a budget version to record one, log an estimate to complete against it, or wait for the ERP ledger to sync its first postings."
          />
        </div>
      ) : (
        <>
          {/* ⚑ C-4 — two columns named "Actual" sat ~100px apart on this tab with nothing saying they
              came from different places or which governed. They are different facts: the version grid
              shows what PMO recorded on each budget line; this shows what the ERP general ledger has
              actually posted. Both column names and this note exist so neither can be read as the
              other. */}
          <p className="mt-3.5 text-[12px] text-muted-foreground">
            &ldquo;Actuals to date&rdquo; below is what the ERP general ledger has posted. It will differ from the
            &ldquo;Actual&rdquo; column on the budget versions above, which is what PMO recorded on each budget line.
          </p>
          {/* ⚑ I-9 — at 390px the last money column was silently clipped mid-figure ($450,00), which
              still LOOKS like a currency figure. The scroller is focusable (a keyboard user can reach
              a scrollable region) and says so. */}
          <div
            role="group"
            aria-label="Budget projection figures, scrollable horizontally"
            tabIndex={0}
            className="mt-2 overflow-x-auto focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            <table className="w-full border-collapse text-[13.5px]">
              <thead>
                <tr>
                  <TH>Category</TH>
                  <TH align="right">Budget (PMO)</TH>
                  <TH align="right">Actuals to date (ERP ledger)</TH>
                  <TH align="right">ETC (PMO)</TH>
                  <TH align="right">Projected final</TH>
                  <TH align="right">Variance</TH>
                  <TH align="right">Utilization</TH>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  // ⚑ C-1/C-2 — a NULL actual means the category has no mapped ERP account, so every
                  // figure downstream of it is unknowable and says the SAME reason. A NULL utilization
                  // with a known actual is a different fact (no budget line to divide by).
                  const unreadable = row.actualsToDate === null;
                  const derivedReason = unreadable ? NO_ERP_ACCOUNT : NO_BUDGET_LINE;
                  return (
                    <tr key={row.category} className="border-b border-border/70 last:border-b-0">
                      <td className="h-[54px] px-3 py-2 font-medium">{labelFor(row.category)}</td>
                      {/* I-1: `tabular-nums` on every comparable figure (DESIGN.md §3, mandatory). */}
                      <td className="h-[54px] px-3 py-2 text-right tabular">
                        {money(row.pmoBudgetAmount, NO_BUDGET_LINE)}
                      </td>
                      <td className="h-[54px] px-3 py-2 text-right tabular">
                        {money(row.actualsToDate, NO_ERP_ACCOUNT)}
                      </td>
                      <td className="h-[54px] px-3 py-2 text-right tabular">
                        {editingCategory === row.category ? (
                          <div className="flex flex-col items-end gap-1">
                            {/* ⚑ I-4 — this was a hand-rolled <input> + <span>, so the validation
                                message was not wired to the field at all (no aria-invalid, no
                                aria-describedby): a screen-reader user was told nothing was wrong.
                                `NumberField` is the mandated primitive and owns that wiring, plus
                                tabular right-aligned figures and inputMode=decimal. */}
                            <NumberField
                              id={`etc-${row.category}`}
                              label="Estimate to complete"
                              hideLabel
                              autoFocus
                              value={etcInput}
                              onChange={setEtcInput}
                              error={etcError}
                              className="w-[110px]"
                            />
                            <div className="flex gap-1.5">
                              <Button
                                variant="primary"
                                size="sm"
                                loading={etcMutation.isPending}
                                onClick={() => void saveEdit(row.category)}
                              >
                                Save
                              </Button>
                              <Button variant="ghost" size="sm" onClick={() => closeEdit(row.category)}>
                                Cancel
                              </Button>
                            </div>
                          </div>
                        ) : (
                          <div className="flex items-center justify-end gap-2">
                            {formatCurrency(row.pmoEtc)}
                            {canEditEtc && fiscalYear !== null && (
                              // ⚑ I-2 — the trigger used to PRINT the category, so the column's width
                              // changed per row and the money in it stopped lining up. The category
                              // belongs in the accessible name, not on screen.
                              <Button
                                ref={(el) => {
                                  triggerRefs.current[row.category] = el;
                                }}
                                variant="ghost"
                                size="sm"
                                aria-label={`Edit ${row.category} ETC`}
                                onClick={() => openEdit(row)}
                              >
                                Edit
                              </Button>
                            )}
                          </div>
                        )}
                      </td>
                      <td className="h-[54px] px-3 py-2 text-right tabular">
                        {money(row.projectedFinalCost, derivedReason)}
                      </td>
                      <td className="h-[54px] px-3 py-2 text-right tabular">
                        {money(row.projectedVariance, derivedReason)}
                      </td>
                      <td className="h-[54px] px-3 py-2 text-right tabular">
                        {row.projectedUtilization === null ? (
                          <Unavailable reason={derivedReason} />
                        ) : (
                          pct(row.projectedUtilization * 100)
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
};

const TH: React.FC<{ children: React.ReactNode; align?: 'right' }> = ({ children, align }) => (
  <th
    className={`h-[38px] border-b border-border bg-card px-3 text-[11.5px] font-semibold uppercase tracking-[0.03em] text-muted-foreground ${
      align === 'right' ? 'text-right' : 'text-left'
    }`}
  >
    {children}
  </th>
);

export default BudgetProjection;
