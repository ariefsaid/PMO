import React from 'react';
import { Link } from 'react-router-dom';
import { formatCurrency } from '@/src/lib/format';
import { ProgressBar } from '@/src/components/ui/ProgressBar';
import { StatusPill } from '@/src/components/ui/StatusPill';
import { chartTheme } from '@/src/components/ui/chartTheme';
import type { TopProject } from '@/src/lib/db/dashboard';
import { AT_RISK_THRESHOLD } from '@/src/lib/dashboardConstants';

export interface BvACardProps {
  projects: TopProject[];
}

/**
 * Budget vs Actual — per-project spend against contract value, the on-brand
 * table-alternative for the portfolio bar chart (text + bars, screen-reader
 * friendly by construction). Each row direct-labels its money and exposes a
 * per-bar `{name}: {pct}% of contract` aria label so no datum is hover-gated.
 *
 * No committed bar: `top_projects` exposes `spent`, not `committed`; a portfolio
 * committed aggregate is a deferred backend slice (plan Open Q1), so we render
 * the real Actual/Contract bar only — never a fabricated committed value.
 */
export const BvACard: React.FC<BvACardProps> = ({ projects }) => (
  <div role="group" aria-label="Budget vs actual by project" className="flex flex-col">
    {projects.map((p, i) => {
      const contract = p.contract_value || 0;
      const pct = contract > 0 ? Math.round((p.spent / contract) * 100) : 0;
      const utilization = p.budget > 0 ? p.spent / p.budget : 0;
      const atRisk = utilization >= AT_RISK_THRESHOLD;
      const dot = chartTheme.categorical[i % chartTheme.categorical.length];

      return (
        <div
          key={p.id}
          data-row
          className="flex flex-col gap-2 border-b border-border/70 py-3 last:border-b-0"
        >
          {/* flex-wrap: at 390px the name + money values wrap to a second line (C-Mobile). */}
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
            <span
              aria-hidden="true"
              className="size-1.5 shrink-0 rounded-full"
              style={{ background: dot }}
            />
            <Link
              to={`/projects/${p.id}`}
              className="min-w-0 truncate text-[13px] font-semibold hover:text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring"
            >
              {p.name}
            </Link>
            {atRisk && <StatusPill variant="warn">At risk</StatusPill>}
            <span className="ml-auto shrink-0 text-[12px] tabular text-muted-foreground">
              {formatCurrency(p.spent)} / {formatCurrency(contract)}
            </span>
            {/* D-2 (AC-JR-W3B-04): decorative trailing chevron removed — it was a false
                affordance implying the row is clickable while only the name Link above is
                interactive. The "At risk" StatusPill above is the exception badge; the name
                Link is the affordance. No chevron needed. */}
          </div>
          {/* widthless: no outer min-w so the bar fills the flex row at any viewport width.
              [&>span:first-child]:flex-1 ensures the track expands in the flex container. */}
          <ProgressBar
            value={pct}
            widthless
            className="w-full [&>span:first-child]:flex-1"
            aria-label={`${p.name}: ${pct}% of contract`}
          />
        </div>
      );
    })}
  </div>
);
