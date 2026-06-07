import React, { useMemo } from 'react';
import {
  DataTable,
  ListState,
  StatusPill,
  LifecycleStepper,
  type Column,
} from '@/src/components/ui';
import { useNavigate } from 'react-router-dom';
import { useProcurements } from '@/src/hooks/useProcurements';
import { formatCurrency } from '@/src/lib/format';
import type { ProcurementWithRefs } from '@/src/lib/db/procurements';
import type { ProcurementStatus } from '@/src/lib/db/procurementLifecycle';
import {
  lifecycleSteps,
  pillVariantForStatus,
  stageLabelForStatus,
  openPR,
} from '../../../components/procurement';

export interface ProcurementTabProps {
  projectId: string;
}

/**
 * REAL, project-scoped procurement (OQ-5). Filters the cached org-wide
 * `useProcurements()` list client-side by `project_id` — the documented
 * "page filters cached list client-side" pattern; no new DAL, RLS already
 * scopes the org. No drawer, no pie chart, no advisory card. Rows reuse the
 * Procurement surface's row (title + mono PR-id · value · inline lifecycle pips
 * · StatusPill) and drill to `/procurement/:id`. ProcurementStatusBadge retired
 * → StatusPill.
 */
const ProcurementTab: React.FC<ProcurementTabProps> = ({ projectId }) => {
  const navigate = useNavigate();
  const { data, isPending, isError, refetch } = useProcurements();

  const rows = useMemo(
    () =>
      (data ?? [])
        .filter((p) => p.project_id === projectId)
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()),
    [data, projectId],
  );

  const columns: Column<ProcurementWithRefs>[] = [
    {
      key: 'request',
      header: 'Request',
      cell: (r) => (
        <div className="min-w-0">
          <div className="truncate font-semibold" title={r.title}>
            {r.title}
          </div>
          <div className="truncate font-mono text-[11px] text-muted-foreground">
            {r.code ?? r.id.slice(0, 8)}
          </div>
        </div>
      ),
    },
    {
      key: 'value',
      header: 'Value',
      align: 'num',
      cell: (r) => formatCurrency(r.total_value),
    },
    {
      key: 'lifecycle',
      header: 'Lifecycle',
      cell: (r) => (
        <LifecycleStepper
          variant="inline"
          steps={lifecycleSteps(r.status as ProcurementStatus)}
          aria-label={`Lifecycle: ${stageLabelForStatus(r.status as ProcurementStatus)}`}
        />
      ),
    },
    {
      key: 'status',
      header: 'Status',
      cell: (r) => (
        <StatusPill variant={pillVariantForStatus(r.status as ProcurementStatus)}>
          {stageLabelForStatus(r.status as ProcurementStatus)}
        </StatusPill>
      ),
    },
  ];

  if (isPending) {
    return (
      <div className="rounded-lg border border-border bg-card">
        <ListState variant="loading" rows={5} />
      </div>
    );
  }

  if (isError || !data) {
    return (
      <ListState
        variant="error"
        title="Couldn't load procurement"
        sub="Something went wrong fetching this project's purchase requests."
        onRetry={() => refetch()}
      />
    );
  }

  return (
    <DataTable<ProcurementWithRefs>
      rows={rows}
      columns={columns}
      rowKey={(r) => r.id}
      onActivate={(r) => openPR(navigate, r)}
      state={rows.length === 0 ? 'empty' : undefined}
      emptyTitle="No purchase requests for this project yet"
      emptySub="Requests raised against this project will appear here through their lifecycle."
    />
  );
};

export default ProcurementTab;
