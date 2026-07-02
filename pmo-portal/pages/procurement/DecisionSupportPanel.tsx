/**
 * AC-IXD-PROC-W5-2 / AC-RB-004..014 — DecisionSupportPanel
 *
 * A read-only budget-impact card placed in the evidence zone of ProcurementDetails,
 * directly under StatTiles. Renders ONLY when p.project_id is set AND the case status
 * is pre-Ordered (Draft..Quote Selected) — ADR-0034 §6.
 *
 * Three budget layers (ADR-0034):
 *   • Budget    = useProjectBudget(projectId) — Σ Active budget-version line items.
 *   • Committed = useProjectCommittedSpend(projectId) — Σ PO total_value in
 *                 Ordered/Received/Vendor Invoiced/Paid (the EXACT basis the dashboards
 *                 use, 0009_dashboard_margin.sql). UNCHANGED by this feature.
 *   • Reserved  = useProjectReservedSpend(projectId) — Σ total_value in Approved/Vendor
 *                 Quoted/Quote Selected (approved, not yet ordered — "encumbrance").
 * No new RPC — three focused org-scoped reads.
 *
 * Available = Budget − Committed − Reserved (the over-commitment-safe headroom).
 *
 * The five figures (text-labelled, a11y: text-not-color-only per DESIGN.md §4):
 *   This request · Reserved (other) · Available · Project budget · After this request.
 * Over-budget is a non-blocking advisory (approval still permitted — OD-W5-4/OD-W5-5).
 *
 * Per-stage "After this request" math (ADR-0034 §5 — the double-count fix): when the
 * viewed case is itself already in Reserved (status ∈ Approved/Vendor Quoted/Quote
 * Selected), its value is already inside `reserved`, so After == Available (do NOT
 * subtract thisRequest again). Otherwise (Draft/Requested) After = Available − thisRequest.
 */
import React from 'react';
import { Link } from 'react-router-dom';
import { Card, CardPad } from '@/src/components/ui/Card';
import { StatTiles } from '@/src/components/ui/StatTiles';
import { ErrBanner } from '@/src/components/ui/ErrBanner';
import { ProjectNameLink } from '@/src/components/ui/ProjectNameLink';
import { useProjectBudget } from '@/src/hooks/useBudget';
import { useProjectCommittedSpend, useProjectReservedSpend } from '@/src/hooks/useProcurements';
import type { ProcurementStatus } from '@/src/lib/db/procurementLifecycle';
import { formatCurrency } from '@/src/lib/format';
import { computeBudgetSignal } from './computeBudgetSignal';

/** Pre-Ordered statuses where the panel is a live decision-support tool (ADR-0034 §6). */
const PANEL_VISIBLE_STATUSES: ProcurementStatus[] = [
  'Draft',
  'Requested',
  'Approved',
  'Vendor Quoted',
  'Quote Selected',
];

export interface DecisionSupportPanelProps {
  /** The procurement's project_id. Pass null/undefined to suppress the panel. */
  projectId: string | null | undefined;
  /** The procurement's total_value (this request's cost). */
  totalValue: number;
  /** Project display name (from DETAIL_SELECT join). */
  projectName: string | null | undefined;
  /** The case's current status — drives per-stage math + the visibility boundary. */
  status: ProcurementStatus;
}

