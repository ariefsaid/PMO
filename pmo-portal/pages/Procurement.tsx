import React, { useMemo, useState } from 'react';
import {
  Toolbar,
  SearchMini,
  ViewToggle,
  ListState,
  DataTable,
  StatusPill,
  LifecycleStepper,
  type Column,
} from '@/src/components/ui';
import { useEffectiveRole } from '@/src/auth/impersonation';
import { useProcurements } from '@/src/hooks/useProcurements';
import { useWorkspaceTabs } from '@/src/components/shell';
import { formatCurrency } from '@/src/lib/format';
import type { ProcurementWithRefs } from '@/src/lib/db/procurements';
import type { ProcurementStatus } from '@/src/lib/db/procurementLifecycle';
import ProcurementBoard from '../components/ProcurementBoard';
import { useProcurementView } from '@/src/hooks/useProcurementView';
import { lifecycleSteps, pillVariantForStatus, stageLabelForStatus, openPR } from '../components/procurement';

/** Status filter segments (the IA-3 stage SegFilter; "All" + the three reporting buckets). */
type StatusFilter = 'All' | 'Open' | 'Ordered' | 'Paid';
const FILTERS: StatusFilter[] = ['All', 'Open', 'Ordered', 'Paid'];

const OPEN_STATUSES = new Set<string>([
  'Draft',
  'Requested',
  'Approved',
  'Vendor Quoted',
  'Quote Selected',
]);
const ORDERED_STATUSES = new Set<string>(['Ordered', 'Received', 'Vendor Invoiced']);

function matchesFilter(status: string, filter: StatusFilter): boolean {
  switch (filter) {
    case 'Open':
      return OPEN_STATUSES.has(status);
    case 'Ordered':
      return ORDERED_STATUSES.has(status);
    case 'Paid':
      return status === 'Paid';
    case 'All':
    default:
      return true;
  }
}

const ProcurementPage: React.FC = () => {
  useEffectiveRole(); // keeps the ImpersonationProvider wired in the shell
  const ws = useWorkspaceTabs();
  const { data, isPending, isError, refetch } = useProcurements();
  const [view, setView] = useProcurementView();
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<StatusFilter>('All');

  const all = useMemo(() => data ?? [], [data]);

  // View-local filters (OD-7 search by title+code; status SegFilter). Newest first.
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return all
      .filter((p) => matchesFilter(p.status as string, filter))
      .filter(
        (p) =>
          !q ||
          p.title.toLowerCase().includes(q) ||
          (p.code ?? '').toLowerCase().includes(q),
      )
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  }, [all, search, filter]);

  const onOpen = (p: ProcurementWithRefs) => openPR(ws, p);

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
      key: 'project',
      header: 'Project',
      cell: (r) => <span className="text-muted-foreground">{r.project?.name ?? '—'}</span>,
    },
    {
      key: 'requester',
      header: 'Requested by',
      cell: (r) => (
        <span className="flex items-center gap-2">
          <span
            aria-hidden
            className="grid size-[22px] shrink-0 place-items-center rounded-full bg-secondary text-[10px] font-bold text-muted-foreground"
          >
            {(r.requested_by?.full_name ?? '?').trim().charAt(0).toUpperCase() || '?'}
          </span>
          <span className="truncate">{r.requested_by?.full_name ?? 'Unknown'}</span>
        </span>
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

  // ── States ────────────────────────────────────────────────────────────────
  const state: 'loading' | 'empty' | 'error' | undefined = isPending
    ? 'loading'
    : isError || !data
      ? 'error'
      : all.length === 0
        ? 'empty'
        : undefined;

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-[24px] font-bold tracking-[-0.02em]">Procurement</h1>
          <p className="mt-0.5 max-w-[68ch] text-sm text-muted-foreground">
            Purchase requests through PR → VQ → PO → GR → VI → Paid, with separation-of-duties
            gates. Open a request to drill into its full lifecycle page.
          </p>
        </div>
      </div>

      {/* Toolbar */}
      {state !== 'loading' && (
        <Toolbar standalone>
          <ViewToggle<'table' | 'board'>
            options={[
              { value: 'table', label: 'Table', icon: 'table' },
              { value: 'board', label: 'By-stage Board', icon: 'cols' },
            ]}
            value={view}
            onChange={setView}
            ariaLabel="Procurement view"
          />
          <ViewToggle<StatusFilter>
            options={FILTERS.map((f) => ({ value: f, label: f }))}
            value={filter}
            onChange={setFilter}
            ariaLabel="Status filter"
          />
          <SearchMini
            placeholder="Filter requests…"
            aria-label="Filter requests"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            containerClassName="ml-auto"
          />
        </Toolbar>
      )}

      {/* Body */}
      {state === 'loading' && (
        <div className="rounded-lg border border-border bg-card">
          <ListState variant="loading" rows={6} />
        </div>
      )}

      {state === 'error' && (
        <ListState
          variant="error"
          title="Couldn't load procurements"
          sub="Something went wrong fetching your requests."
          onRetry={() => refetch()}
        />
      )}

      {state === 'empty' && (
        <ListState
          variant="empty"
          icon="cart"
          title="No purchase requests yet"
          sub="Requests you raise will appear here through their full lifecycle."
        />
      )}

      {state === undefined && view === 'board' && (
        <ProcurementBoard procurements={filtered} onOpen={onOpen} />
      )}

      {state === undefined && view === 'table' && (
        <DataTable<ProcurementWithRefs>
          rows={filtered}
          columns={columns}
          rowKey={(r) => r.id}
          onActivate={onOpen}
          state={filtered.length === 0 ? 'empty' : undefined}
          emptyTitle="No requests match your filters"
          emptySub="Try a different status, search term, or clear the filters."
        />
      )}
    </div>
  );
};

export default ProcurementPage;
