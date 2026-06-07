import React, { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardHead, CardPad, ProgressBar, StatusPill, ListState, HoursBar } from '@/src/components/ui';
import { formatCurrency } from '@/src/lib/format';
import type { ProjectWithRefs } from '@/src/lib/db/projects';
import { useProcurements } from '@/src/hooks/useProcurements';
import { useBudgetVersions } from '@/src/hooks/useBudget';
import { summarizeProcurement, recentRequests } from '@/src/lib/procurement-summary';
import { activeSnapshot } from '@/src/lib/budget-snapshot';
import { pillVariantForStatus, stageLabelForStatus, openPR } from '../../../components/procurement';

export interface OverviewTabProps {
  project: ProjectWithRefs;
  /** Callback to switch to a sibling tab (budget / procurement). */
  setTab?: (tab: 'overview' | 'budget' | 'procurement' | 'tasks' | 'documents') => void;
}

function fmtDate(iso: string | null): string {
  return iso ? new Date(iso).toLocaleDateString() : 'Not set';
}

const InfoRow: React.FC<{ label: string; value: React.ReactNode }> = ({ label, value }) => (
  <div className="flex flex-col gap-0.5">
    <dt className="text-[12px] text-muted-foreground">{label}</dt>
    <dd className="text-sm font-medium">{value}</dd>
  </div>
);

/**
 * Phase 5 (T14-T18): densified Overview tab.
 * Row 1: Project information (unchanged) + Budget utilization (unchanged).
 * Row 2 (NEW): Procurement summary card + Budget snapshot card.
 * Both new cards use real data only — no fabricated content (plan §1).
 * setTab prop enables footer links to switch tabs without router navigation.
 */
