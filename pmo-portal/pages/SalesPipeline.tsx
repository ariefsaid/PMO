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
  type FunnelStage,
  type Column,
} from '@/src/components/ui';
import { useNavigate } from 'react-router-dom';
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
} from '../components/salesPipeline';

/** The five open pipeline columns (Won/Lost excluded — terminal, not forecast). */
const OPEN_COLUMNS = SALES_COLUMNS.filter((c) => !c.terminal);

/** Table status filter (Model B, AC-IXD-PROJ-007): Open deals (default) or terminal Lost deals. */
type DealScope = 'Open' | 'Lost';
const DEAL_SCOPES: DealScope[] = ['Open', 'Lost'];

const SalesPipeline: React.FC = () => {
  const { data, isPending, isError, refetch } = useSalesPipeline();
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

  // The table is scoped by the Open / Lost SegFilter, then by the view-local search.
  const filtered = useMemo(() => {
    const base = scope === 'Lost' ? lost : openProjects;
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
    },
    { key: 'customer', header: 'Customer', cell: (r) => r.client_name ?? '—' },
    {
      key: 'stage',
      header: 'Stage',
      cell: (r) => <StatusPill variant={pillVariantForStatus(r.status)}>{r.status}</StatusPill>,
    },
    { key: 'value', header: 'Value', align: 'num', cell: (r) => formatCurrency(r.contract_value) },
    {
      key: 'weighted',
      header: 'Weighted',
      align: 'num',
      cell: (r) => (
        <span className="text-muted-foreground">{formatCurrency(weightedValue(r))}</span>
      ),
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
            showValue
            aria-label={`Win probability ${pct}%`}
            className="ml-auto"
          />
        );
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
          <Button variant="outline">
            <Icon name="export" />
            Export
          </Button>
        </div>
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
          emptyTitle={scope === 'Lost' ? 'No lost deals' : 'No deals match your search'}
          emptySub={
            scope === 'Lost'
              ? 'Deals marked lost will appear here.'
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