export const DecisionSupportPanel: React.FC<DecisionSupportPanelProps> = ({
  projectId,
  totalValue,
  projectName,
  status,
}) => {
  // Hooks must be called unconditionally; all are no-ops (enabled:false) when
  // projectId is falsy, so the early returns below are safe.
  const budget = useProjectBudget(projectId ?? '');
  const committed = useProjectCommittedSpend(projectId);
  const reservedQ = useProjectReservedSpend(projectId);

  // Bail out — no project linked (takes precedence over the status gate, FR-RB-020).
  if (!projectId) return null;

  // Bail out — post-Ordered / terminal: the panel is a pre-decision tool only, and
  // hiding it here makes the legacy double-count path structurally impossible.
  if (!PANEL_VISIBLE_STATUSES.includes(status)) return null;

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

  const isPending = budget.isPending || committed.isPending || reservedQ.isPending;
  const isError = budget.isError || committed.isError || reservedQ.isError;

  // ── Loading state ──────────────────────────────────────────────────────────
  if (isPending) {
    return (
      <Card variant="bare" className="mb-4">
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
      <Card variant="bare" className="mb-4">
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
      <Card variant="bare" className="mb-4">
        <CardPad>
          {heading}
          <p className="text-[13px] text-muted-foreground">
            No active budget set for this project — budget impact can&apos;t be shown.
          </p>
        </CardPad>
      </Card>
    );
  }

  // ── Figures (three layers, ADR-0034) ─────────────────────────────────────────
  // Interdependent budget math lives in the pure computeBudgetSignal helper so it is
  // independently unit-testable; this block is presentation-only.
  const committedSpend = committed.data ?? 0;
  const reserved = reservedQ.data ?? 0; // TOTAL reserved (incl. this case if applicable)
  const { available, afterRequest, otherReserved, overAvailable, overAvailableAmount, overBudgetReserved } =
    computeBudgetSignal({
      budget: budgetAmount,
      committed: committedSpend,
      reserved,
      totalValue,
      status,
    });
  const afterPct = budgetAmount > 0 ? (afterRequest / budgetAmount) * 100 : 0;

  const tiles = [
    { label: 'This request', value: formatCurrency(totalValue) },
    {
      label: 'Reserved',
      value: formatCurrency(otherReserved),
      sub: 'approved, not yet ordered',
    },
    {
      label: 'Available',
      value: formatCurrency(available),
      tone: available < 0 ? ('neg' as const) : undefined,
    },
    { label: 'Project budget', value: formatCurrency(budgetAmount) },
    {
      label: 'After this request',
      value: formatCurrency(afterRequest),
      // I4 (design-review): afterPct is headroom remaining (afterRequest/budget),
      // NOT utilization — labelled "% headroom remaining" for honest spend control.
      sub: `${afterPct.toFixed(1)}% headroom remaining`,
      tone: afterRequest < 0 ? ('neg' as const) : undefined,
    },
  ];

  return (
    <Card variant="bare" className="mb-4">
      <CardPad>
        {heading}

        {/* Five stat tiles — text-labelled, tabular-nums (a11y: not color-only).
            Available (Budget − Committed − Reserved) is the over-commitment-safe
            headroom; no progress bar — an uninformative single-segment 0% bar
            misreads as broken (Wave-5 I1). columns=3 → a 3+2 strip for five tiles. */}
        <StatTiles tiles={tiles} columns={3} />

        {/* Over-available advisory — non-blocking. ErrBanner is role="status" (gentle,
            not an alert) and carries the dollar overage in text (WCAG SC 1.4.1, not
            color-only). Approval is still permitted (OD-W5-4/OD-W5-5). */}
        {overAvailable && (
          <ErrBanner
            className="mt-3 mb-0"
            title="Over available budget"
            sub={
              <>
                This request exceeds available budget by{' '}
                <strong className="tabular">{formatCurrency(overAvailableAmount)}</strong>. Approval
                is still permitted — this is an advisory only.
              </>
            }
          />
        )}

        {/* Already-reserved + project over budget — no thisRequest advisory (it is
            already counted in Reserved); surface the over-budget condition instead. */}
        {overBudgetReserved && (
          <ErrBanner
            className="mt-3 mb-0"
            title="Project over budget"
            sub={
              <>
                This project is over budget by{' '}
                <strong className="tabular">{formatCurrency(-available)}</strong> across committed
                and reserved demand. This is an advisory only.
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
            className="inline-flex items-center gap-1 text-[12px] font-medium text-primary-text hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring underline-offset-4"
          >
            Open project
          </Link>
        </div>
      </CardPad>
    </Card>
  );
};
