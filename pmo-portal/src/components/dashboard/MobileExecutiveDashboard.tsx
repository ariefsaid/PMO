/**
 * MobileExecutiveDashboard — glanceable mobile composition for the Executive role.
 *
 * Wave-0 S1. Answers the exec's three questions in order:
 *   (a) What's on fire? → at-risk block
 *   (b) What's waiting on me? → approvals action band
 *   (c) Is the book healthy? → Contract book (Revenue on hand + Active contract value)
 *
 * Then defers: pipeline below fold, charts single-column.
 *
 * Design tokens: DESIGN.md only. No raw hex / px. Single-render (rendered only
 * when useIsDesktop()=false, so exactly one DOM branch exists).
 *
 * B-MIN-3 fix: the two money tiles are grouped under a "Contract book" overline,
 * each with an explicit source micro-label. "Total contract value" is relabeled
 * "Active contract value" with a source-line explaining the scope.
 */
import React from 'react';
import { Link } from 'react-router-dom';
import { cn } from '@/src/components/ui/cn';
import { Icon } from '@/src/components/ui/icons';
import { formatCurrency } from '@/src/lib/format';
import type { ExecutiveDashboard } from '@/src/lib/db/dashboard';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface MobileExecutiveDashboardProps {
  data: ExecutiveDashboard;
  /** Approval items waiting on this user (proc + timesheets). */
  approvalCount: number;
  /** Rendered below the above-fold section (charts, pipeline, etc.). */
  belowFold: React.ReactNode;
}

// ── Subcomponents ─────────────────────────────────────────────────────────────

/**
 * Overline label — DESIGN.md typography.overline tokens.
 * 11px / 600 / 0.06em / uppercase / muted-foreground.
 */
const Overline: React.FC<{ children: React.ReactNode; className?: string }> = ({
  children,
  className,
}) => (
  <p
    className={cn(
      'text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground',
      className
    )}
  >
    {children}
  </p>
);

/**
 * AtRiskBlock — the primary decision card.
 *
 * Tone: warning (amber icon tile, warning-foreground value).
 * Zero state: success/neutral copy ("all on track"), amber tile → neutral.
 *
 * Drill cells link to /projects?filter=Ongoing (active projects) and
 * /projects?filter=Ongoing (spend breakdown). Both are single links
 * with descriptive aria-labels (no nested interactive — DESIGN.md a11y rule).
 */
const AtRiskBlock: React.FC<{
  atRisk: number;
  activeProjects: number;
  totalSpend: number;
}> = ({ atRisk, activeProjects, totalSpend }) => {
  const isAtRisk = atRisk > 0;

  return (
    <div
      data-testid="dashboard-at-risk"
      aria-label={isAtRisk ? `${atRisk} projects at risk` : 'All projects on track'}
      className="rounded-lg border border-border bg-card p-4"
    >
      {/* Icon + label row */}
      <div className="flex items-center gap-[10px]">
        <span
          aria-hidden="true"
          className={cn(
            'grid size-[30px] shrink-0 place-items-center rounded-lg [&_svg]:size-[17px]',
            isAtRisk
              ? 'bg-warning/[0.14] text-warning-foreground'
              : 'bg-success/[0.13] text-success'
          )}
        >
          <Icon name="alert" />
        </span>
        <span className="text-[12px] font-semibold text-muted-foreground">
          Projects at risk
        </span>
      </div>

      {/* Value + sub row */}
      <div className="mt-2 flex items-baseline gap-2">
        <span
          className={cn(
            'tabular text-[23px] font-bold leading-tight',
            isAtRisk ? 'text-warning-foreground' : 'text-foreground'
          )}
        >
          {atRisk}
        </span>
        <span className="text-[12.5px] text-muted-foreground">
          {isAtRisk
            ? `of ${activeProjects} active projects flagged over budget or behind schedule`
            : `of ${activeProjects} active · all on track`}
        </span>
      </div>

      {/* Drill cells — two links, each a single focusable element */}
      <div className="mt-3 flex gap-[10px]">
        <Link
          to="/projects?filter=Ongoing"
          aria-label={`Open active projects · ${activeProjects} projects`}
          className="touch-target flex-1 rounded-[6px] border border-border p-[9px_10px] text-inherit no-underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          <span className="block text-[11px] font-semibold uppercase tracking-[0.04em] text-muted-foreground">
            Active projects
          </span>
          <span className="tabular mt-[3px] block text-[17px] font-bold">
            {activeProjects}
          </span>
          <span className="mt-1 block text-[11px] font-semibold text-primary">
            View →
          </span>
        </Link>

        <Link
          to="/projects?filter=Ongoing"
          aria-label={`Open spend breakdown · ${formatCurrency(totalSpend)} spent to date`}
          className="touch-target flex-1 rounded-[6px] border border-border p-[9px_10px] text-inherit no-underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          <span className="block text-[11px] font-semibold uppercase tracking-[0.04em] text-muted-foreground">
            Spent to date
          </span>
          <span className="tabular mt-[3px] block text-[17px] font-bold">
            {formatCurrency(totalSpend)}
          </span>
          <span className="mt-1 block text-[11px] font-semibold text-primary">
            Breakdown →
          </span>
        </Link>
      </div>
    </div>
  );
};

/**
 * MobileApprovalsBand — one-line action band.
 *
 * A single <Link> to /approvals with a primary "Review →" CTA on the right.
 * One Blue Rule: this is the only `primary`-colored affordance above the fold.
 * The whole row is a link (no nested button inside link — single focusable element).
 */
