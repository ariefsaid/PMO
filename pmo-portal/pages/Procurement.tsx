import React, { useMemo, useState } from 'react';
import {
  Toolbar,
  SearchMini,
  ViewToggle,
  ListState,
  DataTable,
  StatusPill,
  LifecycleStepper,
  Button,
  Icon,
  useToast,
  type Column,
} from '@/src/components/ui';
import { ExportButton } from '@/src/components/export';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useEffectiveRole } from '@/src/auth/impersonation';
import { useAuth } from '@/src/auth/useAuth';
import { usePermission } from '@/src/auth/usePermission';
import { useProcurements } from '@/src/hooks/useProcurements';
import { useCreateProcurement } from '@/src/hooks/useProcurementCrud';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import { NewProcurementModal } from './procurement/NewProcurementModal';
import { formatCurrency } from '@/src/lib/format';
import type { ProcurementWithRefs } from '@/src/lib/db/procurements';
import type { ProcurementStatus } from '@/src/lib/db/procurementLifecycle';
import ProcurementBoard from '../components/ProcurementBoard';
import { useProcurementView } from '@/src/hooks/useProcurementView';
import { lifecycleSteps, pillVariantForStatus, stageLabelForStatus, openPR } from '../components/procurement';

/** Status filter segments (the IA-3 stage SegFilter; "All" + the four reporting buckets
 *  + the B-2 "Needs approval" segment for Finance/PM).
 *
 *  AC-IXD-DASH-W5-C2B / OD-C / review-I2: "Vendor Invoiced" is now a VISIBLE segment in the
 *  toolbar (not just a URL-param-only deep-link). This resolves review-I2 where arriving via
 *  /procurement?status=Vendor+Invoiced had no selected tab and appeared as the whole list.
 *  The segment is role-shaped: shown for Finance and Approver roles (the roles that act on VI
 *  rows), matching the "Needs approval" visibility pattern. Engineers and non-approvers do not
 *  see the VI segment since they don't process payments.
 *
 *  Role-shaping decision (noted in build report): Vendor Invoiced is shown for any role that
 *  can see the Finance dashboard "Ready to pay" table — Finance and Approver roles (canApprove).
 *  This matches the existing "Needs approval" segment gating pattern: Finance can Mark-as-Paid,
 *  approvers may need to review. All-roles access is not restricted server-side (RLS is org-wide);
 *  this is FE clarity, not a security boundary.
 */
type StatusFilter = 'All' | 'Needs approval' | 'Open' | 'Ordered' | 'Vendor Invoiced' | 'Paid';
const ALL_FILTERS: StatusFilter[] = ['All', 'Open', 'Ordered', 'Vendor Invoiced', 'Paid'];
/** Roles that can approve procurement requests (Requested → Approved/Rejected per OD-PROC-1). */
const APPROVAL_ROLES = new Set(['Admin', 'Executive', 'Project Manager', 'Finance']);

/** Values accepted as ?status= URL params. Any unrecognised param falls back to "All". */
const VALID_URL_STATUSES = new Set<StatusFilter>([
  'All', 'Needs approval', 'Open', 'Ordered', 'Paid', 'Vendor Invoiced',
]);

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
    case 'Needs approval':
      // B-2 (D5): surface Requested PRs awaiting approval action.
      return status === 'Requested';
    case 'Open':
      return OPEN_STATUSES.has(status);
    case 'Ordered':
      return ORDERED_STATUSES.has(status);
    case 'Paid':
      return status === 'Paid';
    // AC-IXD-DASH-W5-C2A: direct Vendor Invoiced segment — the N16 drill destination.
    // Accessed via ?status=Vendor+Invoiced from the Finance dashboard outstanding-invoices KPI.
    case 'Vendor Invoiced':
      return status === 'Vendor Invoiced';
    case 'All':
    default:
      return true;
  }
}

