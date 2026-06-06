import React, { useMemo, useState } from 'react';
import {
  Button,
  Toolbar,
  SearchMini,
  ViewToggle,
  ListState,
  DataTable,
  StatusPill,
  ProgressBar,
  Icon,
  type Column,
} from '@/src/components/ui';
import { useEffectiveRole } from '@/src/auth/impersonation';
import { useProjects, useClientCompanies, useProjectManagers } from '@/src/hooks/useProjects';
import { useWorkspaceTabs } from '@/src/components/shell';
import { useAuth } from '@/src/auth/useAuth';
import { useProjectView } from '@/src/hooks/useProjectView';
import { formatCurrency } from '@/src/lib/format';
import type { ProjectWithRefs } from '@/src/lib/db/projects';
import type { ProjectStatus } from '@/src/lib/db/projectTransitions';
import { ProjectStatus as ProjectStatusEnum } from '../types';
import { pillVariantForProjectStatus, projectIconColor } from '../components/projects';
import ProjectCard from '../components/ProjectCard';
import ProjectStatusControl from '../components/ProjectStatusControl';

/** The IA-3 status group SegFilter (legacy "smart tabs", re-skinned). */
type StatusFilter = 'All' | 'My Projects' | 'Ongoing' | 'Leads' | 'Completed';
const FILTERS: StatusFilter[] = ['All', 'My Projects', 'Ongoing', 'Leads', 'Completed'];

const ONGOING = [ProjectStatusEnum.Ongoing, ProjectStatusEnum.WonPendingKoM, ProjectStatusEnum.OnHold] as string[];
const LEADS = [
  ProjectStatusEnum.Leads,
  ProjectStatusEnum.PQSubmitted,
  ProjectStatusEnum.QuotationSubmitted,
  ProjectStatusEnum.TenderSubmitted,
  ProjectStatusEnum.Negotiation,
] as string[];
const COMPLETED = [ProjectStatusEnum.CloseOut, ProjectStatusEnum.Loss] as string[];

/** Utilization tone: ≤55 neutral(primary) · 55–100 warning · >100 destructive. */
function utilizationPct(p: ProjectWithRefs): number {
  return p.contract_value > 0 ? (p.spent / p.contract_value) * 100 : 0;
}

