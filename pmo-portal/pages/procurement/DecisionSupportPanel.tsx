/**
 * AC-IXD-PROC-W5-2 — DecisionSupportPanel
 *
 * A read-only budget-impact card placed in the evidence zone of ProcurementDetails,
 * directly under StatTiles. Renders ONLY when p.project_id is set.
 *
 * Data (OD-W5-4 — ONE honest "spent" basis everywhere):
 *   • Budget        = useProjectBudget(projectId) — Σ Active budget-version line items.
 *   • Committed     = useProjectCommittedSpend(projectId) — Σ PO total_value in
 *                     Ordered/Received/Vendor Invoiced/Paid (the EXACT basis the
 *                     dashboards use, 0009_dashboard_margin.sql). NOT the static
 *                     projects.spent column (which is 0 in seed and contradicts the
 *                     Finance dashboard).
 * No new RPC — two focused org-scoped reads.
 *
 * The four figures (text-labelled, a11y: text-not-color-only per DESIGN.md §4):
 *   This request · Remaining (budget − committed) · Project budget · After this request.
 * Over-budget is a non-blocking advisory (approval still permitted — OD-W5-4/OD-W5-5).
 */
import React from 'react';
import { Link } from 'react-router-dom';
import { Card, CardPad } from '@/src/components/ui/Card';
import { StatTiles } from '@/src/components/ui/StatTiles';
import { ErrBanner } from '@/src/components/ui/ErrBanner';
import { ProjectNameLink } from '@/src/components/ui/ProjectNameLink';
import { useProjectBudget } from '@/src/hooks/useBudget';
import { useProjectCommittedSpend } from '@/src/hooks/useProcurements';
import { formatCurrency } from '@/src/lib/format';

export interface DecisionSupportPanelProps {
  /** The procurement's project_id. Pass null/undefined to suppress the panel. */
  projectId: string | null | undefined;
  /** The procurement's total_value (this request's cost). */
  totalValue: number;
  /** Project display name (from DETAIL_SELECT join). */
  projectName: string | null | undefined;
}

export const DecisionSupportPanel: React.FC<DecisionSupportPanelProps> = ({
  projectId,
  totalValue,
  projectName,
}) => {
  // Hooks must be called unconditionally; both are no-ops (enabled:false) when
  // projectId is falsy, so the early return below is safe.
  const budget = useProjectBudget(projectId ?? '');
  const committed = useProjectCommittedSpend(projectId);

  // Bail out — no project linked.
  if (!projectId) return null;

  const heading = (
    <div className="mb-3 flex items-baseline gap-1">
      <h3 className="text-[12.5px] font-semibold text-muted-foreground uppercase tracking-[0.06em]">
        Budget impact
      </h3>
      {projectName ? (
        <ProjectNameLink
          projectId={projectId}
          name={projectName}
          className="text-[12.5px] font-medium text-foreground"
        />
      ) : null}
    </div>
  );

  const isPending = budget.isPending || committed.isPending;
  const isError = budget.isError || committed.isError;

  // ── Loading state ──────────────────────────────────────────────────────────
  if (isPending) {
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
  if (isError) {
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

  // ── Figures (committed basis, OD-W5-4) ───────────────────────────────────────
  const committedSpend = committed.data ?? 0;
  const remaining = budgetAmount - committedSpend;
  const afterRequest = remaining - totalValue;
  const afterPct = budgetAmount > 0 ? (afterRequest / budgetAmount) * 100 : 0;

  const isOverBudget = totalValue > remaining;
  const overageAmount = isOverBudget ? totalValue - remaining : 0;

  const tiles = [
    {
      label: 'This request',
      value: formatCurrency(totalValue),
    },
    {
      label: 'Remaining vs. committed',
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

        {/* Four stat tiles — text-labelled, tabular-nums (a11y: not color-only).
            Committed spend (Σ PO total_value in Ordered..Paid) is the denominator of
            "Remaining vs. committed" and "After this request"; no progress bar — an
            uninformative single-segment 0% bar misreads as broken (Wave-5 I1). */}
        <StatTiles tiles={tiles} />

        {/* Over-budget advisory — non-blocking. ErrBanner is role="status" (gentle,
            not an alert) and carries the dollar overage in text (WCAG SC 1.4.1, not
            color-only). Approval is still permitted (OD-W5-4/OD-W5-5). */}
        {isOverBudget && (
          <ErrBanner
            className="mt-3 mb-0"
            title="Over remaining budget"
            sub={
              <>
                This request exceeds remaining budget by{' '}
                <strong className="tabular">{formatCurrency(overageAmount)}</strong>. Approval is
                still permitted — this is an advisory only.
              </>
            }
          />
        )}

        {/* Explicit affordance to drill into the project budget detail.
            Styled as a quiet link (not a competing CTA) — the decision zone
            primary action owns the blue; this is a secondary navigation escape. */}
        <div className="mt-3 pt-3 border-t border-border/50">
          <Link
            to={`/projects/${projectId}`}
            className="inline-flex items-center gap-1 text-[12px] font-medium text-primary hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring underline-offset-4"
          >
            Open project
          </Link>
        </div>
      </CardPad>
    </Card>
  );
};
