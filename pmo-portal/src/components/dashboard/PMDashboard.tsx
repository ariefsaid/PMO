import React, { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/src/auth/useAuth';
import { useProjects } from '@/src/hooks/useProjects';
import { useTimesheetsAwaitingApproval } from '@/src/hooks/useTimesheetApproval';
import { KPITile } from '@/src/components/ui/KPITile';
import { Card, CardHead } from '@/src/components/ui/Card';
import { StatusPill, type StatusVariant } from '@/src/components/ui/StatusPill';
import { ListState } from '@/src/components/ui/ListState';
import { formatCurrency } from '@/src/lib/format';
import { BvACard } from './BvACard';
import { DashPageHead, DashGrid } from './layout';
import type { TopProject } from '@/src/lib/db/dashboard';

const AT_RISK_THRESHOLD = 0.9;

function statusVariant(status: string): StatusVariant {
  if (status === 'Ongoing Project' || status === 'Internal Project') return 'open';
  if (status.startsWith('Won')) return 'won';
  if (status.startsWith('Loss')) return 'lost';
  if (status === 'On Hold') return 'warn';
  return 'neutral';
}

/**
 * Project-Manager pane — real off `useProjects` (filtered to my projects) +
 * `useTimesheetsAwaitingApproval`. The procurement-approvals half has no per-PM
 * query, so it is an honest coming-soon placeholder, never summed with the real
 * timesheet count (plan §4.1, Open Q5).
 */
export const PMDashboard: React.FC = () => {
  const navigate = useNavigate();
  const { currentUser } = useAuth();
  const { data: projects, isPending, isError, refetch } = useProjects();
  const { data: awaiting } = useTimesheetsAwaitingApproval();

  const mine = useMemo(
    () => (projects ?? []).filter((p) => p.project_manager_id === currentUser?.id),
    [projects, currentUser?.id],
  );
  const contractValue = useMemo(() => mine.reduce((s, p) => s + (p.contract_value || 0), 0), [mine]);
  const atRisk = useMemo(
    () => mine.filter((p) => p.budget > 0 && p.spent / p.budget >= AT_RISK_THRESHOLD).length,
    [mine],
  );
  const awaitingCount = awaiting?.length ?? 0;

  const bvaProjects: TopProject[] = mine.map((p) => ({
    id: p.id, name: p.name, client_name: p.client?.name ?? null,
    contract_value: p.contract_value, budget: p.budget, spent: p.spent, status: p.status,
  }));

  return (
    <div className="space-y-4">
      <DashPageHead title="My Dashboard" sub="Your projects, budget health, and approvals queue." />

      <section aria-label="My KPIs" className="grid grid-cols-1 gap-3 min-[560px]:grid-cols-2 min-[1180px]:grid-cols-4">
        <KPITile testId="kpi-my-projects" tone="cyan" icon="folder" label="My projects"
          value={String(mine.length)} loading={isPending}
          help="Projects where you are the assigned project manager." />
        <KPITile testId="kpi-my-contract-value" tone="green" icon="dollar" label="My contract value"
          value={formatCurrency(contractValue)} loading={isPending}
          help="Total contract value across your projects." />
        <KPITile testId="kpi-at-risk" tone="amber" icon="alert" label="At risk"
          value={String(atRisk)} loading={isPending} vs="budget usage > 90%"
          help="Your projects whose actual spend exceeds 90% of budget." />
        <KPITile testId="kpi-timesheets-awaiting" tone="violet" icon="clock" label="Timesheets awaiting"
          value={String(awaitingCount)} vs="submitted, pending your review"
          help="Submitted timesheets awaiting your approval. Procurement approvals are a deferred follow-up." />
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
            {mine.length === 0 ? (
              <ListState variant="empty" icon="folder" title="Nothing to show yet" />
            ) : (
              <ul className="divide-y divide-border/70">
                {mine.map((p) => {
                  // Only show a margin figure for in-delivery projects that have real spend.
                  // Zero-spend (Tender/Loss rows) would produce (contract - 0)/contract = 100%
                  // which is misleading — show "—" instead (I2 fix).
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
                  return (
                    <li key={p.id} className="flex items-center gap-2.5 py-3">
                      <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{p.name}</span>
                      <StatusPill variant={statusVariant(p.status)}>{p.status}</StatusPill>
                      <span className={`w-16 text-right text-[13px] font-bold tabular ${marginClass}`}>
                        {margin !== null ? `${margin.toFixed(1)}%` : '—'}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </Card>
      </DashGrid>

      <Card>
        <CardHead>Procurement approvals</CardHead>
        <ListState
          variant="empty"
          icon="cart"
          title="Procurement approvals — coming soon"
          sub="A per-PM procurement approvals queue needs a new backend slice; tracked as a follow-up."
          action={{ label: 'Open Approvals', onClick: () => navigate('/approvals') }}
        />
      </Card>
    </div>
  );
};
