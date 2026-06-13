import React, { useMemo, useState } from 'react';
import {
  Button,
  Funnel,
  Toolbar,
  SearchMini,
  ViewToggle,
  ListState,
  DataTable,
  StatusPill,
  ProgressBar,
  Icon,
  AccessDenied,
  useToast,
  type FunnelStage,
  type Column,
} from '@/src/components/ui';
import { useNavigate } from 'react-router-dom';
import { usePermission } from '@/src/auth/usePermission';
import { useSalesPipeline, useLostDeals } from '@/src/hooks/useDashboard';
import { formatCurrency } from '@/src/lib/format';
import type { PipelineProject } from '@/src/lib/db/dashboard';
import SalesKanbanBoard from '../components/SalesKanbanBoard';
import { usePipelineView } from '@/src/hooks/usePipelineView';
import {
  SALES_COLUMNS,
  weightedValue,
  pillVariantForStatus,
  formatPercent,
  openOpportunity,
  daysSince,
  isNeedsAttention,
  ATTENTION_THRESHOLD_DAYS,
} from '../components/salesPipeline';
import { useProjectMutations } from '@/src/hooks/useProjects';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import { ExportButton } from '@/src/components/export';
import ProjectFormModal from '../components/ProjectFormModal';

/** The five open pipeline columns (Won/Lost excluded — terminal, not forecast). */
const OPEN_COLUMNS = SALES_COLUMNS.filter((c) => !c.terminal);

/**
 * Table status filter (Model B, AC-IXD-PROJ-007): Open deals (default) or terminal Lost deals.
 * N14 (AC-IXD-PIPE-W5-C5): "Needs attention" segment shows deals from BOTH scopes (open ∪ lost)
 * whose days-since-last_update >= ATTENTION_THRESHOLD_DAYS. get_sales_pipeline() now projects
 * last_update + the owner for open rows (migration 0020), so open deals carry real aging — the
 * filter and the Owner / Last touch columns work on open deals, not just lost ones.
 */
type DealScope = 'Open' | 'Lost' | 'Needs attention';
const DEAL_SCOPES: DealScope[] = ['Open', 'Lost', 'Needs attention'];

