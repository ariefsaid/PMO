import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ListState, GateNotice, Button, StatusPill, NumberField, useToast } from '@/src/components/ui';
import { summarizeProjection } from '@/src/lib/budget/budgetProjection';
import { usePermission } from '@/src/auth/usePermission';
import { useOrgCurrency } from '@/src/hooks/useOrgCurrency';
import { budgetCategoryLabel } from '@/src/lib/i18n/budgetCategoryLabel';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import { describePushError } from '@/src/lib/adapterSeam/pushErrorCopy';
import {
  formatCurrency,
  formatInstantDate,
  formatMoneyInputValue,
  parseMoneyInputAtScale,
  pct,
} from '@/src/lib/format';
import {
  fetchBudgetProjection,
  fetchBudgetPushStatus,
  fetchActiveBudgetCategoryPhasing,
  listBudgetFiscalYears,
  upsertBudgetProjectionEtc,
  retryActiveBudgetPush,
  releaseActiveBudgetPushHold,
  type ActiveBudgetCategoryPhasing,
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

/**
 * Where an Admin fixes the category↔ERP-account map. AC-ADMIA-003: the canonical Accounting route is
 * now `/administration/accounting#budget-account-map` — the shell treats `/administration#budget-account-map`
 * as a compatibility alias that redirects (preserving the fragment), so the banner targets the canonical URL
 * directly rather than taking a redundant history-hop through the alias.
 */
const ACCOUNT_MAP_HREF = '/administration/accounting#budget-account-map';

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
/**
 * ⚑ NEW-4 — the THIRD scope of the money-honesty class. C-1 asked "is there an account to look at?";
 * it never asked "has anyone LOOKED?". A project whose ERP ledger has never been synced for this year
 * rendered a confident `$0` actual, a full-budget variance and 0% utilization under a green "Enforced
 * by ERPNext" pill. It is a DIFFERENT absence from an unmapped category and has a different remedy, so
 * it says so rather than borrowing the map's explanation.
 */
const NO_LEDGER_READING =
  'Not available: the ERP ledger has not been read for this project and fiscal year, so its spend is not known here.';
/**
 * ⚑ HIGH-1 — the FOURTH. `budget_versions` carries no fiscal year of its own, so the only record of
 * which year a budget was filed under is the year it was pushed for. On any other year PMO has no
 * budget to compare against — and printing the CURRENT budget there produced a wrong-year Budget,
 * Variance and Utilization beside a correct actual.
 */
const NO_BUDGET_FOR_YEAR =
  'Not available: the active budget version is not on record as covering this fiscal year, so there is no budget here to compare against.';
/**
 * ⚑ THE DIRECTOR'S RULING (spec §6.2) — the FIFTH absence, and the one that is not an absence at all.
 *
 * The RPC fails closed (NULL budget, NULL variance, NULL utilization) for a category whose lines are
 * all phased to a DIFFERENT fiscal year — correctly, because reporting `-EAC` there would call an
 * ordinary timing difference (spend landing in FY1 against work budgeted in FY2) an unbudgeted
 * overspend, a false alarm on real money. But that fact is FULLY KNOWN, and rendering a knowable fact
 * as "unavailable" is its own dishonesty. So this year says what IS true, and names the year to look at.
 */
const budgetedInOtherYears = (years: readonly string[]): string =>
  `Not budgeted in this fiscal year: this category is budgeted in ${years.join(' and ')}. Spend posted here is a timing difference, not an overspend — switch the fiscal year above to compare it against its own budget.`;
/**
 * ⚑ FR-BFY-053/057 — the OTHER job `attribution_known = false` does, and it IS an absence. The lines
 * are un-phased, a push once resolved a single fiscal year for them, and the project's dates have since
 * moved off the span that push recorded — so PMO can no longer say which year they belong to and
 * refuses to guess (ADR-0048). The remedy is a PMO act, and it is named.
 */
const BUDGET_ATTRIBUTION_STALE =
  "Not available: this budget's fiscal-year attribution is stale — the project's dates changed after it was pushed, so PMO can no longer say which year these un-phased lines belong to. Phase these lines to their fiscal years to restore the figure.";
/**
 * ⚑ BLOCK 2 (FU-2 round 2) — the SIXTH, reachable since F-D became a conjunction (0153 §3a). This
 * category HAS lines here, some of them attributed to this year, but at least one cannot be placed in
 * any year at all — so its TOTAL is unknown and the RPC withholds the amount rather than stating the
 * attributed part as if it were the whole budget. It is neither "budgeted elsewhere" (nothing names
 * another year) nor "stale" (there may never have been a successful push to drift), and it is emphatically
 * not "no line for this category" — which is what the reader used to be told about a $150,000 budget.
 */
const BUDGET_ATTRIBUTION_PARTIAL =
  'Not available: some of this category’s budget lines are not phased to a fiscal year and PMO cannot place them in this one, so the category’s total for this year cannot be stated. Phase these lines to their fiscal years to restore the figure.';

const money = (v: number | null, reason: string, currency: string): React.ReactNode =>
  v === null ? <Unavailable reason={reason} /> : formatCurrency(v, currency);

// ── C-5: every push state gets its own statement. A state that renders nothing is a defect, not a
// default — silence is indistinguishable from absence (DESIGN.md §Data & States).
const QUIET_PUSH_STATES = new Set(['pending', 'pushing', 'pushed']);

const BLOCKED_STATES = new Set(['failed', 'held', 'never-pushed', 'unstamped-activation']);

const BudgetProjection: React.FC<BudgetProjectionProps> = ({ projectId }) => {
  const { t } = useTranslation();
  const translatedCategory = (category: string) => budgetCategoryLabel(labelFor(category), t);
  const may = usePermission();
  const canEditEtc = may('edit', 'budgetLine');
  const { toast } = useToast();
  const qc = useQueryClient();
  // ⛔ The RPC (fetchBudgetProjection) has no currency column — these figures are the org-wide
  // forward view, so they take the org's operating currency, not a per-row record currency.
  const orgCurrency = useOrgCurrency();

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
  //
  // ⚑ AC-BFY-026 / FR-BFY-056 (review finding 6) — it is an ARRAY: ONE ROW PER EXPECTED FISCAL YEAR.
  // A push now fans out to one ERP `Budget` per phased year, so a partial outcome (FY2026 enforcing,
  // FY2027 failed) is an ordinary state. Reading a single row hid the failed year behind the pushed
  // one — the RPC orders by `pushed_at`, and only the pushed row has one — and the operator was told
  // "Enforced by ERPNext" about a project ERPNext was half-enforcing.
  const pushKey = useMemo(() => ['budget-push-status', projectId] as const, [projectId]);
  const pushQuery = useQuery<BudgetPushStatusRow[]>({
    queryKey: pushKey,
    queryFn: () => fetchBudgetPushStatus(projectId),
  });
  const pushRows = useMemo(() => pushQuery.data ?? [], [pushQuery.data]);

  // ⚑ THE DIRECTOR'S RULING (spec §6.2): which fiscal year is each category ACTUALLY budgeted in? PMO's
  // own phased line items answer it, and without that answer this screen cannot tell "budgeted in
  // FY2027" (a known fact) from "we cannot attribute this" (a real unknown) — they arrive identically,
  // as a NULL budget.
  const categoryPhasingQuery = useQuery<ActiveBudgetCategoryPhasing>({
    queryKey: ['budget-category-phasing', projectId],
    queryFn: () => fetchActiveBudgetCategoryPhasing(projectId),
  });
  const categoryPhasing = categoryPhasingQuery.data;
  const categoryYears = categoryPhasing?.years ?? {};

  const etcMutation = useMutation({
    // The fiscal year travels WITH the write: an ETC is only ever authored against a year the client
    // actually declared, never against a placeholder.
    mutationFn: (v: { fiscalYear: string; category: BudgetCategory; pmoEtc: number }) =>
      upsertBudgetProjectionEtc(projectId, v.fiscalYear, v.category, v.pmoEtc),
    onSuccess: () => qc.invalidateQueries({ queryKey }),
  });

  // UX-039: ONE editor for every category's cost to finish. The drafts live here; nothing is written
  // until Save, and Save writes only the rows that changed, through the same per-category upsert.
  const [editing, setEditing] = useState(false);
  const [etcInputs, setEtcInputs] = useState<Record<string, string>>({});
  const [etcErrors, setEtcErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  // ⚑ I-3 — focus goes into the editor on open and returns to the trigger on every exit.
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const restoreFocus = useRef(false);
  useEffect(() => {
    if (editing || !restoreFocus.current) return;
    restoreFocus.current = false;
    triggerRef.current?.focus();
  }, [editing]);

  const openEdit = (rows: BudgetProjectionCellRow[]) => {
    setEtcInputs(Object.fromEntries(rows.map((r) => [r.category, formatMoneyInputValue(r.pmoEtc)])));
    setEtcErrors({});
    setEditing(true);
  };
  const closeEdit = useCallback(() => {
    restoreFocus.current = true;
    setEditing(false);
    setEtcErrors({});
  }, []);

  const saveAll = async (rows: BudgetProjectionCellRow[]) => {
    if (fiscalYear === null) return; // unreachable: the edit affordance is not offered without a year
    // Validate EVERY row first — a bad row blocks the whole save, so nothing half-applies by design.
    const errors: Record<string, string> = {};
    const changes: { category: BudgetCategory; pmoEtc: number }[] = [];
    for (const row of rows) {
      const parsed = parseMoneyInputAtScale(etcInputs[row.category] ?? '', 2);
      if (parsed === null || parsed < 0) {
        errors[row.category] = t('financeCopy.budgetEtcAmountInvalid', 'Enter a valid, non-negative amount with no more than 2 decimal places');
      } else if (parsed !== row.pmoEtc) {
        changes.push({ category: row.category, pmoEtc: parsed });
      }
    }
    setEtcErrors(errors);
    if (Object.keys(errors).length > 0) return;
    if (changes.length === 0) {
      closeEdit();
      return;
    }
    // Writes are per-category (the existing contract), so a failure part-way leaves earlier rows saved.
    // Say exactly which — never pretend all rows saved — and keep the failed rows open for another try.
    setSaving(true);
    const saved: BudgetCategory[] = [];
    const failed: { category: BudgetCategory; detail: string }[] = [];
    for (const change of changes) {
      try {
        await etcMutation.mutateAsync({ fiscalYear, ...change });
        saved.push(change.category);
      } catch (err) {
        failed.push({ category: change.category, detail: classifyMutationError(err).headline });
      }
    }
    setSaving(false);
    const names = (cs: readonly string[]) => cs.map(translatedCategory).join(', ');
    if (failed.length === 0) {
      toast(t('uxs04.costToFinishSaved', 'Cost to finish saved'), `${names(saved)} · ${fiscalYear}`, 'success');
      closeEdit();
      return;
    }
    setEtcErrors(Object.fromEntries(failed.map((f) => [f.category, t('uxs04.rowNotSaved', 'Not saved. Try again.')])));
    toast(
      t('uxs04.someNotSaved', 'Some changes were not saved'),
      saved.length > 0
        ? t('uxs04.savedAndNotSaved', 'Saved: {{saved}}. Not saved: {{failed}}. {{reason}}', { saved: names(saved), failed: names(failed.map((f) => f.category)), reason: failed[0].detail })
        : t('uxs04.noneSaved', 'Nothing was saved: {{failed}}. {{reason}}', { failed: names(failed.map((f) => f.category)), reason: failed[0].detail }),
      'warning',
    );
  };

  // FR-BUD-123: the push-state banner — now ONE PER EXPECTED FISCAL YEAR (AC-BFY-026).
  //
  // ⚑ HIGH-C: `'never-pushed'` is in BLOCKED_STATES. It is what `get_budget_push_status` reports when
  // the project HAS an Active, activated version and the org has handed the budget domain to ERPNext,
  // yet no mirror row exists for a year it EXPECTS — i.e. the push never reached the edge function
  // (dropped connection, tab closed mid-request, platform 502), or died before that year's turn in the
  // fan-out. Every mirror writer lives inside `adapter-dispatch`, and the sweep backstop's work queue IS
  // that mirror, so nothing re-drives it and nobody is notified. It used to render as a NULL push_state,
  // i.e. a completely clean screen.
  //
  // ⚑ H-3 (audit round 3): `'unstamped-activation'` joins it. That is an Active version carrying no
  // `activated_at` — the population mig 0139 created by adding the column nullable. Its consequence is
  // identical (ERPNext enforces nothing) but its remedy is NOT: the push cannot be re-driven at all,
  // since both the client pre-check and the server-side budget gate refuse an unstamped version. That
  // refusal is correct and deliberate — the stamp is the deterministic key's own input, so inventing one
  // would key a money command on a fiction and could mint a SECOND ERP Budget. So it is banner-ed with
  // its own cause and its own real route out (activate a fresh version, which records a true activation
  // act), and NO retry button, rather than a button that can only ever fail.
  const blockedRows = pushRows.filter((r) => r.pushState !== null && BLOCKED_STATES.has(r.pushState));
  const quietRows = pushRows.filter((r) => r.pushState !== null && QUIET_PUSH_STATES.has(r.pushState));

  // HIGH-D: the recovery affordance, PER YEAR. `held`/`failed`/`never-pushed` are all re-drivable —
  // under the OPERATOR's own JWT, which is the authenticated actor the sweep backstop can never
  // synthesize (FR-BUD-102). Without it, fixing the blocking cause (mapping the missing category)
  // changed nothing: the backstop excludes `held`, and re-activating is refused by the Draft-only guard.
  //
  // ⚑ AC-BFY-026: the fiscal year is the mutation's VARIABLE, not a closed-over page-level value, so
  // the button on FY2027's banner re-drives FY2027 — a project-level action beside a partially-failed
  // fan-out could only ever act on the wrong year.
  const retryMutation = useMutation({
    mutationFn: (fiscalYearToRetry: string | null) => retryActiveBudgetPush(projectId, fiscalYearToRetry),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey });
      void qc.invalidateQueries({ queryKey: pushKey });
    },
  });

  /**
   * ⚑ MED-2 (audit round 6) — the release. `release_outbox_hold` (mig 0137 §4) shipped correct and
   * UNCALLED, so the wedge its own header states in the present tense stayed literally true: a `held`
   * row sits inside `external_command_outbox_one_inflight_per_record`, every later key for the same
   * record 409s forever, and the product offered no way out at all. Admin-only here because the RPC is
   * Admin-only there — `can()` is UX and must never promise more than RLS/the RPC allows (ADR-0016).
   * It asserts "the condition that caused the hold is resolved", never "the command succeeded": the
   * row goes back to `failed`, and the ordinary bounded recovery re-runs every gate.
   */
  const canReleaseHold = may('manage', 'pushHold');
  const releaseMutation = useMutation({
    mutationFn: (fiscalYearToRelease: string | null) => releaseActiveBudgetPushHold(projectId, fiscalYearToRelease),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: pushKey });
    },
  });

  const releaseHold = async (row: BudgetPushStatusRow) => {
    try {
      await releaseMutation.mutateAsync(row.fiscalYear);
      toast(
        t('financeCopy.budgetPushHoldReleased', 'Hold released'),
        t('financeCopy.budgetPushHoldReleasedDetail', 'The push is queued again — ERPNext is contacted on the next recovery pass, and every check runs afresh.'),
        'success',
      );
    } catch (err) {
      const { headline, detail } = classifyMutationError(err);
      toast(headline, detail, 'warning');
    }
  };

  const retryPush = async (row: BudgetPushStatusRow) => {
    const copy = describePushError(row.pushError);
    try {
      const { pushState: next } = await retryMutation.mutateAsync(row.fiscalYear);
      if (next === 'pushed') {
        toast(
          t('financeCopy.budgetPushedToERP', 'Budget pushed to ERPNext'),
          row.fiscalYear
            ? t('financeCopy.erpEnforcingBudgetYear', 'ERPNext is now enforcing the active budget for {{year}}.', { year: row.fiscalYear })
            : t('financeCopy.erpEnforcingBudget', 'ERPNext is now enforcing the active budget.'),
          'success',
        );
      } else if (next === 'nothing-to-push') {
        // ⚑ FU-2 round 2 — the active version has NO line items, so the retry attempted no year: no ERP
        // Budget was created and no mirror row written. Reporting "ERPNext is now enforcing the active
        // budget" here claimed a push that did not happen, directly contradicting the `never-pushed`
        // banner beside it. Neither is it a failure — nothing was attempted, so there is nothing to fix.
        toast(
          t('financeCopy.noBudgetLinesToPushTitle', 'There was nothing to push'),
          t('financeCopy.noBudgetLinesToPushDetail', 'The active budget version has no budget lines, so no ERPNext Budget was created. Add lines and activate a new version.'),
          'warning',
        );
      } else {
        // ⚑ I-6 — a transport failure is not a gate rejection. "The reason shown above may need fixing
        // first" was false for a 502/503, where nothing above was fixable and the command never
        // reached ERPNext at all; it sent operators hunting for a cause that was not on the screen.
        toast(
          t('financeCopy.budgetPushIncomplete', 'The push did not complete'),
          copy.transport
            ? t('financeCopy.erpUnavailableRetryShortly', 'ERPNext could not be reached. Nothing on this screen needs fixing — try again shortly.')
            : t('financeCopy.budgetPushReasonNeedsFixing', 'The reason shown above may need fixing first.'),
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
        title={t('financeCopy.budgetProjectionLoadFailed', "Couldn't load the budget projection")}
        sub={t('financeCopy.theRequestFailedCheckYourConnectionAndTryAgain', "The request failed. Check your connection and try again.")}
        onRetry={() => {
          void (yearsQuery.isError ? yearsQuery.refetch() : refetch());
        }}
      />
    );
  }

  // ⚑ FINDING 3 (FU-2 round 4) — THE PHASING READ IS IN THE GATE, because every reason string on this
  // grid is a claim and the phasing fact is one of its inputs. Outside the gate there was a real render
  // window in which the grid painted without it, and an all-phased-elsewhere category was told "some of
  // this category's budget lines are not phased to a fiscal year" — false of it — before flipping to
  // "budgeted in 2027". A failed phasing read is deliberately NOT gated on: it is not pending, so the
  // ladder's fail-OPEN path takes over (say the weaker true thing), rather than wedging the whole money
  // grid behind an explanatory read.
  if (yearsQuery.isPending || isPending || categoryPhasingQuery.isPending) {
    return (
      <div className="rounded-lg border border-border bg-card">
        <ListState variant="loading" rows={5} testId="budget-projection-loading" />
      </div>
    );
  }

  const rows = data ?? [];

  // ⚑ HIGH-1 — is the PMO budget knowable for the year on screen? `isActivePush` is the SAME predicate
  // the RPC scopes `pmo_budget_amount` by ("the Active version is on record as covering this year"), so
  // the two can never disagree about a null. The selector deliberately still OFFERS such a year — real
  // ERP spend posted there is worth looking at — which is exactly why the surface must be able to SAY
  // why the budget half is blank instead of leaving a bare dash.
  const budgetYearOnRecord = fiscalYears.some((y) => y.fiscalYear === fiscalYear && y.isActivePush);
  // ⚑ FR-BFY-053/057 — is THIS year's un-phased attribution stale? The status RPC computes it (0153
  // §3c) precisely so the screen can say WHY the budget column went blank instead of leaving a dash.
  const staleForSelectedYear = pushRows.some((r) => r.fiscalYear === fiscalYear && r.staleAttribution);

  /**
   * ⚑ SHOULD-FIX 1 (FU-2 round 3) — IS THIS CATEGORY FULLY PLACED SOMEWHERE? Only then may the screen
   * say "budgeted in FY2027, so spend here is not an overspend". A category with a line phased to no
   * year at all has an unknown TOTAL, so no year can be exonerated on its behalf.
   *
   * Fails OPEN, deliberately and in the same direction as the seam: until the phasing read has answered
   * (or if it answers in an older shape without `unphased`), PMO does not KNOW every line is placed, so
   * it must not make the claim.
   */
  const fullyPlacedElsewhere = (category: BudgetCategory): boolean =>
    categoryPhasing?.unphased !== undefined && categoryPhasing.unphased[category] !== true;

  /**
   * ⚑ WHICH ABSENCE IS THIS? (the Director's ruling, spec §6.2.) Five different NULL budgets reach
   * this screen and they have five different remedies — and one of them is not a remedy at all, because
   * nothing is wrong. In order of specificity:
   *   1. the category IS budgeted, in ANOTHER fiscal year, AND EVERY ONE OF ITS LINES IS PLACED → say
   *      so, and name the year. A knowable fact rendered as "unavailable" is its own dishonesty.
   *      ⚑ SHOULD-FIX 1: the second half of that condition is load-bearing. `attribution_known = false`
   *      collapses THREE states, and (nothing here, and something un-placeable) — phased elsewhere WITH
   *      an un-phased sibling — had no branch: this one won on "elsewhere" alone and told the reader
   *      that spend on a category holding $50,000 PMO can place in NO year was "a timing difference,
   *      not an overspend". PMO does not hold that claim; it falls through to 3, which does.
   *   2. the attribution is STALE (un-phased lines, project dates moved off the pushed span) → say that,
   *      and name the fix ("phase these lines"). ⚑ SHOULD-FIX 1: `staleForSelectedYear` is a PROJECT-year
   *      flag answering a PER-category question, so it may only explain a category this year actually
   *      SUPPRESSED. Tested first, it explained a category with no lines at all — whose `-EAC` is a
   *      correct, deliberately loud unbudgeted-spend alarm — as "phase these lines" that do not exist.
   *   3. ⚑ BLOCK 2: the category is PARTLY attributable here — it has lines, some of them in this year,
   *      but at least one that PMO cannot place at all, so its total is withheld → say that, and name
   *      the same fix. Without this branch it fell through to 5 and told the reader a category holding
   *      $150,000 had "no line".
   *   4. the Active version is not on record as covering this year at all → the shipped HIGH-1 sentence.
   *   5. it simply has no line for this category → the shipped C-1 sentence.
   */
  const budgetReasonFor = (row: BudgetProjectionCellRow): string => {
    const elsewhere = (categoryYears[row.category] ?? []).filter((y) => y !== fiscalYear);
    if (elsewhere.length > 0 && fullyPlacedElsewhere(row.category)) return budgetedInOtherYears(elsewhere);
    // `=== false` (never `!`): the seam maps an older RPC shape to `true`, and an undefined here
    // must not invent a suppression either — the fail-OPEN direction, as at the seam.
    if (row.attributionKnown === false && staleForSelectedYear) return BUDGET_ATTRIBUTION_STALE;
    if (row.attributionKnown === false) return BUDGET_ATTRIBUTION_PARTIAL;
    return budgetYearOnRecord ? NO_BUDGET_LINE : NO_BUDGET_FOR_YEAR;
  };
  /**
   * UX-036 — the VISIBLE, concise half of the same ladder: said once under the category, so a dash is
   * never the only thing on screen (the long sentence stays on the cell for hover/AT). Same branches as
   * `budgetReasonFor`; this one only chooses a shorter sentence, it decides nothing new.
   */
  const shortBudgetReasonFor = (row: BudgetProjectionCellRow): string => {
    const elsewhere = (categoryYears[row.category] ?? []).filter((y) => y !== fiscalYear);
    if (elsewhere.length > 0 && fullyPlacedElsewhere(row.category)) return t('uxs04.reasonBudgetedElsewhere', 'Budgeted in {{years}}', { years: elsewhere.join(' and ') });
    if (row.attributionKnown === false) return t('uxs04.reasonBudgetYearUnclear', 'Budget year unclear: phase its budget lines');
    return budgetYearOnRecord ? t('uxs04.reasonNoBudgetLine', 'No budget line') : t('uxs04.reasonNoBudgetThisYear', 'No budget on record for this year');
  };
  /** Why a category's figures are missing, as ONE visible line (or null when nothing is missing). */
  const visibleReasonFor = (row: BudgetProjectionCellRow): string | null => {
    if (row.actualsToDate === null) {
      return row.actualsAsOf === null
        ? t('uxs04.reasonSpendingNotRead', 'Spending not read yet')
        : t('uxs04.reasonSpendingUnmapped', 'Spending unavailable: no ledger account mapped');
    }
    if (row.pmoBudgetAmount === null) return shortBudgetReasonFor(row);
    return null;
  };
  /** A null budget is a KNOWN zero only when the Active version simply has no line for the category. */
  const budgetKnownAbsent = (row: BudgetProjectionCellRow): boolean =>
    row.pmoBudgetAmount === null && budgetReasonFor(row) === NO_BUDGET_LINE;
  const summary = summarizeProjection(
    rows.map((r) => ({
      category: r.category,
      pmoBudgetAmount: r.pmoBudgetAmount,
      budgetKnownAbsent: budgetKnownAbsent(r),
      actualsToDate: r.actualsToDate,
      pmoEtc: r.pmoEtc,
    })),
  );
  // ⚑ NEW-4 — the provenance of the actuals column. Project-year-wide (one snapshot per refresh), so
  // any row carries it. `null` = no reading on record, and nothing is dated.
  const actualsAsOf = rows.find((r) => r.actualsAsOf !== null)?.actualsAsOf ?? null;

  const missingNames = (cs: readonly string[]) => cs.map(translatedCategory).join(', ');
  const overrun = summary.remaining !== null && summary.remaining < 0;
  // SUB-D: what is missing is said ONCE under the strip; each unknown figure is just a dash.
  const incompleteNotes = [
    summary.unknownRecorded.length ? t('uxs04.incompleteRecorded', 'Not complete: spending unavailable for {{categories}}', { categories: missingNames(summary.unknownRecorded) }) : null,
    summary.unknownBudget.length ? t('uxs04.incompleteBudget', 'Not complete: budget unknown for {{categories}}', { categories: missingNames(summary.unknownBudget) }) : null,
  ].filter((note): note is string => note !== null);

  return (
    <section aria-label={t('uxs04.forecast', 'Forecast')}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-[15px] font-semibold tracking-[-0.01em]">{t('uxs04.forecast', 'Forecast')}</h2>
        <div className="flex flex-wrap items-center gap-3">
          {fiscalYears.length > 0 ? (
            <label className="flex items-center gap-1.5 text-[13px] text-muted-foreground">
              {t('financeCopy.fiscalYear', "Fiscal year")}<select
                aria-label={t('financeCopy.fiscalYear', "Fiscal year")}
                value={fiscalYear ?? ''}
                disabled={editing || saving}
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
            <p className="text-[13px] text-muted-foreground">{t('financeCopy.noFiscalYearOnRecord', "No fiscal year on record")}</p>
          )}
          {/* UX-039: ONE entry to edit every category's cost to finish, one Save. */}
          {rows.length > 0 && canEditEtc && fiscalYear !== null && !editing && (
            <Button ref={triggerRef} variant="outline" size="sm" onClick={() => openEdit(rows)}>
              {t('uxs04.editCostToFinish', 'Edit cost to finish')}
            </Button>
          )}
          {editing && (
            <div className="flex gap-1.5">
              <Button variant="primary" size="sm" loading={saving} onClick={() => void saveAll(rows)}>
                {t('financeCopy.save', "Save")}</Button>
              <Button variant="ghost" size="sm" disabled={saving} onClick={closeEdit}>
                {t('financeCopy.cancel', "Cancel")}</Button>
            </div>
          )}
        </div>
      </div>

      {/* ⚑ AC-BFY-026: one banner PER BLOCKED YEAR. A single banner over a fan-out could name only one
          year, so the other year's missing overspend control was invisible — and its Retry/Release
          acted on "the project", i.e. on whichever year the RPC happened to return first. Blocked
          states are alarms, so they stay in view; the healthy states live in the details below. */}
      {blockedRows.map((row) => (
        <BlockedPushStatus
          key={`blocked-${row.fiscalYear ?? 'no-year'}`}
          row={row}
          canReleaseHold={canReleaseHold}
          releasePending={releaseMutation.isPending && releaseMutation.variables === row.fiscalYear}
          retryPending={retryMutation.isPending && retryMutation.variables === row.fiscalYear}
          onRelease={() => void releaseHold(row)}
          onRetry={() => void retryPush(row)}
        />
      ))}

      {rows.length === 0 ? (
        <div className="mt-3.5">
          <ListState
            variant="empty"
            icon="folder"
            title={fiscalYear === null ? 'No fiscal year on record yet' : `No projection data yet for ${fiscalYear}`}
            // ⚑ C-3 / MED-3 — a route, naming only acts the product can perform.
            sub={t('financeCopy.activateABudgetVersionAndPushItToTheERPToRecordOneOrWaitForTheERPLedgerToSyncItsFirstPostingsForThisProject', "Activate a budget version and push it to the ERP to record one, or wait for the ERP ledger to sync its first postings for this project.")}
          />
        </div>
      ) : (
        <>
          {/* UX-035/036: the answer first. Five figures, each from the SAME rows as the grid below; a
              figure whose inputs are unknown is a dash AND says which categories are missing. */}
          <dl
            data-testid="forecast-summary"
            className="mt-3.5 grid grid-cols-2 gap-x-4 gap-y-3 rounded-lg border border-border bg-card px-4 py-3 sm:grid-cols-5"
          >
            <SummaryFigure
              label={t('uxs04.budget', 'Budget')}
              value={summary.budget}
              currency={orgCurrency}
            />
            <SummaryFigure
              label={t('uxs04.recordedSpending', 'Recorded spending')}
              value={summary.recorded}
              currency={orgCurrency}
            />
            <SummaryFigure label={t('uxs04.costToFinish', 'Cost to finish')} value={summary.costToFinish} currency={orgCurrency} />
            <SummaryFigure
              label={t('uxs04.forecastFinalCost', 'Forecast final cost')}
              value={summary.finalCost}
              currency={orgCurrency}
              strong
            />
            <SummaryFigure
              label={overrun ? t('uxs04.forecastOverrun', 'Forecast overrun') : t('uxs04.forecastRemaining', 'Forecast remaining')}
              value={summary.remaining === null ? null : Math.abs(summary.remaining)}
              currency={orgCurrency}
              strong
              alert={overrun}
            />
          </dl>
          {incompleteNotes.length > 0 && (
            <p id="forecast-incomplete" data-testid="forecast-incomplete" className="mt-2 text-[12px] text-muted-foreground">
              {incompleteNotes.join(' ')}
            </p>
          )}

          {actualsAsOf && (
            <p className="mt-2 text-[12px] text-muted-foreground">{t('uxs04.recordedAsOf', 'Recorded spending as of')}{' '}{formatInstantDate(actualsAsOf)}</p>
          )}
          {/* ⚑ NEW-1 — below `sm` each row becomes a stacked label/value card (nothing to pan); from `sm`
              up it is the table. One markup tree, one render. */}
          <div
            role="group"
            aria-label={t('financeCopy.budgetProjectionFiguresScrollableHorizontally', "Budget projection figures, scrollable horizontally")}
            tabIndex={0}
            className="mt-2 sm:overflow-x-auto focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            <table className="w-full border-collapse text-[13.5px]">
              <thead className="hidden sm:table-header-group">
                <tr>
                  <TH>{t('financeCopy.category', "Category")}</TH>
                  <TH align="right">{t('uxs04.budget', 'Budget')}</TH>
                  <TH align="right">{t('uxs04.forecastFinalCost', 'Forecast final cost')}</TH>
                  <TH align="right">{t('uxs04.forecastRemainingOver', 'Forecast remaining / (overrun)')}</TH>
                  <TH align="right">{t('uxs04.recordedSpending', 'Recorded spending')}</TH>
                  <TH align="right">{t('uxs04.costToFinish', 'Cost to finish')}</TH>
                  <TH align="right">{t('uxs04.forecastBudgetUsed', 'Forecast budget used')}</TH>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  // ⚑ THE MONEY-HONESTY INVARIANT: a figure whose INPUTS are unknown is never rendered as
                  // a number, and the cell names WHICH input is missing (three different remedies).
                  const actualsReason = row.actualsAsOf === null ? NO_LEDGER_READING : NO_ERP_ACCOUNT;
                  const budgetReason = budgetReasonFor(row);
                  const derivedReason = row.actualsToDate === null ? actualsReason : budgetReason;
                  const visibleReason = visibleReasonFor(row);
                  return (
                    <tr
                      key={row.category}
                      className="block border-b border-border/70 py-2 last:border-b-0 sm:table-row sm:py-0"
                    >
                      <td className="block px-3 pb-1 pt-1 font-medium sm:table-cell sm:py-2">
                        {translatedCategory(row.category)}
                        {visibleReason && (
                          <span data-testid={`reason-${row.category}`} className="block text-[12px] font-normal text-muted-foreground">
                            {visibleReason}
                          </span>
                        )}
                      </td>
                      {/* I-1: `tabular-nums` on every comparable figure (DESIGN.md §3, mandatory). */}
                      <Cell label={t('uxs04.budget', 'Budget')}>{money(row.pmoBudgetAmount, budgetReason, orgCurrency)}</Cell>
                      <Cell label={t('uxs04.forecastFinalCost', 'Forecast final cost')}>{money(row.projectedFinalCost, derivedReason, orgCurrency)}</Cell>
                      <Cell label={t('uxs04.forecastRemainingOver', 'Forecast remaining / (overrun)')}>
                        {row.projectedVariance !== null && row.projectedVariance < 0 ? (
                          <span className="text-destructive-text">{formatCurrency(row.projectedVariance, orgCurrency)}</span>
                        ) : (
                          money(row.projectedVariance, derivedReason, orgCurrency)
                        )}
                      </Cell>
                      <Cell label={t('uxs04.recordedSpending', 'Recorded spending')}>{money(row.actualsToDate, actualsReason, orgCurrency)}</Cell>
                      <Cell label={t('uxs04.costToFinish', 'Cost to finish')}>
                        {editing ? (
                          <div className="flex flex-col items-end gap-1">
                            {/* ⚑ I-4 — `NumberField` owns the aria-invalid / describedby wiring, tabular
                                right-aligned figures and inputMode=decimal. */}
                            <NumberField
                              id={`etc-${row.category}`}
                              label={t('uxs04.costToFinishFor', 'Cost to finish: {{category}}', { category: translatedCategory(row.category) })}
                              hideLabel
                              autoFocus={row === rows[0]}
                              value={etcInputs[row.category] ?? ''}
                              onChange={(v) => {
                                setEtcInputs((cur) => ({ ...cur, [row.category]: v }));
                                setEtcErrors((cur) => {
                                  const { [row.category]: _drop, ...rest } = cur;
                                  return rest;
                                });
                              }}
                              error={etcErrors[row.category] ?? null}
                              localeAware
                              className="w-[110px]"
                            />
                          </div>
                        ) : (
                          formatCurrency(row.pmoEtc, orgCurrency)
                        )}
                      </Cell>
                      <Cell label={t('uxs04.forecastBudgetUsed', 'Forecast budget used')}>
                        {row.projectedUtilization === null ? (
                          <Unavailable reason={derivedReason} />
                        ) : (
                          pct(row.projectedUtilization * 100)
                        )}
                      </Cell>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* UX-037: where the numbers come from, and the ERP's enforcement state and document, on demand. */}
      {rows.length > 0 && (
        <details className="mt-3 text-[13px]">
          <summary className="cursor-pointer text-muted-foreground">{t('uxs04.sourcesAndStatus', 'Sources and budget enforcement')}</summary>
          <p className="mt-2 text-[12px] text-muted-foreground">
            {t('uxs04.sourcesNote', 'Recorded spending is what the accounting ledger has posted. The budget is your active version; cost to finish is your own estimate and is never sent to the ERP.')}
          </p>
          {quietRows.map((row) => (
            <QuietPushStatus key={`quiet-${row.fiscalYear ?? 'no-year'}`} row={row} />
          ))}
        </details>
      )}
    </section>
  );
};

/** One headline figure. `null` is a dash; the one line under the strip says what is missing. */
const SummaryFigure: React.FC<{
  label: string;
  value: number | null;
  currency: string;
  strong?: boolean;
  alert?: boolean;
}> = ({ label, value, currency, strong, alert }) => (
  <div className="min-w-0">
    <dt className="text-[12px] text-muted-foreground">{label}</dt>
    <dd
      aria-describedby={value === null ? 'forecast-incomplete' : undefined}
      className={`tabular ${strong ? 'text-[16px] font-semibold' : 'text-[14px] font-medium'} ${alert ? 'text-destructive-text' : ''}`}
    >
      {value === null ? <span>—</span> : formatCurrency(value, currency)}
    </dd>
  </div>
);

/**
 * ⚑ AC-BFY-026 — ONE YEAR'S quiet push statement (`pending` / `pushing` / `pushed`).
 *
 * Extracted so a fan-out renders one statement per year rather than one per project. The year is named
 * whenever the row carries one; absent (the inferred "nothing on record for any year" row), nothing is
 * said — never a guess.
 */
const QuietPushStatus: React.FC<{ row: BudgetPushStatusRow }> = ({ row }) => {
  const { t } = useTranslation();
  const quietStates: Record<string, { label: string; variant: 'neutral' | 'progress' | 'won'; detail: string }> = {
    pending: {
      label: t('financeCopy.waitingToReachERPNext', 'Waiting to reach ERPNext'),
      variant: 'neutral',
      detail: t('financeCopy.budgetQueuedForERPNext', 'This budget is queued for ERPNext and has not been sent yet.'),
    },
    pushing: {
      label: t('financeCopy.sendingToERPNext', 'Sending to ERPNext'),
      variant: 'progress',
      detail: t('financeCopy.budgetBeingSentToERPNext', 'This budget is being sent to ERPNext now.'),
    },
    pushed: {
      label: t('financeCopy.enforcedByERPNext', 'Enforced by ERPNext'),
      variant: 'won',
      detail: t('financeCopy.erpNextEnforcingBudget', 'ERPNext is enforcing this budget.'),
    },
  };
  const quiet = row.pushState !== null ? quietStates[row.pushState] : undefined;
  if (!quiet) return null;
  return (
    <div className="mt-3.5 flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card px-3.5 py-2.5 text-[13px]">
      <StatusPill variant={quiet.variant}>{quiet.label}</StatusPill>
      <span className="text-muted-foreground">{quiet.detail}</span>
      {row.fiscalYear && <span className="text-muted-foreground">{t('financeCopy.fiscalYear', "Fiscal year")}{' '}{row.fiscalYear}</span>}
      {row.erpBudgetName && <span className="font-mono text-[12px] text-muted-foreground">{row.erpBudgetName}</span>}
      {/* ⚑ FR-BFY-056 — a year can be PUSHED and still have a stale un-phased attribution (the project
          dates moved after the push). That is not a push failure, so it does not belong in the blocked
          banner; but leaving it unsaid is how the budget column goes blank with no explanation. */}
      {row.staleAttribution && (
        <span className="text-muted-foreground">
          The un-phased lines no longer attribute to this year — the project&rsquo;s dates changed after this push.
          Phase these lines to restore the figure.
        </span>
      )}
    </div>
  );
};

/**
 * ⚑ AC-BFY-026 — ONE YEAR'S blocked push banner, with that year's OWN retry/release.
 *
 * Every sentence here is about a single fiscal year: a fan-out can be enforcing FY2026 and enforcing
 * nothing for FY2027, and a project-level banner could state only one of those.
 */
const BlockedPushStatus: React.FC<{
  row: BudgetPushStatusRow;
  canReleaseHold: boolean;
  releasePending: boolean;
  retryPending: boolean;
  onRelease: () => void;
  onRetry: () => void;
}> = ({ row, canReleaseHold, releasePending, retryPending, onRelease, onRetry }) => {
  const { t } = useTranslation();
  const isUnstamped = row.pushState === 'unstamped-activation';
  const neverArrived = row.pushState === 'never-pushed' || isUnstamped;
  // ⚑ I-5/I-15 — `push_error` is a MACHINE token and is NEVER rendered. One tested translation for
  // both push surfaces (`pushErrorCopy.ts`), which also decides retryability and transport-vs-rule.
  const errorCopy = describePushError(row.pushError);
  // NEW-6 / NEW-3: the blocking category names, and ONLY when the failure IS that map gap.
  // `unmapped_categories` persists on the mirror row across attempts, so after an Admin fixed the map
  // and the next push died in transport, this banner still rendered the PREVIOUS failure's to-do list
  // while its own retry toast said "Nothing on this screen needs fixing" — two contradictory
  // instructions, on screen at once.
  const unmappedCategories = errorCopy.code === 'budget-category-unmapped' ? (row.unmappedCategories ?? null) : null;
  // I-14: a retry is offered only where it can actually work. A button that can only ever fail is worse
  // than no button — it tells the operator the problem is transient when it is structural.
  const offerRetry = !isUnstamped && errorCopy.retryable;
  // MEDIUM-1: `held` alone is NOT enough — the sweep also parks MIRROR rows at `held` with no held
  // outbox command behind them, and the release then throws. Ask the outbox (`holdReleasable`).
  const offerRelease = row.pushState === 'held' && row.holdReleasable && canReleaseHold;
  return (
    <GateNotice variant="blocked" className="mt-3.5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          {/* ⚑ I-7 — "still enforcing the PREVIOUS budget" is materially WRONG for a push that never
              arrived: if this was the first push, ERPNext is enforcing NOTHING, which is a worse
              situation, not a milder one. The headline follows the actual state. */}
          <b className="font-semibold">
            {neverArrived
              ? 'ERPNext is not enforcing any budget for this project.'
              : 'ERPNext is still enforcing the previous budget for this project.'}
          </b>
          <div className="mt-1">
            {isUnstamped
              ? 'This budget version has no record of when it was activated, so it cannot be handed to ERPNext. Activate a new version to push the current budget.'
              : row.pushState === 'never-pushed'
                ? 'The activated budget never reached ERPNext — it was not recorded as pushed at all, so no budget of any kind was created there.'
                : errorCopy.message}
          </div>
          {/* ⚑ I-11 — a withheld Retry needs a real route out, and naming the remedy without naming the
              CONTROL that performs it is still a dead end. */}
          {isUnstamped && (
            <div className="mt-1">
              {t('financeCopy.use', "Use")}{' '}<b>{t('financeCopy.cloneToRevise', "Clone to revise")}</b> {t('financeCopy.onTheActiveVersionAboveThenActivateTheCloneThatRecordsARealActivationAndCanBePushed', "on the active version above, then activate the clone — that records a real activation and can be pushed.")}</div>
          )}
          {/* ⚑ NEW-5 — the alarm names the year it is about. On a multi-fiscal-year project it is
              otherwise unattributable: a failure about 2027 sitting over a grid of 2026 with nothing to
              connect or separate them. Absent (an inferred never-pushed state has no mirror row and so
              no year), nothing is said — never a guess. */}
          {row.fiscalYear && <div className="mt-1 text-muted-foreground">{t('financeCopy.fiscalYear', "Fiscal year")}{' '}{row.fiscalYear}</div>}
          {!isUnstamped && errorCopy.remedy && <div className="mt-1">{errorCopy.remedy}</div>}
          {/* ⚑ NEW-6 (audit round 4): the actionable half of the failure. The dispatch gate records WHICH
              categories have no ERP account (FR-BUD-113 collected the names on purpose), but nothing read
              them back — so this banner could only ever show the bare code `budget-category-unmapped`,
              telling an Admin that something is broken while withholding the one fact that makes it
              fixable. These names ARE the to-do list, so they are marked up as one. */}
          {unmappedCategories && (
            <div className="mt-2">
              <p className="text-[13px] font-medium">{t('financeCopy.mapTheseCategoriesToAnERPAccountThenRetry', "Map these categories to an ERP account, then retry:")}</p>
              {/* A STABLE accessible name, deliberately not `aria-labelledby` the sentence above: the
                  list's identity should not change every time that copy is reworded. */}
              <ul aria-label={t('financeCopy.categoriesThatNeedAnERPAccount', "Categories that need an ERP account")} className="mt-1 list-disc pl-5 text-[13px]">
                {unmappedCategories.map((c) => (
                  <li key={c}>{c}</li>
                ))}
              </ul>
              {/* ⚑ I-8 — naming the to-do is half the job; the banner must reach the place it is done. */}
              <Link
                to={ACCOUNT_MAP_HREF}
                className="mt-1.5 inline-block font-medium underline underline-offset-2 hover:no-underline"
              >
                {t('financeCopy.openTheBudgetAccountMap', "Open the budget account map")}</Link>
            </div>
          )}
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {offerRelease && (
            <Button variant="outline" size="sm" loading={releasePending} onClick={onRelease}>
              {t('financeCopy.releaseTheHold', "Release the hold")}</Button>
          )}
          {offerRetry && (
            <Button variant="outline" size="sm" loading={retryPending} onClick={onRetry}>
              {t('financeCopy.retryThePush', "Retry the push")}</Button>
          )}
        </div>
      </div>
    </GateNotice>
  );
};

/**
 * ⚑ NEW-1 — one money cell, two shapes, ONE markup tree.
 *
 * Below `sm` the table's header row is hidden and each cell becomes its own label/value line, so a
 * figure is never clipped mid-way ("$120" for $120,000) and nothing is wide enough to make the page
 * pan. From `sm` up it is an ordinary right-aligned table cell. Rendering the label in both shapes
 * (visually hidden on desktop, where the column header carries it) keeps a single DOM for both — no
 * media-query hook, no double render, and the a11y name of the value is the same either way.
 */
const Cell: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <td className="flex items-baseline justify-between gap-4 px-3 py-1 text-right tabular sm:table-cell sm:h-[54px] sm:py-2">
    {/* NOT `aria-hidden`: below `sm` the <thead> is `display:none`, so the column header is out of the
        accessibility tree too — this label is then the ONLY thing naming the figure for a screen
        reader. From `sm` up it is `display:none` itself, so the <th> does that job and nothing is
        announced twice. */}
    <span className="text-[12px] font-normal text-muted-foreground sm:hidden">{label}</span>
    {children}
  </td>
);

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
