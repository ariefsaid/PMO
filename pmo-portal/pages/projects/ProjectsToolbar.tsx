import { ProjectFilterFields } from './ProjectFilterFields';
import type { TFunction } from 'i18next';
import { SearchMini, ViewToggle, MobileToolbarDisclosure, Icon, type Column } from '@/src/components/ui';
import { ExportButton } from '@/src/components/export';
import { ImportButton } from '@/src/components/import';
import { trackFilterApplied } from '@/src/lib/analytics';
import type { ProjectWithRefs } from '@/src/lib/db/projects';
import type { ProjectClassificationFilters as ClassificationFilterValues } from '@/src/lib/projectClassification';
import ProjectClassificationFilters from '../../components/ProjectClassificationFilters';
import type { useProjectListModel, StatusFilter } from './useProjectListModel';

const FILTERS: StatusFilter[] = ['All', 'My Projects', 'Ongoing', 'Completed', 'at-risk'];
interface ProjectsToolbarInputs {
  model: ReturnType<typeof useProjectListModel>;
  exportColumns: Column<ProjectWithRefs>[];
  t: TFunction;
  filtersOpen: boolean;
  setFiltersOpen: (open: boolean) => void;
  moreOpen: boolean;
  setMoreOpen: (open: boolean) => void;
}
export function projectsToolbar({ model, exportColumns, t, filtersOpen, setFiltersOpen, moreOpen, setMoreOpen }: ProjectsToolbarInputs) {
  const { isEngineer, workingSet, setWorkingSet, search,
    setSearch, filter, filterClient, filterEndCustomer, filterPM, view, onViewChange, all, filtered, filterLabels,
    customerFilterOptions, endCustomerFilterOptions, pmFilterOptions, importDescriptor, budgetImportDescriptor,
    classificationResetToken, classificationCount, hasNonDefaultFilter, clearFilters, refetch, tasksPending, tasksError } = model;
  const exportDisabled = isEngineer && filter === 'My Projects' && (tasksPending || tasksError);
  const classificationFilterProps = {
    rows: all, value: workingSet, resetToken: classificationResetToken, open: filtersOpen,
    onOpenChange: (next: boolean) => { setFiltersOpen(next); if (next) setMoreOpen(false); },
    onChange: (patch: ClassificationFilterValues) => setWorkingSet((ws) => ({ ...ws, ...patch })),
  };
  // ── Phone-width (below md) mobile toolbar (FR-PRJUX-001) ────────────────
  // Keeps status, search, the selected view, and New project visible while grouping the
  // secondary filters and bulk actions behind named disclosures. Only rendered in the
  // loaded slate. The Table view option is NOT hidden here — DataTable already reflows
  // it into cards.
  const secondaryCount =
    (filterClient !== 'All' ? 1 : 0) + (filterEndCustomer !== 'All' ? 1 : 0) + (filterPM !== 'All' ? 1 : 0);
  const selectedCustomer = customerFilterOptions.find((o) => o.value === filterClient);
  const selectedEndCustomer = endCustomerFilterOptions.find((o) => o.value === filterEndCustomer);
  const selectedPm = pmFilterOptions.find((o) => o.value === filterPM);

  // One count for the one Filters trigger: the manager-browse selects (not offered to an Engineer) plus classifications.
  const filtersCount = (isEngineer ? 0 : secondaryCount) + classificationCount;
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
    <div data-testid="projects-mobile-toolbar" className="w-full min-w-0 space-y-2.5">
      {/* status — bounded horizontal scroller (must stay reachable at 390px) */}
      <div data-testid="status-filter-scroll" className="min-w-0 max-w-full overflow-x-auto scroll-fade-x">
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

      {/* search + selected view */}
      <div className="flex flex-wrap items-center gap-2">
        <SearchMini
          placeholder={t('projects.search.placeholder', 'Search projects…')}
          aria-label={t('projects.search.ariaLabel', 'Search projects')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          searchSurface="projects-list"
          module="projects"
          resultCount={filtered.length}
          containerClassName="min-w-0 flex-1 basis-40"
        />
        {/* The 4-option view toggle can exceed a 360px row; keep it reachable within the
            toolbar without page bleed — it scrolls inside this bounded container. */}
        <div data-testid="projects-mobile-view-scroll" className="ml-auto min-w-0 max-w-full overflow-x-auto">
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
          />
        </div>
      </div>

      {/* filters + more actions disclosures */}
      <div className="flex flex-wrap items-center gap-2">
        <ProjectClassificationFilters
          {...classificationFilterProps}
          panel={(fields, disclosure) => (
            <MobileToolbarDisclosure
              label={t('uxs14.filters', 'Filters')}
              count={filtersCount}
              open={disclosure.open}
              closeOnSelectChange
              onOpenChange={disclosure.onOpenChange}
            >
              <div className="w-full min-w-0 space-y-3">
                {!isEngineer && <ProjectFilterFields model={model} t={t} mobile />}
                {fields}
              </div>
            </MobileToolbarDisclosure>
          )}
        />

          <MobileToolbarDisclosure
            label={t('uxs14.moreActions', 'More actions')}
            open={moreOpen}
            onOpenChange={(next) => {
              setMoreOpen(next);
              if (next) setFiltersOpen(false);
            }}
          >
            <div className="flex w-full min-w-0 flex-wrap items-center gap-2">
              {moreActionsChildren}
            </div>
          </MobileToolbarDisclosure>
      </div>

      {/* active secondary-filter chips + Clear all (AC-PRJUX-002) */}
      {hasNonDefaultFilter && (
        <div
          data-testid="active-filter-chips"
          aria-label={t('projects.mobile.activeCount', 'Active filters')}
          className="flex flex-wrap items-center gap-2"
        >
          {filterClient !== 'All' && (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-secondary/60 py-0.5 pl-2.5 pr-1 text-[12px]">
              <span className="font-medium text-muted-foreground">
                {t('projects.mobile.customer', 'Customer')}: {selectedCustomer?.label ?? t('projects.mobile.unavailable', 'Unavailable selection')}
              </span>
              <button
                type="button"
                aria-label={`${t('projects.mobile.removeCustomer', 'Remove customer filter')}: ${selectedCustomer?.label ?? t('projects.mobile.unavailable', 'Unavailable selection')}`}
                className="grid size-[18px] place-items-center rounded-full hover:bg-accent"
                onClick={() => setWorkingSet((ws) => ({ ...ws, client: 'All' }))}
              >
                <Icon name="x" className="size-3" />
              </button>
            </span>
          )}
          {filterPM !== 'All' && (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-secondary/60 py-0.5 pl-2.5 pr-1 text-[12px]">
              <span className="font-medium text-muted-foreground">
                {t('projects.mobile.manager', 'Project manager')}: {selectedPm?.label ?? t('projects.mobile.unavailable', 'Unavailable selection')}
              </span>
              <button
                type="button"
                aria-label={`${t('projects.mobile.removeManager', 'Remove project manager filter')}: ${selectedPm?.label ?? t('projects.mobile.unavailable', 'Unavailable selection')}`}
                className="grid size-[18px] place-items-center rounded-full hover:bg-accent"
                onClick={() => setWorkingSet((ws) => ({ ...ws, pm: 'All' }))}
              >
                <Icon name="x" className="size-3" />
              </button>
            </span>
          )}
          {filterEndCustomer !== 'All' && (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-secondary/60 py-0.5 pl-2.5 pr-1 text-[12px]">
              <span className="font-medium text-muted-foreground">
                {t('projects.mobile.endCustomer', 'End customer')}: {selectedEndCustomer?.label ?? t('projects.mobile.unavailable', 'Unavailable selection')}
              </span>
              <button
                type="button"
                aria-label={`${t('projects.mobile.removeEndCustomer', 'Remove end customer filter')}: ${selectedEndCustomer?.label ?? t('projects.mobile.unavailable', 'Unavailable selection')}`}
                className="grid size-[18px] place-items-center rounded-full hover:bg-accent"
                onClick={() => setWorkingSet((ws) => ({ ...ws, endClient: 'All' }))}
              >
                <Icon name="x" className="size-3" />
              </button>
            </span>
          )}
          <button
            type="button"
            onClick={clearFilters}
            className="text-[12.5px] font-semibold text-primary-text underline-offset-2 hover:underline"
          >
            {t('projects.mobile.clearAll', 'Clear all')}
          </button>
        </div>
      )}
    </div>
  );

  return {
    mobileToolbar,
    desktopToolbarClassName: "xl:grid xl:grid-cols-[minmax(0,1fr)_220px_auto] xl:items-center xl:gap-x-2 xl:gap-y-2 xl:overflow-visible xl:[&>*:nth-child(1)]:col-start-1 xl:[&>*:nth-child(1)]:row-start-1 xl:[&>*:nth-child(2)]:col-start-2 xl:[&>*:nth-child(2)]:row-start-1 xl:[&>*:nth-child(3)]:col-start-1 xl:[&>*:nth-child(3)]:row-start-2 xl:[&>*:nth-child(4)]:col-start-2 xl:[&>*:nth-child(4)]:row-start-2 xl:[&>*:nth-child(5)]:col-start-3 xl:[&>*:nth-child(5)]:row-span-2",
    filters: (
        /* AC-2: wrap in overflow-x-auto so the full filter strip (incl. "At risk") is
           reachable at 390px without clipping. scroll-fade-x adds the right-edge fade
           affordance (the project tab strip pattern). */
        <div data-testid="status-filter-scroll" className="min-w-0 max-w-full overflow-x-auto scroll-fade-x">
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
    ),
    search: (
        <SearchMini
          placeholder={t('projects.search.placeholder', 'Search projects…')}
          aria-label={t('projects.search.ariaLabel', 'Search projects')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          searchSurface="projects-list"
          module="projects"
          resultCount={filtered.length}
          containerClassName="max-sm:basis-full max-sm:w-full max-sm:min-w-0"
        />
    ),
    secondaryFilter: (
        /*
          N19 (AC-IXD-PIPE-W5-C5): The customer and PM filter dropdowns are manager-browse
          tools — an Engineer manages no projects and cares only about their assigned work.
          For the Engineer scope they are hidden so the toolbar leads with the relevant
          SegFilter (already defaulted to "My Projects" per B-11). The classification fields
          stay: ONE Filters trigger holds every secondary filter (FE-only on effectiveRole).
        */
        <ProjectClassificationFilters
          {...classificationFilterProps}
          panel={(fields, disclosure) => (
            <MobileToolbarDisclosure
              label={t('uxs14.filters', 'Filters')}
              count={filtersCount}
              open={disclosure.open}
              onOpenChange={disclosure.onOpenChange}
            >
              <div className="flex min-w-0 flex-col gap-3">
                {!isEngineer && <ProjectFilterFields model={model} t={t} mobile={false} />}
                {fields}
              </div>
            </MobileToolbarDisclosure>
          )}
        />
    ),
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
