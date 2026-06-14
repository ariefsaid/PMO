import React from 'react';
import { Link } from 'react-router-dom';
import { formatCurrency } from '@/src/lib/format';
import { ProgressBar } from '@/src/components/ui/ProgressBar';
import { StatusPill } from '@/src/components/ui/StatusPill';
import { Icon } from '@/src/components/ui/icons';
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
          <div className="flex items-center gap-2.5">
            <span
              aria-hidden="true"
              className="size-1.5 shrink-0 rounded-full"
              style={{ background: dot }}
            />
            <Link
              to={`/projects/${p.id}`}
              className="text-[13px] font-semibold hover:text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring"
            >
              {p.name}
            </Link>
            {atRisk && <StatusPill variant="warn">At risk</StatusPill>}
            <span className="ml-auto text-[12px] tabular text-muted-foreground">
              {formatCurrency(p.spent)} / {formatCurrency(contract)}
            </span>
            {/* M5: exception rows (at-risk) get a resting trailing chevron so the row reads as
                openable at rest — scoped to exception rows only, not plain BvA rows. The Link
                above is the sole interactive; this icon is decorative (aria-hidden via Icon default). */}
            {atRisk && (
              <Icon
                name="chev"
                data-testid="bva-row-open-chevron"
                className="size-4 shrink-0 text-muted-foreground"
              />
            )}
          </div>
          <ProgressBar
            value={pct}
            className="min-w-0 [&>span:first-child]:flex-1"
            aria-label={`${p.name}: ${pct}% of contract`}
          />
        </div>
      );
    })}
  </div>
);
