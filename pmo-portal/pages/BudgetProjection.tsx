import React, { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ListState, GateNotice, Button, useToast } from '@/src/components/ui';
import { usePermission } from '@/src/auth/usePermission';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import { formatCurrency, parseMoneyInput, pct } from '@/src/lib/format';
import {
  fetchBudgetProjection,
  upsertBudgetProjectionEtc,
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

  const [fiscalYear, setFiscalYear] = useState(() => String(new Date().getFullYear()));

  const queryKey = useMemo(() => ['budget-projection', projectId, fiscalYear] as const, [projectId, fiscalYear]);
  const { data, isPending, isError, refetch } = useQuery<BudgetProjectionCellRow[]>({
    queryKey,
    queryFn: () => fetchBudgetProjection(projectId, fiscalYear),
  });

  const rows = data ?? [];

  const etcMutation = useMutation({
    mutationFn: (v: { category: BudgetCategory; pmoEtc: number }) =>
      upsertBudgetProjectionEtc(projectId, fiscalYear, v.category, v.pmoEtc),
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
    const parsed = parseMoneyInput(etcInput);
    if (parsed === null || parsed < 0) {
      setEtcError('Enter a valid, non-negative amount');
      return;
    }
    try {
      await etcMutation.mutateAsync({ category, pmoEtc: parsed });
      toast('Estimate to complete saved', `${category} · ${fiscalYear}`, 'success');
      setEditingCategory(null);
    } catch (err) {
      const { headline, detail } = classifyMutationError(err);
      toast(headline, detail, 'warning');
    }
  };

  // FR-BUD-123: the push-state banner — the FIRST failed/held row drives it (one banner per project,
  // not per category; the operational consequence is project-wide regardless of which category
  // triggered it).
  const blockedRow = rows.find((r) => r.pushState === 'failed' || r.pushState === 'held');

  if (isPending) {
    return (
      <div className="rounded-lg border border-border bg-card">
        <ListState variant="loading" rows={5} testId="budget-projection-loading" />
      </div>
    );
  }

  if (isError) {
    return (
      <ListState
        variant="error"
        title="Couldn't load the budget projection"
        sub="The request failed. Check your connection and try again."
        onRetry={() => refetch()}
      />
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
        <label className="flex items-center gap-1.5 text-[13px] text-muted-foreground">
          Fiscal year
          <select
            aria-label="Fiscal year"
            value={fiscalYear}
            onChange={(e) => setFiscalYear(e.target.value)}
            className="h-8 rounded-md border border-input bg-background px-2 text-[13px] outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            {[0, 1, 2].map((delta) => {
              const y = String(new Date().getFullYear() - delta);
              return (
                <option key={y} value={y}>
                  {y}
                </option>
              );
            })}
          </select>
        </label>
      </div>

      {blockedRow && (
        <GateNotice variant="blocked" className="mt-3.5">
          <div>
            <b className="font-semibold">ERPNext is still enforcing the previous budget for this project.</b>
            <div className="mt-1">{blockedRow.pushError ?? 'The push to ERPNext has not completed.'}</div>
          </div>
        </GateNotice>
      )}

      {rows.length === 0 ? (
        <div className="mt-3.5">
          <ListState
            variant="empty"
            icon="folder"
            title={`No projection data yet for ${fiscalYear}`}
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
                        {canEditEtc && (
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