const MobileApprovalsBand: React.FC<{ count: number }> = ({ count }) => {
  const label = `Awaiting your approval: ${count} ${count === 1 ? 'item' : 'items'}. Open approvals inbox.`;
  return (
    <Link
      to="/approvals"
      data-testid="mobile-approvals-band"
      aria-label={label}
      className="touch-target flex items-center gap-3 rounded-lg border border-border bg-card p-[13px_14px] text-inherit no-underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
    >
      {/* Amber icon tile */}
      <span
        aria-hidden="true"
        className="grid size-[30px] shrink-0 place-items-center rounded-lg bg-warning/[0.14] text-warning-foreground [&_svg]:size-[17px]"
      >
        <Icon name="check" />
      </span>

      {/* Count + label */}
      <div>
        <div className="tabular text-[21px] font-bold leading-none">{count}</div>
        <div className="mt-[2px] text-[12.5px] text-muted-foreground">
          Awaiting your approval
        </div>
      </div>

      {/* Primary "Review" CTA — visual only (parent link handles navigation) */}
      <span
        aria-hidden="true"
        className="ml-auto inline-flex h-8 items-center gap-[6px] rounded-lg bg-primary px-3 text-[13px] font-semibold text-primary-foreground shadow-[0_1px_2px_hsl(var(--primary)/0.25)] [&_svg]:size-[14px]"
      >
        Review
        <Icon name="chev" />
      </span>
    </Link>
  );
};

/**
 * ContractBook — B-MIN-3 fix.
 *
 * Two headline money tiles grouped under a "Contract book" overline.
 * Each has an explicit source micro-label so the asymmetry (revenue includes
 * closed-out work; contract value is active-only) is self-explanatory.
 *
 * Relabels "Total contract value" → "Active contract value" (Director-locked).
 */
const ContractBook: React.FC<{
  onHandValue: number;
  onHandMargin: number;
  activeContractValue: number;
  activeProjects: number;
}> = ({ onHandValue, onHandMargin, activeContractValue, activeProjects }) => {
  const marginPct = `${(onHandMargin * 100).toFixed(1)}%`;

  return (
    <div data-testid="mobile-contract-book" aria-label="Contract book">
      {/* Tile 1: Revenue on hand */}
      <div
        data-testid="mobile-kpi-on-hand"
        aria-label="Revenue on hand"
        className="rounded-lg border border-border bg-card p-[14px]"
      >
        <div className="flex items-center gap-[9px]">
          <span
            aria-hidden="true"
            style={{ color: 'hsl(var(--status-won-text))' }}
            className="grid size-[30px] shrink-0 place-items-center rounded-lg bg-success/[0.12] [&_svg]:size-4"
          >
            <Icon name="dollar" />
          </span>
          <span className="text-[12px] font-semibold text-muted-foreground">
            Revenue on hand
          </span>
        </div>
        <div className="tabular mt-[9px] text-[23px] font-bold leading-tight">
          {formatCurrency(onHandValue)}
        </div>
        <div className="mt-[5px] flex items-center gap-[5px] text-[11px] font-semibold text-muted-foreground">
          <span aria-hidden="true" className="size-[6px] shrink-0 rounded-full bg-muted-foreground" />
          Booked across active + closed-out contracts · {marginPct} margin realized
        </div>
      </div>

      {/* Tile 2: Active contract value (B-MIN-3 relabel) */}
      <div
        data-testid="mobile-kpi-active-contract-value"
        aria-label="Active contract value"
        className="mt-[10px] rounded-lg border border-border bg-card p-[14px]"
      >
        <div className="flex items-center gap-[9px]">
          <span
            aria-hidden="true"
            className="grid size-[30px] shrink-0 place-items-center rounded-lg bg-warning/[0.16] text-warning-foreground [&_svg]:size-4"
          >
            <Icon name="grid" />
          </span>
          <span className="text-[12px] font-semibold text-muted-foreground">
            Active contract value
          </span>
        </div>
        <div className="tabular mt-[9px] text-[23px] font-bold leading-tight">
          {formatCurrency(activeContractValue)}
        </div>
        <div className="mt-[5px] flex items-center gap-[5px] text-[11px] font-semibold text-muted-foreground">
          <span aria-hidden="true" className="size-[6px] shrink-0 rounded-full bg-muted-foreground" />
          Signed value of the {activeProjects} projects still in delivery
        </div>
      </div>
    </div>
  );
};

// ── Main component ────────────────────────────────────────────────────────────

/**
 * MobileExecutiveDashboard — the full mobile composition.
 *
 * Rendered only when useIsDesktop()=false (single-render seam per DESIGN.md §5).
 * Desktop layout is unaffected — the parent (ExecutiveDashboard) controls which
 * branch renders.
 */
export const MobileExecutiveDashboard: React.FC<MobileExecutiveDashboardProps> = ({
  data,
  approvalCount,
  belowFold,
}) => {
  const totalSpend = data.top_projects.reduce((s, p) => s + (p.spent || 0), 0);

  return (
    <div className="space-y-3">
      {/* Section 1: Needs attention — Projects at risk */}
      <section aria-label="Needs attention">
        <Overline className="mb-2">Needs attention</Overline>
        <AtRiskBlock
          atRisk={data.projects_at_risk}
          activeProjects={data.active_projects}
          totalSpend={totalSpend}
        />
      </section>

      {/* Section 2: Awaiting approval — primary action band */}
      <section aria-label="Approvals">
        <MobileApprovalsBand count={approvalCount} />
      </section>

      {/* Section 3: Contract book — B-MIN-3 grouped money pair */}
      <section aria-label="Contract book">
        <Overline className="mb-2">Contract book</Overline>
        <ContractBook
          onHandValue={data.on_hand_value}
          onHandMargin={data.on_hand_margin}
          activeContractValue={data.total_contract_value}
          activeProjects={data.active_projects}
        />
      </section>

      {/* Everything below the fold — charts, pipeline, etc. */}
      {belowFold}
    </div>
  );
};