const SalesPipeline: React.FC = () => {
  const may = usePermission();
  // A-4 (rbac-visibility §C): Sales Pipeline view = Admin·Exec·PM·Finance; Engineer = ○ (no
  // nav, no page). The rail hides it but the ROUTE does not — so an Engineer reaching /sales
  // by URL gets a clean access-denied surface with a way back, never the org pipeline board.
  // `project.transition` is exactly the Sales-view role set (Admin·Exec·PM·Finance). RLS is the
  // authority for the rows; this is FE clarity.
  const canViewSales = may('transition', 'project');
  // B-3 (AC-W2-IXD-005): the "+ New opportunity" CTA — same gate as Projects.tsx (DELIVERY:
  // Admin·Exec·PM). Finance views the pipeline but cannot start deals (rbac-visibility §C).
  const canCreate = may('create', 'project');

  const { data, isPending, isError, refetch } = useSalesPipeline();
  const { create } = useProjectMutations();
  const { toast } = useToast();
  const [createOpen, setCreateOpen] = useState(false);
  // Lost deals are read via the projects RLS path (get_sales_pipeline returns only OPEN stages),
  // so the terminal "Lost" kanban column + the "Lost" table filter are reachable (FE-only).
  const { data: lostDeals } = useLostDeals();
  const navigate = useNavigate();
  const [view, setView] = usePipelineView();
  const [search, setSearch] = useState('');
  const [scope, setScope] = useState<DealScope>('Open');

  const openProjects = useMemo(() => data?.projects ?? [], [data]);
  const lost = useMemo(() => lostDeals ?? [], [lostDeals]);
  const stages = useMemo(() => data?.stages ?? [], [data]);

  // The kanban shows every column, so it draws from open ∪ lost (the Lost column is otherwise
  // always empty — the RPC never returns lost rows).
  const kanbanProjects = useMemo(() => [...openProjects, ...lost], [openProjects, lost]);

  // The table is scoped by the Open / Lost / Needs attention SegFilter, then by search.
  // "Needs attention" (N14): spans open ∪ lost rows whose days-since-last_update >=
  // ATTENTION_THRESHOLD_DAYS. Open rows now carry last_update from the RPC (migration 0020),
  // so a stale open deal is flagged just like a stale lost one.
  const filtered = useMemo(() => {
    let base: PipelineProject[];
    if (scope === 'Lost') {
      base = lost;
    } else if (scope === 'Needs attention') {
      base = [...openProjects, ...lost].filter(isNeedsAttention);
    } else {
      base = openProjects;
    }
    const q = search.trim().toLowerCase();
    if (!q) return base;
    return base.filter(
      (p) =>
        p.name.toLowerCase().includes(q) || (p.client_name ?? '').toLowerCase().includes(q),
    );
  }, [openProjects, lost, scope, search]);

  // Funnel band — always the five open stages in fixed order, even when the RPC
  // omits empty stages (edge (b): render zero-value stages, never blank). Each
  // band cell is keyed to its column status so probs/values never drift.
  const stageByStatus = useMemo(
    () => new Map(stages.map((s) => [s.status as string, s])),
    [stages],
  );
  const totalWeighted = OPEN_COLUMNS.reduce(
    (sum, c) => sum + (stageByStatus.get(c.statuses[0])?.weighted_value ?? 0),
    0,
  );
  const maxWeighted = Math.max(
    0,
    ...OPEN_COLUMNS.map((c) => stageByStatus.get(c.statuses[0])?.weighted_value ?? 0),
  );

  const funnelStages: FunnelStage[] = OPEN_COLUMNS.map((col) => {
    const s = stageByStatus.get(col.statuses[0]);
    const weighted = s?.weighted_value ?? 0;
    return {
      name: col.title,
      dotColor: col.dotColor,
      prob: s ? formatPercent(s.win_probability) : undefined,
      value: formatCurrency(s?.total_value ?? 0),
      weighted: `${formatCurrency(weighted)} weighted`,
      barPct: maxWeighted > 0 ? (weighted / maxWeighted) * 100 : 0,
    };
  });

  const onOpen = (p: PipelineProject) => openOpportunity(navigate, p);

  const tableColumns: Column<PipelineProject>[] = [
    {
      key: 'opp',
      header: 'Opportunity',
      cell: (r) => (
        <div className="flex items-center gap-2.5">
          <span
            aria-hidden
            className="grid size-7 shrink-0 place-items-center rounded-md text-[12px] font-bold text-white"
            style={{ background: stageDot(r.status) }}
          >
            {(r.client_name ?? r.name).trim().charAt(0).toUpperCase() || '•'}
          </span>
          <div className="min-w-0">
            <div className="truncate font-semibold" title={r.name}>
              {r.name}
            </div>
            <div className="truncate font-mono text-[11px] text-muted-foreground">
              {r.id.slice(0, 8)}
            </div>
          </div>
        </div>
      ),
      exportValue: (r) => r.name,
    },
    {
      key: 'customer',
      header: 'Customer',
      cell: (r) => r.client_name ?? '—',
      exportValue: (r) => r.client_name ?? '',
    },
    {
      key: 'stage',
      header: 'Stage',
      cell: (r) => <StatusPill variant={pillVariantForStatus(r.status)}>{r.status}</StatusPill>,
      exportValue: (r) => r.status,
    },
    {
      key: 'value',
      header: 'Value',
      align: 'num',
      cell: (r) => formatCurrency(r.contract_value),
      exportValue: (r) => r.contract_value,
    },
    {
      key: 'weighted',
      header: 'Weighted',
      align: 'num',
      cell: (r) => (
        <span className="text-muted-foreground">{formatCurrency(weightedValue(r))}</span>
      ),
      exportValue: (r) => weightedValue(r),
    },
    {
      key: 'win',
      header: 'Win %',
      align: 'num',
      cell: (r) => {
        const pct = Math.round(r.win_probability * 100);
        return (
          <ProgressBar
            value={pct}
            tone="primary"
            showValue
            aria-label={`Win probability ${pct}%`}
            className="ml-auto"
          />
        );
      },
      exportValue: (r) => Math.round(r.win_probability * 100),
    },
    {
      /**
       * N14 Owner column (AC-IXD-PIPE-W5-C5).
       * DATA AVAILABILITY: pm_name (the project manager / owner) is supplied for BOTH open
       * pipeline rows (get_sales_pipeline → profiles.full_name, migration 0020) and lost deals
       * (useLostDeals, full ProjectWithRefs row). A project with no PM renders "—" (honest).
       */
      key: 'owner',
      header: 'Owner',
      cell: (r) => {
        if (!r.pm_name) {
          return <span className="text-muted-foreground" aria-label="Owner not available">—</span>;
        }
        return (
          <span className="flex items-center gap-1.5">
            <span
              aria-hidden
              className="grid size-[18px] shrink-0 place-items-center rounded-full bg-secondary text-[9px] font-bold text-muted-foreground"
            >
              {r.pm_name.trim().charAt(0).toUpperCase()}
            </span>
            <span className="whitespace-normal leading-tight">{r.pm_name}</span>
          </span>
        );
      },
      exportValue: (r) => r.pm_name ?? '',
    },
    {
      /**
       * N14 Last touch column (AC-IXD-PIPE-W5-C5).
       * DATA AVAILABILITY: last_update is supplied for BOTH open pipeline rows
       * (get_sales_pipeline, migration 0020) and lost deals (full row). A row genuinely
       * missing it renders "—" (defensive, honest).
       * Aging signal (ATTENTION_THRESHOLD_DAYS = 30d): text + warning color when stale —
       * text-not-color-only per DESIGN.md accessibility rule.
       */
      key: 'last_touch',
      header: 'Last touch',
      align: 'num',
      cell: (r) => {
        const days = daysSince(r.last_update);
        if (days === null) {
          return <span className="text-muted-foreground" aria-label="Last touch not available">—</span>;
        }
        const stale = days >= ATTENTION_THRESHOLD_DAYS;
        const label = days === 0 ? 'today' : days === 1 ? '1 day ago' : `${days} days ago`;
        return (
          <span
            className={`tabular text-[12.5px] ${stale ? 'font-semibold text-warning-foreground' : 'text-muted-foreground'}`}
            title={stale ? `Untouched for ${days} days — needs attention` : undefined}
          >
            {label}
          </span>
        );
      },
      exportValue: (r) => {
        const days = daysSince(r.last_update);
        if (days === null) return '';
        return days === 0 ? 'today' : days === 1 ? '1 day ago' : `${days} days ago`;
      },
    },
  ];

  // Search-filtered kanban set (open ∪ lost), so the kanban's view-local search spans every
  // column including the terminal Lost column.
  const kanbanFiltered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return kanbanProjects;
    return kanbanProjects.filter(
      (p) =>
        p.name.toLowerCase().includes(q) || (p.client_name ?? '').toLowerCase().includes(q),
    );
  }, [kanbanProjects, search]);

  // ── States ────────────────────────────────────────────────────────────────
  // Empty only when there are no open AND no lost deals (a lost-only org still has a Pipeline).
  const state: 'loading' | 'empty' | 'error' | undefined = isPending
    ? 'loading'
    : isError || !data
      ? 'error'
      : openProjects.length === 0 && lost.length === 0
        ? 'empty'
        : undefined;

  // A-4 page view-gate (after all hooks — Rules of Hooks): a denied role (Engineer) gets the
  // shared access-denied surface, not the pipeline board.
  if (!canViewSales) {
    return (
      <AccessDenied
        title="You don't have access to the Sales Pipeline"
        sub="The Sales Pipeline is available to managers and finance. Your work lives on your dashboard, projects, and tasks."
        onBack={() => navigate('/')}
      />
    );
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-[24px] font-bold tracking-[-0.02em]">Sales Pipeline</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Track opportunities, manage leads, and forecast revenue.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* B-5 (AC-W2-IXD-008 / W1-E): Export is now a live xlsx download of the
              current table view. The disabled "arrives with Reports" stub is replaced
              now that the client-side export layer is shipped (KANNA W1-E). */}
          <ExportButton rows={filtered} columns={tableColumns} entity="Pipeline" />
          {/* B-3 (AC-W2-IXD-005): the natural place to start a deal is the pipeline you
              manage deals on — not the Projects list. Reuses the same create modal +
              mutation as Projects.tsx (no new create path). Gated on can('create','project')
              = DELIVERY (Admin·Exec·PM); Finance views but cannot start deals per §C. */}
          {canCreate && (
            <Button variant="primary" onClick={() => setCreateOpen(true)}>
              <Icon name="plus" />
              New opportunity
            </Button>
          )}
        </div>
        {/* B-3: create modal (same flow as Projects.tsx — no new create path) */}
        {createOpen && (
          <ProjectFormModal
            onClose={() => setCreateOpen(false)}
            onSubmit={async (input) => {
              await create.mutateAsync(input);
              toast('Opportunity created', input.name, 'success');
              setCreateOpen(false);
            }}
            onError={(err) => {
              const { headline, detail } = classifyMutationError(err);
              toast(headline, detail, 'warning');
            }}
          />
        )}
      </div>

      {/* Weighted funnel summary band */}
      {state === 'loading' ? (
        <div className="mb-4">
          <ListState variant="loading" rows={2} />
        </div>
      ) : state === undefined ? (
        <section aria-label="Pipeline summary" className="mb-4">
          {/* Narrow viewports scroll the band horizontally so the five stages stay
              readable rather than crushing below their min track width (§2 reflow). */}
          <div className="overflow-x-auto">
            <Funnel stages={funnelStages} className="min-w-[640px]" />
          </div>
          <div className="mt-2 flex items-center gap-1.5 px-1 text-[12.5px] text-muted-foreground">
            <span>Weighted pipeline forecast</span>
            <span data-testid="pipeline-weighted-total" className="font-bold tabular text-foreground">
              {formatCurrency(totalWeighted)}
            </span>
          </div>
        </section>
      ) : null}

      {/* Toolbar */}
      {state !== 'loading' && (
        <Toolbar standalone>
          <ViewToggle
            options={[
              { value: 'kanban', label: 'Kanban', icon: 'cards' },
              { value: 'table', label: 'Table', icon: 'table' },
            ]}
            value={view}
            onChange={setView}
            ariaLabel="Pipeline view"
          />
          {/* Open / Lost scope — table-only (the kanban already shows the Lost column). */}
          {view === 'table' && (
            <ViewToggle<DealScope>
              options={DEAL_SCOPES.map((s) => ({ value: s, label: s }))}
              value={scope}
              onChange={setScope}
              ariaLabel="Deal scope"
            />
          )}
          <SearchMini
            placeholder="Search deals…"
            aria-label="Search deals"
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
          title="Couldn't load the sales pipeline"
          sub="Something went wrong fetching your pipeline."
          onRetry={() => refetch()}
        />
      )}

      {state === 'empty' && (
        <ListState
          variant="empty"
          title="No opportunities yet"
          sub="Add a lead to start tracking the pipeline."
        />
      )}

      {state === undefined && view === 'kanban' && (
        <SalesKanbanBoard projects={kanbanFiltered} onOpen={onOpen} />
      )}

      {state === undefined && view === 'table' && (
        <DataTable<PipelineProject>
          rows={filtered}
          columns={tableColumns}
          rowKey={(r) => r.id}
          onActivate={onOpen}
          rowLabel={(r) => `Open ${r.name}`}
          state={filtered.length === 0 ? 'empty' : undefined}
          emptyTitle={
            scope === 'Lost'
              ? 'No lost deals'
              : scope === 'Needs attention'
                ? 'No deals need attention'
                : 'No deals match your search'
          }
          emptySub={
            scope === 'Lost'
              ? 'Deals marked lost will appear here.'
              : scope === 'Needs attention'
                ? `No deal has been untouched for ${ATTENTION_THRESHOLD_DAYS}+ days — pipeline is active.`
                : 'Try a different name or customer.'
          }
        />
      )}
    </div>
  );
};

/** Stage dot color for a status (table icon tile + funnel parity). */
function stageDot(status: PipelineProject['status']): string {
  const col = SALES_COLUMNS.find((c) => c.statuses.includes(status));
  return col?.dotColor ?? 'hsl(var(--muted-foreground))';
}

export default SalesPipeline;
