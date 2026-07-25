import React, { useMemo } from 'react';
import {
  ListPage,
  ListState,
  DataTable,
  StatusPill,
  Card,
  KPITile,
  Button,
  Icon,
  type Column,
} from '@/src/components/ui';
import { useNavigate } from 'react-router-dom';
import { usePermission } from '@/src/auth/usePermission';
import { useRevenuePerProject } from '@/src/hooks/useRevenue';

const RevenueByProject: React.FC = () => {
  const may = usePermission();
  const navigate = useNavigate();
  const { data, isPending, isError } = useRevenuePerProject();
  const all = useMemo(() => data ?? [], [data]);

  // Calculate totals (must be before any early return for hooks rules)
  const totalRevenue = useMemo(
    () => all.reduce((sum, row) => sum + row.total_amount, 0),
    [all]
  );
  const totalOpenAR = useMemo(
    () => all.reduce((sum, row) => sum + row.open_ar, 0),
    [all]
  );
  const totalInvoices = useMemo(
    () => all.reduce((sum, row) => sum + row.invoice_count, 0),
    [all]
  );

  const canView = may('view', 'project');

  const state: 'loading' | 'empty' | 'error' | undefined = isPending
    ? 'loading'
    : isError
      ? 'error'
      : all.length === 0
        ? 'empty'
        : undefined;

  if (!canView) {
    return (
      <div className="flex h-[calc(100vh-var(--header-h))] items-center justify-center px-4">
        <div className="text-center">
          <h2 className="text-heading font-semibold">You don't have access to Revenue by Project</h2>
          <p className="mt-2 text-muted-foreground">
            The revenue per project view is available to Finance, Project Managers, and Executives.
          </p>
          <Button variant="outline" onClick={() => navigate('/')} className="mt-4">
            <Icon name="back" className="size-4 mr-2" />
            Back to dashboard
          </Button>
        </div>
      </div>
    );
  }

  const columns: Column<
    { project_id: string | null; project_name: string | null; total_amount: number; open_ar: number; invoice_count: number }
  >[] = [
    {
      key: 'project_name',
      header: 'Project',
      cell: (row) => (
        <div className="flex flex-col gap-0.5">
          {row.project_name ? (
            <>
              <span className="font-semibold">{row.project_name}</span>
              <span className="text-xs text-muted-foreground font-mono">
                {row.invoice_count} invoice{row.invoice_count !== 1 ? 's' : ''}
              </span>
            </>
          ) : (
            <StatusPill variant="neutral">Unassigned</StatusPill>
          )}
        </div>
      ),
      exportValue: (row) => row.project_name ?? 'Unassigned',
    },
    {
      key: 'total_amount',
      header: 'Total Revenue',
      align: 'num',
      cell: (row) => (
        <span className="tabular text-right font-mono text-[13px]">
          ${row.total_amount.toLocaleString(undefined, { minimumFractionDigits: 2 })}
        </span>
      ),
      exportValue: (row) => row.total_amount.toString(),
    },
    {
      key: 'open_ar',
      header: 'Open AR',
      align: 'num',
      cell: (row) => (
        <span className="tabular text-right font-mono text-[13px]">
          ${row.open_ar.toLocaleString(undefined, { minimumFractionDigits: 2 })}
        </span>
      ),
      exportValue: (row) => row.open_ar.toString(),
    },
    {
      key: 'invoice_count',
      header: 'Invoices',
      align: 'num',
      cell: (row) => (
        <span className="tabular text-right font-mono text-[13px]">
          {row.invoice_count}
        </span>
      ),
      exportValue: (row) => row.invoice_count.toString(),
    },
  ];

  return (
    <ListPage
      title="Revenue by Project"
      description="Revenue rollup per project. Includes an 'Unassigned' bucket for invoices without a project (when process_gates.require_project_on_si is OFF)."
      primaryAction={
        <Button variant="outline" onClick={() => navigate('/projects')}>
          <Icon name="pipe" className="size-4 mr-2" />
          Browse Projects
        </Button>
      }
    >
      {/* KPI Summary — honest states only (BLOCK 2 / the AccountingSnapshotsSection rule): while the
          rollup is loading the tiles are skeletons, and on a failed query they show "—", NEVER a
          fabricated $0 that reads as a real figure for an org that may bill millions. */}
      <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-4 mb-6">
        <KPITile
          label="Total Revenue"
          value={`$${totalRevenue.toLocaleString(undefined, { minimumFractionDigits: 0 })}`}
          icon="dollar"
          tone="blue"
          loading={isPending}
          error={isError}
        />
        <KPITile
          label="Open AR"
          value={`$${totalOpenAR.toLocaleString(undefined, { minimumFractionDigits: 0 })}`}
          icon="dollar"
          tone="amber"
          loading={isPending}
          error={isError}
        />
        <KPITile
          label="Total Invoices"
          value={totalInvoices.toLocaleString()}
          icon="file"
          tone="violet"
          loading={isPending}
          error={isError}
        />
        <KPITile
          label="Projects"
          value={all.filter((r) => r.project_id).length.toLocaleString()}
          icon="pipe"
          tone="green"
          loading={isPending}
          error={isError}
        />
      </div>

      {/* Body */}
      {state === 'loading' && (
        <div className="rounded-lg border border-border bg-card">
          <ListState variant="loading" rows={6} />
        </div>
      )}

      {state === 'error' && (
        <ListState
          variant="error"
          title="Couldn't load revenue data"
          sub="The request failed. Check your connection and try again."
        />
      )}

      {state === 'empty' && (
        <ListState
          variant="empty"
          icon="table"
          title="No revenue data yet"
          sub="Create sales invoices to see revenue per project."
        />
      )}

      {state === undefined && (
        <Card className="overflow-hidden">
          <DataTable
            rows={all}
            columns={columns}
            rowKey={(row) => row.project_id ?? 'unassigned'}
            onActivate={(row) => {
              if (row.project_id) navigate(`/projects/${row.project_id}`);
            }}
            rowLabel={(row) => `Open ${row.project_name ?? 'Unassigned'}`}
            state={all.length === 0 ? 'empty' : undefined}
            emptyTitle="No revenue data"
            emptySub="Invoices with amounts will appear here."
          />
        </Card>
      )}
    </ListPage>
  );
};

export default RevenueByProject;