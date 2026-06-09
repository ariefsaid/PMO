/**
 * AC-IXD-PROC-W5-2 — DecisionSupportPanel
 *
 * A read-only budget-impact card placed in the evidence zone of ProcurementDetails,
 * directly under StatTiles. Renders ONLY when p.project_id is set.
 *
 * Data: widened DETAIL_SELECT supplies project.budget + project.spent (committed
 * basis, OD-W5-4). useProjectBudget(projectId) returns the derived Σ-active-version
 * figure; we use it as the denominator. No new RPC.
 *
 * Design tokens only — no raw hex. Every figure is text-labelled (a11y:
 * text-not-color-only per DESIGN.md §4).
 */
import React from 'react';
import { Card, CardPad } from '@/src/components/ui/Card';
import { StatTiles } from '@/src/components/ui/StatTiles';
import { ProgressBar } from '@/src/components/ui/ProgressBar';
import { Icon } from '@/src/components/ui/icons';
import { useProjectBudget } from '@/src/hooks/useBudget';
import { formatCurrency } from '@/src/lib/format';

export interface DecisionSupportPanelProps {
  /** The procurement's project_id. Pass null/undefined to suppress the panel. */
  projectId: string | null | undefined;
  /** The procurement's total_value (this request's cost). */
  totalValue: number;
  /** Project display name (from DETAIL_SELECT join). */
  projectName: string | null | undefined;
  /**
   * Committed spend on the project (OD-W5-4: Σ PO total_value in Ordered..Paid).
   * Sourced from the widened project join (project.spent). Falls back to 0.
   */
  projectSpent?: number;
}

export const DecisionSupportPanel: React.FC<DecisionSupportPanelProps> = ({
  projectId,
  totalValue,
  projectName,
  projectSpent = 0,
}) => {
  // Panel only meaningful when the PR is linked to a project.
  // Early return BEFORE the hook call would violate hooks rules — so we guard
  // the render in the hook-driven section below, but we still call the hook
  // unconditionally (hooks must not be conditional). The hook is a no-op when
  // projectId is falsy (enabled: false in useQuery).
  const budget = useProjectBudget(projectId ?? '');

  // Bail out — no project linked.
  if (!projectId) return null;

  const heading = (
    <div className="mb-3 flex items-center justify-between">
      <span className="text-[12.5px] font-semibold text-muted-foreground uppercase tracking-[0.06em]">
        Budget impact
        {projectName ? (
          <span className="ml-1 normal-case font-medium text-foreground"> · {projectName}</span>
        ) : null}
      </span>
    </div>
  );

  // ── Loading state ──────────────────────────────────────────────────────────
  if (budget.isPending) {
    return (
      <Card className="mb-4">
        <CardPad>
          {heading}
          <div className="flex flex-col gap-2" aria-label="Loading budget impact">
            <div className="skel h-[18px] w-3/4" />
            <div className="skel h-[14px] w-1/2" />
          </div>
        </CardPad>
      </Card>
    );
  }

  // ── Error state ────────────────────────────────────────────────────────────
  if (budget.isError) {
    return (
      <Card className="mb-4">
        <CardPad>
          {heading}
          <p className="text-[13px] text-muted-foreground">
            Budget unavailable — budget impact can&apos;t be shown right now.
          </p>
        </CardPad>
      </Card>
    );
  }

  const budgetAmount = budget.data ?? 0;

  // ── No active budget ───────────────────────────────────────────────────────
  if (budgetAmount === 0) {
    return (
      <Card className="mb-4">
        <CardPad>
          {heading}
          <p className="text-[13px] text-muted-foreground">
            No active budget set for this project — budget impact can&apos;t be shown.
          </p>
        </CardPad>
      </Card>
    );
  }

  // ── Figures ────────────────────────────────────────────────────────────────
  const spent = projectSpent;
  const remaining = budgetAmount - spent;
  const afterRequest = remaining - totalValue;
  const afterPct = budgetAmount > 0 ? (afterRequest / budgetAmount) * 100 : 0;

  const isOverBudget = totalValue > remaining;
  const overageAmount = isOverBudget ? totalValue - remaining : 0;

  // ProgressBar: spent-vs-budget percentage (committed utilization).
  // The "this request" portion would push beyond, but we represent committed
  // utilization as the primary bar; the over-budget text conveys the impact
  // (a11y: color is supplementary, text carries the meaning).
  const spentPct = budgetAmount > 0 ? Math.round((spent / budgetAmount) * 100) : 0;
  // Threshold tone: spent < 70% → success, < 90% → warning, else destructive
  const barTone = spentPct >= 90 ? 'destructive' : spentPct >= 70 ? 'warning' : 'success';

  const tiles = [
    {
      label: 'This request',
      value: formatCurrency(totalValue),
    },
    {
      label: 'Remaining (vs. spend)',
      value: formatCurrency(remaining),
      tone: remaining < 0 ? ('neg' as const) : undefined,
    },
    {
      label: 'Project budget',
      value: formatCurrency(budgetAmount),
    },
    {
      label: 'After this request',
      value: formatCurrency(afterRequest),
      sub: `${afterPct.toFixed(1)}% of budget`,
      tone: afterRequest < 0 ? ('neg' as const) : undefined,
    },
  ];

  return (
    <Card className="mb-4">
      <CardPad>
        {heading}

        {/* Four stat tiles — text-labelled, tabular-nums (a11y: not color-only) */}
        <StatTiles tiles={tiles} className="mb-3" />

        {/* ProgressBar: spent utilization with aria-label (a11y supplement) */}
        <ProgressBar
          value={spentPct}
          tone={barTone}
          showValue
          aria-label={`${projectName ?? 'Project'} budget utilization: ${spentPct}%`}
          className="w-full"
        />

        {/* Over-budget advisory — role="alert" so screen readers announce it;
            text conveys the dollar amount (not color-only per WCAG SC 1.4.1).
            Advisory only — approval is still permitted (OD-W5-4/OD-W5-5). */}
        {isOverBudget && (
          <div
            role="alert"
            className="mt-3 flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/8 px-3 py-2 text-[13px] text-destructive"
          >
            <Icon name="alert" className="mt-px size-4 shrink-0" />
            <span>
              This request exceeds remaining budget by{' '}
              <strong className="tabular">{formatCurrency(overageAmount)}</strong>. Approval is still
              permitted — this is an advisory only.
            </span>
          </div>
        )}
      </CardPad>
    </Card>
  );
};
