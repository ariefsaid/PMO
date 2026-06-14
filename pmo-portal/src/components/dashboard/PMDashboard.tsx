import React, { useMemo } from 'react';
import { useAuth } from '@/src/auth/useAuth';
import { useProjects } from '@/src/hooks/useProjects';
import { useProjectsDelivery } from '@/src/hooks/useProjectsDelivery';
import { DeliveryPctChip } from '@/components/DeliveryPctChip';
import { KPITile } from '@/src/components/ui/KPITile';
import { AwaitingApprovalTile } from './AwaitingApprovalTile';
import { Card, CardHead } from '@/src/components/ui/Card';
import { StatusPill } from '@/src/components/ui/StatusPill';
import { ListState } from '@/src/components/ui/ListState';
import { formatCurrency } from '@/src/lib/format';
import { BvACard } from './BvACard';
import { DashPageHead, DashGrid } from './layout';
import type { TopProject } from '@/src/lib/db/dashboard';
import { isAtRisk } from '@/src/lib/dashboardConstants';
import { pillVariantForProjectStatus } from '@/components/projects';

// Project-status pill comes from the canonical project-status map
// (`pillVariantForProjectStatus`), which routes through the single status registry's
// Freed-Blue Status Rule: on-hand execution ("Ongoing Project") is neutral grey
// `progress` — NOT the action-blue (the distinct LABEL carries identity).

/**
 * Project-Manager pane — real off `useProjects` (filtered to my projects). The
 * approvals KPI is now the real combined `AwaitingApprovalTile` (PRs a PM can
 * approve + timesheets awaiting), routing to the unified `/approvals` inbox — the
 * prior fake procurement-approvals placeholder is gone (Wave-5 N15).
 */
export const PMDashboard: React.FC = () => {
  const { currentUser } = useAuth();
  const { data: projects, isPending, isError, refetch } = useProjects();

  const mine = useMemo(
    () => (projects ?? []).filter((p) => p.project_manager_id === currentUser?.id),
    [projects, currentUser?.id],
  );
  const contractValue = useMemo(() => mine.reduce((s, p) => s + (p.contract_value || 0), 0), [mine]);
  const atRiskCount = useMemo(() => mine.filter(isAtRisk).length, [mine]);

  // AC-IXD-DASH-W5-C2C N18: sort at-risk projects first (stable secondary order).
  const mineSorted = useMemo(
    () => [...mine].sort((a, b) => (isAtRisk(a) ? 0 : 1) - (isAtRisk(b) ? 0 : 1)),
    [mine],
  );

  // FR-DEL-017: one batched delivery-% call for all PM projects (NFR-DEL-PERF-001).
  const { data: delivery } = useProjectsDelivery(mine.map((p) => p.id));

  const bvaProjects: TopProject[] = mine.map((p) => ({
    id: p.id, name: p.name, client_name: p.client?.name ?? null,
    contract_value: p.contract_value, budget: p.budget, spent: p.spent, status: p.status,
  }));

  return (
    <div className="space-y-4">
      <DashPageHead title="My Dashboard" sub="Your projects, budget health, and approvals queue." />

      <section aria-label="My KPIs" className="grid grid-cols-1 gap-3 min-[560px]:grid-cols-2 min-[1180px]:grid-cols-4">
        {/* AC-IXD-DASH-W5-C2A: My projects → /projects?filter=My+Projects */}
        <KPITile testId="kpi-my-projects" tone="violet" icon="folder" label="My projects"
          value={String(mine.length)} loading={isPending} error={isError}
          to="/projects?filter=My+Projects"
          linkLabel="Open my projects"
          help="Projects where you are the assigned project manager." />
        {/* AC-IXD-DASH-W5-C2A: My contract value → /projects?filter=My+Projects */}
        <KPITile testId="kpi-my-contract-value" tone="green" icon="dollar" label="My contract value"
          value={formatCurrency(contractValue)} loading={isPending} error={isError}
          to="/projects?filter=My+Projects"
          linkLabel="Open my projects to see contract value"
          help="Total contract value across your projects." />
        {/* AC-IXD-DASH-W5-C2A: At risk → /projects?filter=at-risk */}
        <KPITile testId="kpi-at-risk" tone="amber" icon="alert" label="At risk"
          value={String(atRiskCount)} loading={isPending} error={isError} vs="budget usage > 90%"
          to="/projects?filter=at-risk"
          linkLabel="Open my at-risk projects"
          help="Your projects whose actual spend exceeds 90% of budget." />
        {/* N15: real combined approvals shortcut (PRs you can approve + timesheets) → /approvals. */}
        <AwaitingApprovalTile includeTimesheets />
      </section>

      <DashGrid>
        <Card>
          <CardHead>Budget vs Actual — My Projects</CardHead>
          <div className="px-4 pb-3.5">
            {isError ? (
              <ListState variant="error" title="Couldn't load your projects" onRetry={() => refetch()} />
            ) : isPending ? (
              <ListState variant="loading" />
            ) : mine.length === 0 ? (
              <ListState variant="empty" icon="folder" title="No projects assigned to you yet"
                sub="Projects you manage will appear here." />
            ) : (
              <BvACard projects={bvaProjects} />
            )}
          </div>
        </Card>

        <Card>
          <CardHead>Project Status</CardHead>
          <div className="px-4 pb-3.5">
            {isPending ? (
              <ListState variant="loading" />
            ) : isError ? (
              <ListState variant="error" title="Couldn't load your projects" onRetry={() => refetch()} />
            ) : mine.length === 0 ? (
              <ListState variant="empty" icon="folder" title="Nothing to show yet" />
            ) : (
              <ul className="divide-y divide-border/70">
                {mineSorted.map((p) => {
                  // Only show a margin figure for in-delivery projects that have real spend.
                  // Zero-spend (Tender/Loss rows) would produce (contract - 0)/contract = 100%
                  // which is misleading — show the muted "Not set" instead (I2 fix; G3
                  // replaces the bare em-dash with concrete copy).
                  const isActive = p.status === 'Ongoing Project' || p.status === 'Internal Project';
                  const hasSpend = p.spent > 0 && p.contract_value > 0;
                  const margin = isActive && hasSpend
                    ? ((p.contract_value - p.spent) / p.contract_value) * 100
                    : null;
                  const marginClass =
                    margin === null
                      ? 'text-muted-foreground'
                      : margin < 10
                        ? 'text-destructive'
                        : 'text-foreground';
                  const projectAtRisk = isAtRisk(p);
                  return (
                    <li key={p.id} className="flex items-center gap-2.5 py-3">
                      <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{p.name}</span>
                      {/* AC-IXD-DASH-W5-C2C N18: text+dot pill on at-risk rows (not color-only). */}
                      {projectAtRisk && <StatusPill variant="warn">At risk</StatusPill>}
                      {/* FR-DEL-017: delivery-% chip (absent when project has no milestones). */}
                      <DeliveryPctChip pct={delivery?.[p.id] ?? null} />
                      <StatusPill variant={pillVariantForProjectStatus(p.status)}>{p.status}</StatusPill>
                      <span
                        className={`w-16 shrink-0 text-right text-[13px] font-bold ${margin !== null ? 'tabular' : ''} ${marginClass}`}
                      >
                        {margin !== null ? `${margin.toFixed(1)}%` : 'Not set'}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </Card>
      </DashGrid>

    </div>
  );
};