const ProcurementPage: React.FC = () => {
  const { realRole } = useEffectiveRole();
  const { currentUser } = useAuth();
  const userId = currentUser?.id;
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const may = usePermission();

  // A-3 / OD-W2-1: an Engineer has no Procurement nav; when they reach /procurement the page is
  // OWN-SCOPED. procurements_select RLS is org-wide (org_id = auth_org_id()), NOT requester-
  // scoped, so the server returns every PR in the org; the FE narrows the cached list to rows
  // the Engineer raised (requested_by_id === their uid) and reframes the copy to "your requests".
  // This is FE clarity, not a security boundary (same tenant) — Raise request stays available
  // (any member may raise; requester is server-stamped). Managers see the full org index.
  const ownScoped = realRole === 'Engineer';
  // B-2 (D5): Finance/PM/Exec/Admin can approve procurement requests (Requested → Approved).
  // Show a "Needs approval" segment so they can quickly surface actionable Requested PRs.
  const canApprove = realRole != null && APPROVAL_ROLES.has(realRole);
  const { toast } = useToast();
  const { data, isPending, isError, refetch } = useProcurements();
  const create = useCreateProcurement();
  const [view, setView] = useProcurementView();
  const [search, setSearch] = useState('');
  // AC-IXD-DASH-W5-C2A: URL search-param read-on-mount convention. A ?status=<value> param
  // drills directly into the requested filter segment (e.g. from a Finance dashboard KPI link).
  // Backward-compatible: no param => "All" default. Unrecognised values fall back to "All".
  const urlStatus = searchParams.get('status') as StatusFilter | null;
  const [filter, setFilter] = useState<StatusFilter>(
    urlStatus && VALID_URL_STATUSES.has(urlStatus) ? urlStatus : 'All',
  );
  const [showNew, setShowNew] = useState(false);

  // B-2: "Needs approval" prepended for approver roles.
  // AC-IXD-DASH-W5-C2B: "Vendor Invoiced" is in ALL_FILTERS for approver roles — they process
  // payments. Non-approver roles (Engineer) see the base ALL_FILTERS without "Needs approval"
  // but still see "Vendor Invoiced" since it is in the base list.
  const FILTERS: StatusFilter[] = canApprove
    ? ['All', 'Needs approval', ...ALL_FILTERS.slice(1)]
    : ALL_FILTERS;

  // Raise request is open to ANY member incl. Engineer (requester server-stamped).
  const canCreate = may('create', 'procurement');

  // Own-scope narrowing: an Engineer sees only the PRs they raised (see comment above). Applied
  // to the base list so the table, board, and empty-state count all reflect the own-scoped view.
  const all = useMemo(() => {
    const rows = data ?? [];
    return ownScoped && userId ? rows.filter((p) => p.requested_by_id === userId) : rows;
  }, [data, ownScoped, userId]);

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

  const onOpen = (p: ProcurementWithRefs) => openPR(navigate, p);

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
      exportValue: (r) => r.title,
    },
    {
      key: 'project',
      header: 'Project',
      cell: (r) => <span className="text-muted-foreground">{r.project?.name ?? '—'}</span>,
      exportValue: (r) => r.project?.name ?? '',
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
      exportValue: (r) => r.requested_by?.full_name ?? '',
    },
    {
      key: 'value',
      header: 'Value',
      align: 'num',
      cell: (r) => formatCurrency(r.total_value),
      exportValue: (r) => r.total_value,
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
      // Export the human-readable stage label (the stepper component can't be serialized)
      exportValue: (r) => stageLabelForStatus(r.status as ProcurementStatus),
    },
    {
      key: 'status',
      header: 'Status',
      cell: (r) => (
        <StatusPill variant={pillVariantForStatus(r.status as ProcurementStatus)}>
          {stageLabelForStatus(r.status as ProcurementStatus)}
        </StatusPill>
      ),
      exportValue: (r) => stageLabelForStatus(r.status as ProcurementStatus),
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
          <h1 className="text-[24px] font-bold tracking-[-0.02em]">
            {ownScoped ? 'Your purchase requests' : 'Procurement'}
          </h1>
          <p className="mt-0.5 max-w-[68ch] text-sm text-muted-foreground">
            {ownScoped
              ? 'The purchase requests you raised, through PR → VQ → PO → GR → VI → Paid. Open a request to track its lifecycle, or raise a new one.'
              : 'Purchase requests through PR → VQ → PO → GR → VI → Paid, with separation-of-duties gates. Open a request to drill into its full lifecycle page.'}
          </p>
        </div>
        {canCreate && (
          <Button variant="primary" onClick={() => setShowNew(true)}>
            <Icon name="plus" />
            Raise request
          </Button>
        )}
      </div>

      {/* Toolbar */}
      {state !== 'loading' && (
        <Toolbar standalone>
          {/* A-MIN-1: below md DataTable force-renders cards (no table/board possible),
              so hide the Table/Board toggle — it would be a state-lie. */}
          <div className="hidden md:block">
            <ViewToggle<'table' | 'board'>
              options={[
                { value: 'table', label: 'Table', icon: 'table' },
                { value: 'board', label: 'Board', icon: 'cols' },
              ]}
              value={view}
              onChange={setView}
              ariaLabel="Procurement view"
            />
          </div>
          {/* AC-2: scrollable so "Vendor Invoiced" etc. aren't clipped at 390px. */}
          <div
            data-testid="status-filter-scroll"
            className="overflow-x-auto scroll-fade-x"
          >
            <ViewToggle<StatusFilter>
              options={FILTERS.map((f) => ({ value: f, label: f }))}
              value={filter}
              onChange={setFilter}
              ariaLabel="Status filter"
            />
          </div>
          <SearchMini
            placeholder="Filter requests…"
            aria-label="Filter requests"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            containerClassName="ml-auto"
          />
          <ExportButton rows={filtered} columns={columns} entity="Procurement" />
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
          title={ownScoped ? "You haven't raised any requests yet" : 'No purchase requests yet'}
          sub="Requests you raise will appear here through their full lifecycle."
          action={
            canCreate ? { label: 'Raise request', onClick: () => setShowNew(true) } : undefined
          }
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
          rowLabel={(r) => `Open ${r.title}`}
          state={filtered.length === 0 ? 'empty' : undefined}
          emptyTitle="No requests match your filters"
          emptySub="Try a different status, search term, or clear the filters."
        />
      )}

      {/* Raise a new PR → on success, land on its detail page to add line items. */}
      {showNew && (
        <NewProcurementModal
          onClose={() => setShowNew(false)}
          onCreate={(input) => create.mutateAsync(input)}
          onCreated={(id) => {
            setShowNew(false);
            toast('Request created', 'Add line items and quotations next', 'success');
            navigate(`/procurement/${id}`);
          }}
          onError={(err) => {
            const { headline, detail } = classifyMutationError(err);
            toast(headline, detail, 'warning');
          }}
        />
      )}
    </div>
  );
};

export default ProcurementPage;
