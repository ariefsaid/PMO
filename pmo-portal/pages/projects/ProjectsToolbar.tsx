import { ProjectFilterBuilder } from './ProjectFilterBuilder';
import type { TFunction } from 'i18next';
import { SearchMini, ViewToggle, MobileToolbarDisclosure, type Column, type IconName } from '@/src/components/ui';
import { ExportButton } from '@/src/components/export';
import { ImportButton } from '@/src/components/import';
import { trackFilterApplied } from '@/src/lib/analytics';
import type { ProjectWithRefs } from '@/src/lib/db/projects';
import type { useProjectListModel, StatusFilter } from './useProjectListModel';
import type { ProjectView } from '@/src/hooks/useProjectView';

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

  const viewOptions: { value: ProjectView; label: string; icon: IconName }[] = [
    { value: 'table', label: t('projects.view.table', 'Table'), icon: 'table' },
    { value: 'cards', label: t('projects.view.cards', 'Cards'), icon: 'cards' },
    { value: 'calendar', label: t('projects.view.calendar', 'Calendar'), icon: 'cal' },
    { value: 'kanban', label: t('projects.view.board', 'Board'), icon: 'cols' },
  ];
  const statusSegment = (className?: string) => (
    <ViewToggle<StatusFilter>
      className={className}
      options={FILTERS.map((f) => ({ value: f, label: filterLabels[f] }))}
      value={filter}
      onChange={(v) => {
        setWorkingSet((ws) => ({ ...ws, filter: v }));
        trackFilterApplied('status', FILTERS.length, 'projects');
      }}
      ariaLabel={t('projects.filters.ariaLabel', 'Status filter')}
      semantics="tabs"
    />
  );
  const searchField = (className: string) => (
    <SearchMini
      placeholder={t('projects.search.placeholder', 'Search projects…')}
      aria-label={t('projects.search.ariaLabel', 'Search projects')}
      value={search}
      onChange={(e) => setSearch(e.target.value)}
      searchSurface="projects-list"
      module="projects"
      resultCount={filtered.length}
      containerClassName={className}
    />
  );
  const showing = t('ui.listPage.showingOf', 'Showing {{count}} of {{total}}', { count: filtered.length, total: model.all.length });

  // Phone and tablet: the status segment scrolls on its own row; search, filters and the list options
  // (view, export, import) share the next row, so the first project starts right below.
  const mobileToolbar = (
    <div data-testid="projects-mobile-toolbar" className="flex w-full min-w-0 flex-col gap-2">
      <div data-testid="status-filter-scroll" className="min-w-0 max-w-full overflow-x-auto scroll-fade-x [&_button]:whitespace-nowrap">
        {statusSegment()}
      </div>
      <div className="flex min-w-0 flex-wrap items-start gap-2">
        <div data-testid="projects-mobile-search-row" className="min-w-[8rem] flex-1">
          {searchField('w-full min-w-0')}
        </div>
        <div data-testid="projects-mobile-filters" className="min-w-0 max-w-full">{builder}</div>
        <MobileToolbarDisclosure
          label={t('projects:listOptions', 'Options')}
          open={moreOpen}
          onOpenChange={setMoreOpen}
          className="relative"
          panelClassName="absolute right-0 top-full z-20 mt-1 w-[min(20rem,calc(100vw-2rem))] rounded-lg border border-border bg-card p-3 shadow-md"
        >
          <div className="flex w-full min-w-0 flex-col gap-3">
            <div data-testid="projects-mobile-view-scroll" className="min-w-0 max-w-full overflow-x-auto">
              <ViewToggle<ProjectView>
                options={viewOptions}
                value={view}
                onChange={(v) => { onViewChange(v); setMoreOpen(false); }}
                ariaLabel={t('projects.view.ariaLabel', 'Projects view')}
              />
            </div>
            <div className="flex w-full min-w-0 flex-wrap items-center gap-2">
              {moreActionsChildren}
            </div>
          </div>
        </MobileToolbarDisclosure>
      </div>
      <p data-testid="projects-mobile-count" className="sr-only" aria-live="polite">{showing}</p>
    </div>
  );

  // Desktop: ONE row — search, status, Add filter and its chips, "Showing x of y" at the right edge.
  const desktopRow = (
    <div data-testid="projects-toolbar-row" className="flex w-full min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
      {searchField('h-[var(--control-height-sm)] w-56 shrink-0')}
      <div data-testid="status-filter-scroll" className="min-w-0 max-w-full">{/* Desktop: the segment wraps rather than scrolls, so every status stays in view. */}{statusSegment('flex-wrap')}</div>
      <div className="min-w-0 flex-1">{builder}</div>
      <span aria-live="polite" className="ml-auto shrink-0 text-control text-muted-foreground">{showing}</span>
    </div>
  );

  // The list's own menu (export and imports) — named apart from the record's "Project actions".
  const listMenu = (
    <MobileToolbarDisclosure
      label={t('projects:exportImport', 'Export and import')}
      open={moreOpen}
      onOpenChange={setMoreOpen}
      className="relative"
      panelClassName="absolute right-0 top-full z-20 mt-1 rounded-lg border border-border bg-card p-3 shadow-md"
    >
      <div className="flex flex-col items-stretch gap-2">
        <ExportButton rows={filtered} disabled={exportDisabled} columns={exportColumns} entity="Projects" label={t('projects.export', 'Export')} onExport={() => setMoreOpen(false)} />
        <ImportButton entity="project" descriptor={importDescriptor} onImported={() => void refetch()} label={t('projects.import', 'Import')} />
        <ImportButton entity="budgetLine" label={t('projects.importBudgets', 'Import budgets')} descriptor={budgetImportDescriptor} onImported={() => void refetch()} />
      </div>
    </MobileToolbarDisclosure>
  );
  const viewSwitch = (
    <ViewToggle<ProjectView>
      options={viewOptions}
      value={view}
      onChange={onViewChange}
      ariaLabel={t('projects.view.ariaLabel', 'Projects view')}
    />
  );

  return {
    mobileToolbar,
    mobileToolbarClassName: 'border-0! bg-transparent! px-0! py-0!',
    desktopToolbarClassName: 'md:grid-cols-1!',
    filters: desktopRow,
    /** The header line's controls: view switcher and the list menu, before the primary action. */
    headerControls: (
      <span data-testid="projects-header-controls" className="flex items-center gap-2">
        {viewSwitch}
        {listMenu}
      </span>
    ),
  };
}