const OverviewTab: React.FC<OverviewTabProps> = ({ project, setTab }) => {
  const navigate = useNavigate();
  const contract = project.contract_value ?? 0;
  const spent = project.spent ?? 0;
  const spendPct = contract > 0 ? Math.round((spent / contract) * 100) : 0;

  // T14/T15 — Procurement summary (client-side filter by project_id)
  const { data: allProc, isPending: procPending, isError: procError, refetch: procRefetch } = useProcurements();
  const projectProc = useMemo(
    () => (allProc ?? []).filter((p) => p.project_id === project.id),
    [allProc, project.id],
  );
  const procSummary = useMemo(() => summarizeProcurement(projectProc), [projectProc]);
  const top3Proc = useMemo(() => recentRequests(projectProc, 3), [projectProc]);

  // T16/T17 — Budget snapshot
  const { data: budgetVersions, isPending: budgetPending, isError: budgetError, refetch: budgetRefetch } = useBudgetVersions(project.id);
  const snapshot = useMemo(
    () => activeSnapshot(budgetVersions ?? [], spent),
    [budgetVersions, spent],
  );

  return (
    <div className="space-y-4">
      {/* Row 1 (unchanged) */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHead>Project information</CardHead>
          <CardPad>
            <dl className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
              <InfoRow label="Customer" value={project.client?.name ?? 'Not set'} />
              <InfoRow label="Project manager" value={project.pm?.full_name ?? 'Unassigned'} />
              <InfoRow label="Start date" value={fmtDate(project.start_date)} />
              <InfoRow label="End date" value={fmtDate(project.end_date)} />
              <InfoRow
                label="Project code"
                value={
                  project.code ? (
                    <span className="font-mono text-[13px]">{project.code}</span>
                  ) : (
                    'Not set'
                  )
                }
              />
              <InfoRow
                label="Customer PO ref"
                value={
                  project.customer_contract_ref ? (
                    <span className="font-mono text-[13px]">{project.customer_contract_ref}</span>
                  ) : (
                    'Not set'
                  )
                }
              />
            </dl>
          </CardPad>
        </Card>

        <Card>
          <CardHead>Budget utilization</CardHead>
          <CardPad className="flex flex-col gap-3">
            <div className="text-[12px] text-muted-foreground">
              <span className="font-semibold tabular text-foreground">{formatCurrency(spent)}</span> of{' '}
              <span className="font-semibold tabular text-foreground">{formatCurrency(contract)}</span>{' '}
              contract spent
            </div>
            <ProgressBar
              value={spendPct}
              showValue
              aria-label={`Spend: ${spendPct}% of contract`}
            />
          </CardPad>
        </Card>
      </div>

      {/* T18: Row 2 — Procurement summary + Budget snapshot */}
      <div data-testid="overview-row2" className="grid gap-4 lg:grid-cols-2">
        {/* T14/T15 — Procurement summary card */}
        <Card>
          <CardHead>Procurement summary</CardHead>
          {procPending ? (
            <ListState variant="loading" rows={3} />
          ) : procError ? (
            <ListState
              variant="error"
              title="Couldn't load procurement"
              onRetry={() => procRefetch()}
            />
          ) : projectProc.length === 0 ? (
            <ListState
              variant="empty"
              icon="inbox"
              title="No purchase requests for this project yet"
              sub="Requests raised against this project will appear here."
            />
          ) : (
            <CardPad className="flex flex-col gap-4">
              {/* Count strip — 3 plain buckets (not 6 same-hue dots) */}
              <div className="flex gap-3 flex-wrap">
                <div className="flex items-center gap-1.5">
                  <StatusPill variant="open">{procSummary.open} Open</StatusPill>
                </div>
                <div className="flex items-center gap-1.5">
                  <StatusPill variant="won">{procSummary.completed} Completed</StatusPill>
                </div>
                <div className="flex items-center gap-1.5">
                  <StatusPill variant="neutral">{procSummary.closed} Closed</StatusPill>
                </div>
              </div>

              {/* Committed total */}
              <div className="text-[12px] text-muted-foreground">
                <span className="font-semibold tabular text-foreground text-[14px]">
                  {formatCurrency(procSummary.committedTotal)}
                </span>{' '}
                committed across {procSummary.count} {procSummary.count === 1 ? 'request' : 'requests'}
              </div>

              {/* Top 3 recent requests */}
              {top3Proc.length > 0 && (
                <ul className="divide-y divide-border/70 -mx-4">
                  {top3Proc.map((pr) => (
                    <li key={pr.id}>
                      <button
                        type="button"
                        onClick={() => openPR(navigate, pr)}
                        className="w-full flex items-center gap-3 px-4 py-[9px] text-left hover:bg-accent/60 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex items-baseline gap-1.5 min-w-0">
                            <span className="truncate text-[13px] font-semibold">{pr.title}</span>
                            {pr.code && (
                              <span className="shrink-0 font-mono text-[11px] text-muted-foreground">{pr.code}</span>
                            )}
                          </div>
                          <div className="mt-0.5">
                            <StatusPill variant={pillVariantForStatus(pr.status as Parameters<typeof pillVariantForStatus>[0])}>
                              {stageLabelForStatus(pr.status as Parameters<typeof stageLabelForStatus>[0])}
                            </StatusPill>
                          </div>
                        </div>
                        <span className="shrink-0 text-[13px] font-semibold tabular text-foreground">
                          {formatCurrency(Number(pr.total_value))}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}

              {/* Footer link */}
              {setTab && (
                <button
                  type="button"
                  onClick={() => setTab('procurement')}
                  className="text-[12px] font-semibold text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring self-start"
                >
                  View all procurement
                </button>
              )}
            </CardPad>
          )}
        </Card>

        {/* T16/T17 — Budget snapshot card */}
        <Card>
          <CardHead>Budget snapshot</CardHead>
          {budgetPending ? (
            <ListState variant="loading" rows={3} />
          ) : budgetError ? (
            <ListState
              variant="error"
              title="Couldn't load budget"
              onRetry={() => budgetRefetch()}
            />
          ) : !snapshot ? (
            <ListState
              variant="empty"
              icon="inbox"
              title="No active budget"
              sub="Activate a budget version on the Budget tab to see a snapshot here."
            />
          ) : (
            <CardPad className="flex flex-col gap-3">
              {/* Budget totals */}
              <dl className="grid grid-cols-2 gap-x-4 gap-y-2">
                <div>
                  <dt className="text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">Active budget</dt>
                  <dd className="mt-0.5 text-[15px] font-bold tabular">{formatCurrency(snapshot.activeTotal)}</dd>
                </div>
                <div>
                  <dt className="text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">Actual spent</dt>
                  <dd className="mt-0.5 text-[15px] font-bold tabular">{formatCurrency(snapshot.spent)}</dd>
                </div>
                <div className="col-span-2">
                  <dt className="text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">Variance</dt>
                  <dd
                    data-testid="budget-variance"
                    className="mt-0.5 text-[15px] font-bold tabular"
                    style={snapshot.variance < 0 ? { color: 'hsl(var(--destructive))' } : undefined}
                  >
                    {snapshot.variance < 0 ? '' : '+'}{formatCurrency(snapshot.variance)}
                  </dd>
                </div>
              </dl>

              {/* Category breakdown bars */}
              {snapshot.byCategory.length > 0 && (
                <div role="group" aria-label="Budget by category" className="flex flex-col gap-0.5 pt-1">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground mb-1">
                    By category
                  </div>
                  {snapshot.byCategory.map((cat) => (
                    <HoursBar
                      key={cat.category}
                      label={cat.category}
                      code={null}
                      hours={cat.amount}
                      maxHours={snapshot.activeTotal}
                    />
                  ))}
                </div>
              )}

              {/* Footer link */}
              {setTab && (
                <button
                  type="button"
                  onClick={() => setTab('budget')}
                  className="text-[12px] font-semibold text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring self-start"
                >
                  Open Budget tab
                </button>
              )}
            </CardPad>
          )}
        </Card>
      </div>
    </div>
  );
};

export default OverviewTab;
