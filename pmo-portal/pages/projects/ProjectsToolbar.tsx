import { FilterBar, type FilterBarFilter } from '@/src/components/ui/FilterBar';
import { ProjectFilterBuilder } from './ProjectFilterBuilder';
import type { TFunction } from 'i18next';
import { SearchMini, ViewToggle, MobileToolbarDisclosure, type Column } from '@/src/components/ui';
import { ExportButton } from '@/src/components/export';
import { ImportButton } from '@/src/components/import';
import { trackFilterApplied } from '@/src/lib/analytics';
import type { ProjectWithRefs } from '@/src/lib/db/projects';
import type { useProjectListModel, StatusFilter } from './useProjectListModel';

const FILTERS: StatusFilter[] = ['All', 'My Projects', 'Ongoing', 'Completed', 'at-risk'];
interface ProjectsToolbarInputs {
  model: ReturnType<typeof useProjectListModel>;
  exportColumns: Column<ProjectWithRefs>[];
  t: TFunction;
  canViewMoney: boolean;
  moreOpen: boolean;
  setMoreOpen: (open: boolean) => void;
}
export function projectsToolbar({ model, exportColumns, t, canViewMoney, moreOpen, setMoreOpen }: ProjectsToolbarInputs) {
  const { isEngineer, setWorkingSet, search, setSearch, filter, view, onViewChange, filtered, filterLabels,
    importDescriptor, budgetImportDescriptor, refetch, tasksPending, tasksError } = model;
  const exportDisabled = isEngineer && filter === 'My Projects' && (tasksPending || tasksError);
  const builder = <ProjectFilterBuilder model={model} t={t} canViewMoney={canViewMoney} />;
  const moreActionsChildren = [
    <ExportButton
      key="export"
      rows={filtered}
      disabled={exportDisabled}
      columns={exportColumns}
      entity="Projects"
      label={t('projects.export', 'Export')}
      onExport={() => setMoreOpen(false)}
    />,
    // ImportButton is internally permission-gated (returns null for a non-create real
    // role). Opening its wizard must NOT close/unmount this More disclosure — the wizard
    // stays mounted for its own lifecycle (DD-BIMP-3) — so no close is wired here.
    <ImportButton
      key="import"
      entity="project"
      descriptor={importDescriptor}
      onImported={() => void refetch()}
      label={t('projects.import', 'Import')}
    />,
    <ImportButton
      key="importBudget"
      entity="budgetLine"
      label={t('projects.importBudgets', 'Import budgets')}
      descriptor={budgetImportDescriptor}
      onImported={() => void refetch()}
    />,
  ];

  const mobileToolbar = (
    <div data-testid="projects-mobile-toolbar" className="flex w-full min-w-0 flex-col gap-2.5">
      <p data-testid="projects-mobile-count" className="hidden text-control text-muted-foreground md:block">
        {t('ui.listPage.showingOf', 'Showing {{count}} of {{total}}', { count: filtered.length, total: model.all.length })}
      </p>

      {/* status — bounded horizontal scroller (must stay reachable at 390px) */}
      <div data-testid="status-filter-scroll" className="order-2 min-w-0 max-w-full overflow-x-auto scroll-fade-x [&_button]:whitespace-nowrap">
        <ViewToggle<StatusFilter>
          options={FILTERS.map((f) => ({ value: f, label: filterLabels[f] }))}
          value={filter}
          onChange={(v) => {
            setWorkingSet((ws) => ({ ...ws, filter: v }));
            trackFilterApplied('status', FILTERS.length, 'projects');
          }}
          ariaLabel={t('projects.filters.ariaLabel', 'Status filter')}
        />
      </div>

      {/* Search gets a full row before the status tabs. */}
      <div data-testid="projects-mobile-search-row" className="order-1 min-w-0">
        <SearchMini
          placeholder={t('projects.search.placeholder', 'Search projects…')}
          aria-label={t('projects.search.ariaLabel', 'Search projects')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          searchSurface="projects-list"
          module="projects"
          resultCount={filtered.length}
          containerClassName="w-full min-w-0"
        />
      </div>

      {/* filters + more actions disclosures */}
      <div className="order-3 flex min-w-0 flex-wrap items-center gap-2">
        <div data-testid="projects-mobile-filters" className="w-full min-w-0">{builder}</div>

        {/* Keep the four view choices reachable without widening the page. */}
        <div data-testid="projects-mobile-view-scroll" className="min-w-0 max-w-full overflow-x-auto">
          <ViewToggle<'table' | 'cards' | 'calendar' | 'kanban'>
            options={[
              { value: 'table', label: t('projects.view.table', 'Table'), icon: 'table' },
              { value: 'cards', label: t('projects.view.cards', 'Cards'), icon: 'cards' },
              { value: 'calendar', label: t('projects.view.calendar', 'Calendar'), icon: 'cal' },
              { value: 'kanban', label: t('projects.view.board', 'Board'), icon: 'cols' },
            ]}
            value={view}
            onChange={onViewChange}
            ariaLabel={t('projects.view.ariaLabel', 'Projects view')}
            labelClassName="max-sm:sr-only"
          />
        </div>

          <MobileToolbarDisclosure
            label={t('uxs14.moreActions', 'More actions')}
            open={moreOpen}
            onOpenChange={setMoreOpen}
          >
            <div className="flex w-full min-w-0 flex-wrap items-center gap-2">
              {moreActionsChildren}
            </div>
          </MobileToolbarDisclosure>
      </div>
    </div>
  );

  const statusFilterConfig: FilterBarFilter[] = [
    {
      key: 'status',
      label: t('projects.filters.ariaLabel', 'Status filter'),
      kind: 'segment',
      semantics: 'tabs',
      options: [
        { value: 'My Projects', label: filterLabels['My Projects'] },
        { value: 'Ongoing', label: filterLabels['Ongoing'] },
        { value: 'Completed', label: filterLabels['Completed'] },
        { value: 'at-risk', label: filterLabels['at-risk'] },
      ],
    },
  ];

  const handleFilterChange = (key: string, value: string) => {
    if (key === 'status') {
      const nextFilter = (value === '' ? 'All' : value) as StatusFilter;
      setWorkingSet((ws) => ({ ...ws, filter: nextFilter }));
      trackFilterApplied('status', FILTERS.length, 'projects');
    } else if (key === 'q') {
      setSearch(value);
    }
  };

  return {
    mobileToolbar,
    filters: (
      <FilterBar
        searchKey="q"
        searchLabel={t('projects.search.ariaLabel', 'Search projects')}
        searchPlaceholder={t('projects.search.placeholder', 'Search projects…')}
        filters={statusFilterConfig}
        values={{
          q: search,
          status: filter === 'All' ? '' : filter,
        }}
        onChange={handleFilterChange}
        onClear={model.clearFilters}
        shown={filtered.length}
        total={model.all.length}
        // AC-PRJUX-002: the builder below owns the ONE list-wide Clear all (chips, status, search).
        // This bar cannot see the builder's chips, so its own copy would render disabled beside it.
        showClear={false}
        // search_used (2026-07-13 wiring plan): the desktop search lives in this bar, so the
        // surface must be named here or the event stops firing on a wide screen.
        searchSurface="projects-list"
        module="projects"
        labels={{
          all: filterLabels['All'],
          clear: t('projects.mobile.clearAll', 'Clear all'),
        }}
      />
    ),
    // One filter builder: customer, end customer, PM, status, dates, contract value, classification.
    // An Engineer is not offered the manager-browse fields (ProjectFilterBuilder, N19).
    secondaryFilter: builder,
    exportAction: (
        <MobileToolbarDisclosure label={t('uxs14.moreActions', 'More actions')} open={moreOpen} onOpenChange={setMoreOpen}>
          <div className="flex flex-wrap gap-2">
            <ExportButton rows={filtered} disabled={exportDisabled} columns={exportColumns} entity="Projects" label={t('projects.export', 'Export')} />
            <ImportButton entity="project" descriptor={importDescriptor} onImported={() => void refetch()} label={t('projects.import', 'Import')} />
            <ImportButton entity="budgetLine" label={t('projects.importBudgets', 'Import budgets')} descriptor={budgetImportDescriptor} onImported={() => void refetch()} />
          </div>
        </MobileToolbarDisclosure>
    ),
    view: (
        /* All four views remain reachable; DataTable reflows Table into cards below md. */
        <ViewToggle<'table' | 'cards' | 'calendar' | 'kanban'>
          options={[
            {
              value: 'table',
              label: t('projects.view.table', 'Table'),
              icon: 'table',
            },
            { value: 'cards', label: t('projects.view.cards', 'Cards'), icon: 'cards' },
            { value: 'calendar', label: t('projects.view.calendar', 'Calendar'), icon: 'cal' },
            { value: 'kanban', label: t('projects.view.board', 'Board'), icon: 'cols' },
          ]}
          value={view}
          onChange={onViewChange}
          ariaLabel={t('projects.view.ariaLabel', 'Projects view')}
        />
    ),
  };
}
