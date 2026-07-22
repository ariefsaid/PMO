import React, { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ListState, GateNotice, Button, useToast } from '@/src/components/ui';
import { usePermission } from '@/src/auth/usePermission';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import { formatCurrency, parseMoneyInput, pct } from '@/src/lib/format';
import {
  fetchBudgetProjection,
  listBudgetFiscalYears,
  upsertBudgetProjectionEtc,
  retryActiveBudgetPush,
  type BudgetFiscalYearRow,
  type BudgetProjectionCellRow,
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
 */

export interface BudgetProjectionProps {
  projectId: string;
}

const CATEGORY_LABELS: Record<string, string> = {}; // reserved for future per-org relabeling; identity today.
const labelFor = (c: string) => CATEGORY_LABELS[c] ?? c;

const money = (v: number | null): string => (v === null ? '—' : formatCurrency(v));

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

  const rows = data ?? [];

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

  const openEdit = (row: BudgetProjectionCellRow) => {
    setEditingCategory(row.category);
    setEtcInput(String(row.pmoEtc));
    setEtcError(null);
  };
  const closeEdit = () => {
    setEditingCategory(null);
    setEtcError(null);
  };

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
      setEditingCategory(null);
    } catch (err) {
      const { headline, detail } = classifyMutationError(err);
      toast(headline, detail, 'warning');
    }
  };

  // FR-BUD-123: the push-state banner — the FIRST unhealthy row drives it (one banner per project, not
  // per category; the operational consequence is project-wide regardless of which category triggered
  // it).
  //
  // ⚑ HIGH-C: `'never-pushed'` is in this set. It is what `get_budget_projection` reports when the
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
  const blockedRow = rows.find(
    (r) =>
      r.pushState === 'failed' ||
      r.pushState === 'held' ||
      r.pushState === 'never-pushed' ||
      r.pushState === 'unstamped-activation',
  );
  const isUnstamped = blockedRow?.pushState === 'unstamped-activation';

  // HIGH-D: the recovery affordance. `held`/`failed`/`never-pushed` are all re-drivable — under the
  // OPERATOR's own JWT, which is the authenticated actor the sweep backstop can never synthesize
  // (FR-BUD-102). Without it, fixing the blocking cause (mapping the missing category) changed nothing:
  // the backstop excludes `held`, and re-activating is refused by the Draft-only guard.
  const retryMutation = useMutation({
    mutationFn: () => retryActiveBudgetPush(projectId),
    onSettled: () => qc.invalidateQueries({ queryKey }),
  });

  const retryPush = async () => {
    try {
      const { pushState } = await retryMutation.mutateAsync();
      if (pushState === 'pushed') {
        toast('Budget pushed to ERPNext', 'ERPNext is now enforcing the active budget.', 'success');
      } else {
        toast('The push did not complete', 'The reason shown above may need fixing first.', 'warning');
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

      {blockedRow && (
        <GateNotice variant="blocked" className="mt-3.5">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <b className="font-semibold">ERPNext is still enforcing the previous budget for this project.</b>
              <div className="mt-1">
                {isUnstamped
                  ? 'This budget version has no record of when it was activated, so it cannot be handed to ERPNext. Activate a new version to push the current budget.'
                  : blockedRow.pushState === 'never-pushed'
                    ? 'The activated budget never reached ERPNext — it was not recorded as pushed at all.'
                    : blockedRow.pushError ?? 'The push to ERPNext has not completed.'}
              </div>
            </div>
            {!isUnstamped && (
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
            sub="Activate a budget version, log an estimate to complete, or wait for ERP actuals to sync."
          />
        </div>
      ) : (
        <div className="mt-3.5 overflow-x-auto">
          <table className="w-full border-collapse text-[13px]">
            <thead>
              <tr>
                <TH>Category</TH>
                <TH align="right">Budget (PMO)</TH>
                <TH align="right">Actuals to date (ERP GL)</TH>
                <TH align="right">ETC (PMO)</TH>
                <TH align="right">Projected final</TH>
                <TH align="right">Variance</TH>
                <TH align="right">Utilization</TH>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.category} className="border-b border-border/70 last:border-b-0">
                  <td className="px-3 py-2 font-medium">{labelFor(row.category)}</td>
                  <td className="px-3 py-2 text-right">{money(row.pmoBudgetAmount)}</td>
                  <td className="px-3 py-2 text-right">{money(row.actualsToDate)}</td>
                  <td className="px-3 py-2 text-right">
                    {editingCategory === row.category ? (
                      <div className="flex flex-col items-end gap-0.5">
                        <label htmlFor={`etc-${row.category}`} className="sr-only">
                          Estimate to complete
                        </label>
                        <input
                          id={`etc-${row.category}`}
                          type="text"
                          inputMode="decimal"
                          aria-label="Estimate to complete"
                          value={etcInput}
                          onChange={(e) => setEtcInput(e.target.value)}
                          className="h-8 w-[110px] rounded-md border border-input bg-background px-2 text-right text-[13px] outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                        />
                        {etcError && <span className="text-[12px] text-destructive">{etcError}</span>}
                        <div className="flex gap-1.5">
                          <Button
                            variant="primary"
                            size="sm"
                            loading={etcMutation.isPending}
                            onClick={() => void saveEdit(row.category)}
                          >
                            Save
                          </Button>
                          <Button variant="ghost" size="sm" onClick={closeEdit}>
                            Cancel
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-center justify-end gap-2">
                        {money(row.pmoEtc)}
                        {canEditEtc && fiscalYear !== null && (
                          <Button variant="ghost" size="sm" onClick={() => openEdit(row)}>
                            {`Edit ${row.category} ETC`}
                          </Button>
                        )}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right">{money(row.projectedFinalCost)}</td>
                  <td className="px-3 py-2 text-right">{money(row.projectedVariance)}</td>
                  <td className="px-3 py-2 text-right">
                    {row.projectedUtilization === null ? '—' : pct(row.projectedUtilization * 100)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
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
