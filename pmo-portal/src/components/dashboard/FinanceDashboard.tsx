import React, { useMemo } from 'react';
import { useDashboard } from '@/src/hooks/useDashboard';
import { useProcurements } from '@/src/hooks/useProcurements';
import { KPITile } from '@/src/components/ui/KPITile';
import { Card, CardHead } from '@/src/components/ui/Card';
import { DataTable, type Column } from '@/src/components/ui/DataTable';
import { ProgressBar } from '@/src/components/ui/ProgressBar';
import { ListState } from '@/src/components/ui/ListState';
import { formatCurrency } from '@/src/lib/format';
import { StatusBarChart } from './StatusBarChart';
import { procurementStatusTone } from './procurementStatusTone';
import { DashPageHead, DashGrid } from './layout';
import type { TopProject } from '@/src/lib/db/dashboard';
import type { Tables } from '@/src/lib/supabase/database.types';

/** The procurement status meaning "billed, awaiting payment" (plan Open Q6). */
const INVOICED_STATUS: Tables<'procurements'>['status'] = 'Vendor Invoiced';

/**
 * Finance pane — real off the exec RPC (revenue / spend / margin / top-projects)
 * + `useProcurements` (outstanding invoices = Σ value of Vendor-Invoiced rows,
 * never a `* 0.4` fabrication). The legacy per-category cost donut is repurposed
 * to the real, status-toned Procurement-by-status chart (plan §4.2 / Open Q4).
 */
export const FinanceDashboard: React.FC = () => {
  const { data, isPending, isError, refetch } = useDashboard();
  const { data: procurements, isPending: procPending, isError: procError, refetch: refetchProc } = useProcurements();

  const totalSpend = useMemo(
    () => (data?.top_projects ?? []).reduce((s, p) => s + (p.spent || 0), 0),
    [data?.top_projects],
  );
  const outstanding = useMemo(
    () => (procurements ?? [])
      .filter((p) => p.status === INVOICED_STATUS)
      .reduce((s, p) => s + (p.total_value || 0), 0),
    [procurements],
  );
  const procByStatus = useMemo(() => {
    const counts = new Map<string, number>();
    for (const p of procurements ?? []) counts.set(p.status, (counts.get(p.status) ?? 0) + 1);
    return [...counts.entries()].map(([status, count]) => ({
      status: status as Tables<'procurements'>['status'],
      count,
    }));
  }, [procurements]);

  const topBySpend = useMemo(
    () => [...(data?.top_projects ?? [])].sort((a, b) => b.spent - a.spent),
    [data?.top_projects],
  );

  if (isError || (!data && !isPending)) {
    return (
      <div className="space-y-4">
        <DashPageHead title="Finance Dashboard" sub="Portfolio revenue, spend, margin, and budget utilization." />
        <ListState variant="error" title="Couldn't load the finance dashboard" onRetry={() => refetch()} />
      </div>
    );
  }

  const columns: Column<TopProject>[] = [
    { key: 'name', header: 'Project', cell: (p) => <span className="font-medium">{p.name}</span> },
    { key: 'budget', header: 'Budget', align: 'num', cell: (p) => formatCurrency(p.budget) },
    { key: 'spent', header: 'Spent', align: 'num', cell: (p) => formatCurrency(p.spent) },
    {
      key: 'util', header: 'Utilization', align: 'num',
      cell: (p) => (
        <ProgressBar value={p.budget > 0 ? Math.round((p.spent / p.budget) * 100) : 0} showValue compact
          aria-label={`${p.name} budget utilization`} />
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <DashPageHead title="Finance Dashboard" sub="Portfolio revenue, spend, margin, and budget utilization." />

      <section aria-label="Finance KPIs" className="grid grid-cols-1 gap-3 sm:grid-cols-2 min-[1180px]:grid-cols-4">
        <KPITile testId="kpi-revenue" tone="green" icon="dollar" label="Contracted revenue"
          value={formatCurrency(data?.total_contract_value ?? 0)} loading={isPending}
          help="Total contract value across active and closed-out projects." />
        <KPITile testId="kpi-spend" tone="red" icon="cart" label="Total project spend"
          value={formatCurrency(totalSpend)} loading={isPending}
          help="Sum of actual spend across the portfolio's top projects." />
        <KPITile testId="kpi-margin" tone="blue" icon="up" label="On-hand margin"
          value={`${((data?.on_hand_margin ?? 0) * 100).toFixed(1)}%`} loading={isPending}
          vs={`${formatCurrency(data?.on_hand_value ?? 0)} on hand`}
          help="Realized actual margin on active + closed-out contracts." />
        <KPITile testId="kpi-outstanding" tone="amber" icon="doc" label="Outstanding invoices"
          value={formatCurrency(outstanding)} loading={procPending}
          vs="vendor-invoiced, awaiting payment"
          help="Sum of procurement value in the Vendor Invoiced state." />
      </section>

      <DashGrid>
        <Card>
          <CardHead>Procurement by Status</CardHead>
          <div className="px-4 pb-4 pt-2">
            {procError ? (
              <ListState variant="error" title="Couldn't load procurement" onRetry={() => refetchProc()} />
            ) : procPending ? (
              <ListState variant="loading" rows={6} />
            ) : procByStatus.length === 0 ? (
              <ListState variant="empty" icon="cart" title="No procurement activity yet" />
            ) : (
              <StatusBarChart data={procByStatus} toneFor={procurementStatusTone}
                label="Procurement by status" noun="requests" />
            )}
          </div>
        </Card>

        <Card seam>
          <CardHead className="rounded-t-lg">Top Projects by Spend</CardHead>
          <DataTable
            rows={topBySpend}
            columns={columns}
            rowKey={(p) => p.id}
            state={isPending ? 'loading' : topBySpend.length === 0 ? 'empty' : undefined}
            emptyTitle="No project spend yet"
            className="rounded-t-none border-t-0"
          />
        </Card>
      </DashGrid>
    </div>
  );
};