const Projects: React.FC = () => {
  useEffectiveRole(); // keeps the ImpersonationProvider wired in the shell
  const ws = useWorkspaceTabs();
  const { currentUser } = useAuth();
  const { data, isPending, isError, refetch } = useProjects();
  const { data: clientCompanies = [] } = useClientCompanies();
  const { data: projectManagers = [] } = useProjectManagers();

  const [view, setView] = useProjectView();
  const [filter, setFilter] = useState<StatusFilter>('All');
  const [filterClient, setFilterClient] = useState('All');
  const [filterPM, setFilterPM] = useState('All');
  const [search, setSearch] = useState('');

  const all = useMemo<ProjectWithRefs[]>(() => data ?? [], [data]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return all
      .filter((p) => {
        switch (filter) {
          case 'My Projects':
            return p.project_manager_id === currentUser?.id;
          case 'Ongoing':
            return ONGOING.includes(p.status as string);
          case 'Leads':
            return LEADS.includes(p.status as string);
          case 'Completed':
            return COMPLETED.includes(p.status as string);
          default:
            return true;
        }
      })
      .filter((p) => filterClient === 'All' || p.client_id === filterClient)
      .filter((p) => filterPM === 'All' || p.project_manager_id === filterPM)
      .filter(
        (p) =>
          !q ||
          p.name.toLowerCase().includes(q) ||
          (p.code ?? '').toLowerCase().includes(q),
      );
  }, [all, filter, filterClient, filterPM, search, currentUser?.id]);

  const filtersActive =
    filter !== 'All' || filterClient !== 'All' || filterPM !== 'All' || search.trim() !== '';

  const clearFilters = () => {
    setFilter('All');
    setFilterClient('All');
    setFilterPM('All');
    setSearch('');
  };

  const onOpen = (p: ProjectWithRefs) => {
    ws.openRecord({
      id: `projects:${p.id}`,
      kind: 'record',
      path: `/projects/${p.id}`,
      icon: 'folder',
      label: p.name,
      code: p.code ?? p.id.slice(0, 8),
      module: 'projects',
    });
  };

  const columns: Column<ProjectWithRefs>[] = [
    {
      key: 'project',
      header: 'Project',
      cell: (p) => (
        <div className="flex min-w-0 items-center gap-2.5">
          <span
            aria-hidden
            className="grid size-7 shrink-0 place-items-center rounded-md text-[11px] font-bold text-white"
            style={{ background: projectIconColor() }}
          >
            {(p.name.trim().charAt(0) || '•').toUpperCase()}
          </span>
          <div className="min-w-0">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onOpen(p);
              }}
              className="block max-w-[40ch] truncate text-left font-semibold hover:text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              title={p.name}
            >
              {p.name}
            </button>
            <div className="truncate font-mono text-[11px] text-muted-foreground">
              {p.code ?? p.id.slice(0, 8)}
            </div>
            {p.customer_contract_ref && (
              <div className="truncate font-mono text-[11px] text-muted-foreground/80">
                {p.customer_contract_ref}
              </div>
            )}
          </div>
        </div>
      ),
    },
    {
      key: 'customer',
      header: 'Customer',
      cell: (p) => <span>{p.client?.name ?? '—'}</span>,
    },
    {
      key: 'pm',
      header: 'PM',
      cell: (p) => (
        <span className="flex items-center gap-2">
          <span
            aria-hidden
            className="grid size-[22px] shrink-0 place-items-center rounded-full bg-secondary text-[10px] font-bold text-muted-foreground"
          >
            {(p.pm?.full_name?.trim().charAt(0) ?? '?').toUpperCase()}
          </span>
          <span className="truncate">{p.pm?.full_name ?? 'Unassigned'}</span>
        </span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      cell: (p) => (
        <StatusPill variant={pillVariantForProjectStatus(p.status as string)}>{p.status}</StatusPill>
      ),
    },
    {
      key: 'contract',
      header: 'Contract',
      align: 'num',
      cell: (p) => formatCurrency(p.contract_value),
    },
    {
      key: 'actual',
      header: 'Actual',
      align: 'num',
      cell: (p) => <span className="text-muted-foreground">{formatCurrency(p.spent)}</span>,
    },
    {
      key: 'progress',
      header: 'Progress',
      cell: (p) => (
        <ProgressBar
          value={Math.round(utilizationPct(p))}
          showValue
          aria-label={`Spend: ${Math.round(utilizationPct(p))}% of contract`}
        />
      ),
    },
    {
      key: 'transition',
      header: 'Action',
      cell: (p) => (
        <div onClick={(e) => e.stopPropagation()}>
          <ProjectStatusControl
            project={{
              id: p.id,
              status: p.status as ProjectStatus,
              customer_contract_ref: p.customer_contract_ref,
            }}
          />
        </div>
      ),
    },
  ];

  // ── States ──────────────────────────────────────────────────────────────
  if (isPending) {
    return (
      <div>
        <Header />
        <div data-testid="projects-loading" className="rounded-lg border border-border bg-card">
          <ListState variant="loading" rows={6} />
        </div>
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div>
        <Header />
        <ListState
          variant="error"
          title="Couldn't load projects"
          sub="Something went wrong fetching your projects."
          onRetry={() => refetch()}
        />
      </div>
    );
  }

  if (all.length === 0) {
    return (
      <div>
        <Header />
        <ListState
          variant="empty"
          icon="folder"
          title="No projects yet"
          sub="Projects you create or win will appear here."
          action={{ label: 'New Project', onClick: () => {}, disabled: true, disabledTitle: 'Project creation is coming soon' }}
        />
      </div>
    );
  }

  return (
    <div>
      <Header />

      <Toolbar standalone>
        <ViewToggle<'table' | 'cards'>
          options={[
            { value: 'table', label: 'Table', icon: 'table' },
            { value: 'cards', label: 'Cards', icon: 'cards' },
          ]}
          value={view}
          onChange={setView}
          ariaLabel="Projects view"
        />
        <ViewToggle<StatusFilter>
          options={FILTERS.map((f) => ({ value: f, label: f }))}
          value={filter}
          onChange={setFilter}
          ariaLabel="Status filter"
        />
        <select
          aria-label="Filter by customer"
          value={filterClient}
          onChange={(e) => setFilterClient(e.target.value)}
          className="h-8 rounded-lg border border-input bg-background px-2.5 text-[13px] text-foreground outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          <option value="All">All customers</option>
          {clientCompanies.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <select
          aria-label="Filter by project manager"
          value={filterPM}
          onChange={(e) => setFilterPM(e.target.value)}
          className="h-8 rounded-lg border border-input bg-background px-2.5 text-[13px] text-foreground outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          <option value="All">All managers</option>
          {projectManagers.map((u) => (
            <option key={u.id} value={u.id}>
              {u.full_name}
            </option>
          ))}
        </select>
        <SearchMini
          placeholder="Search projects…"
          aria-label="Search projects"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          containerClassName="ml-auto"
        />
      </Toolbar>

      {/* Body */}
      {view === 'table' ? (
        <DataTable<ProjectWithRefs>
          rows={filtered}
          columns={columns}
          rowKey={(p) => p.id}
          onActivate={onOpen}
          state={filtered.length === 0 ? 'empty' : undefined}
          emptyTitle={filtersActive ? 'No projects match these filters' : 'No projects yet'}
          emptySub={
            filtersActive
              ? 'Try a different status, customer, PM, or search term.'
              : 'Projects you create or win will appear here.'
          }
          emptyAction={
            filtersActive ? { label: 'Clear filters', onClick: clearFilters } : undefined
          }
        />
      ) : filtered.length === 0 ? (
        <ListState
          variant="empty"
          icon="folder"
          title={filtersActive ? 'No projects match these filters' : 'No projects yet'}
          sub={
            filtersActive
              ? 'Try a different status, customer, PM, or search term.'
              : 'Projects you create or win will appear here.'
          }
          action={filtersActive ? { label: 'Clear filters', onClick: clearFilters } : undefined}
        />
      ) : (
        <div
          className="grid gap-3.5"
          style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))' }}
        >
          {filtered.map((p) => (
            <ProjectCard key={p.id} project={p} onOpen={onOpen} />
          ))}
        </div>
      )}
    </div>
  );
};

/** Page head — title + sub + (stub) New Project CTA. */
const Header: React.FC = () => (
  <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
    <div>
      <h1 className="text-[24px] font-bold tracking-[-0.02em]">Projects</h1>
      <p className="mt-0.5 max-w-[68ch] text-sm text-muted-foreground">
        Track every project and lead from pipeline through delivery. Open one to drill into its
        budget, procurement, and detail.
      </p>
    </div>
    <Button variant="primary" disabled title="Project creation is coming soon">
      <Icon name="plus" />
      New Project
    </Button>
  </div>
);

export default Projects;
