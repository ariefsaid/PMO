import type { TFunction } from 'i18next';
import { SearchMini, ViewToggle, MobileToolbarDisclosure, type Column } from '@/src/components/ui';
import { ExportButton } from '@/src/components/export';
import { ImportButton } from '@/src/components/import';
import { trackFilterApplied } from '@/src/lib/analytics';
import type { ProjectWithRefs } from '@/src/lib/db/projects';
import type { useProjectListModel, StatusFilter } from './useProjectListModel';
import { ProjectFilterBuilder } from './ProjectFilterBuilder';

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
  const count = t('ui.listPage.showingOf', 'Showing {{count}} of {{total}}', {
    count: filtered.length,
    total: model.all.length,
  });
  const onStatusChange = (next: StatusFilter) => {
    setWorkingSet((ws) => ({ ...ws, filter: next }));
    trackFilterApplied('status', FILTERS.length, 'projects');
  };

  const statusFilter = (
    <ViewToggle<StatusFilter>
      options={FILTERS.map((value) => ({ value, label: filterLabels[value] }))}
      value={filter}
      onChange={onStatusChange}
      ariaLabel={t('projects.filters.ariaLabel', 'Status filter')}
      semantics="tabs"
      className="min-w-max p-0 [&_button]:min-h-[var(--control-height-sm)] [&_button]:whitespace-nowrap [&_button]:py-0"
    />
  );
  const viewToggle = (
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
      className="min-w-max [&_button]:min-h-[var(--control-height)] [&_button]:py-1.5"
    />
  );

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
    // stays mounted for its own lifecycle (DD-BIMP-3); no close is wired here.
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
  const moreActionsLabel = t('uxs14.moreActions', 'More actions');
  const moreActions = (
    <MobileToolbarDisclosure label={moreActionsLabel} open={moreOpen} onOpenChange={setMoreOpen}>
      <div className="flex w-full min-w-0 flex-wrap items-center gap-2">
        {moreActionsChildren}
      </div>
    </MobileToolbarDisclosure>
  );

  const mobileToolbar = (
    <div data-testid="projects-mobile-toolbar" className="flex w-full min-w-0 flex-col gap-2">
      <div data-testid="projects-mobile-toolbar-row" className="flex min-w-0 items-center gap-2">
        <SearchMini
          placeholder={t('projects.search.placeholder', 'Search projects…')}
          aria-label={t('projects.search.ariaLabel', 'Search projects')}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          searchSurface="projects-list"
          module="projects"
          resultCount={filtered.length}
          containerClassName="h-[var(--control-height-sm)] min-w-0 flex-1 max-sm:min-h-11"
        />
        <p data-testid="projects-mobile-count" className="shrink-0 text-control text-muted-foreground" aria-live="polite">
          {count}
        </p>
      </div>

      <div className="flex min-w-0 items-center gap-2">
        <div data-testid="status-filter-scroll" className="min-w-0 flex-1 overflow-x-auto scroll-fade-x [&_button]:whitespace-nowrap">
          {statusFilter}
        </div>
        <div className="shrink-0">
          <MobileToolbarDisclosure label={moreActionsLabel} open={moreOpen} onOpenChange={setMoreOpen}>
            <div className="flex w-full min-w-0 flex-wrap items-center gap-2">
              {viewToggle}
              {moreActionsChildren}
            </div>
          </MobileToolbarDisclosure>
        </div>
      </div>

      <div data-testid="projects-mobile-filters" className="min-w-0">
        {builder}
      </div>
    </div>
  );

  return {
    mobileToolbar,
    // One desktop row carries the search, status, builder/chips and result count.
    filters: (
      <div data-testid="projects-toolbar-row" className="flex min-w-0 items-center gap-2">
        <SearchMini
          placeholder={t('projects.search.placeholder', 'Search projects…')}
          aria-label={t('projects.search.ariaLabel', 'Search projects')}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          searchSurface="projects-list"
          module="projects"
          resultCount={filtered.length}
          containerClassName="h-[var(--control-height-sm)] w-60 shrink-0"
        />
        <div data-testid="status-filter-scroll" className="min-w-0 shrink-0 overflow-x-auto scroll-fade-x">
          {statusFilter}
        </div>
        <div className="min-w-0 flex-1">{builder}</div>
        <p className="shrink-0 text-control text-muted-foreground" aria-live="polite">{count}</p>
      </div>
    ),
    headerActions: (
      <div className="flex min-w-0 items-center gap-2">
        {viewToggle}
        {moreActions}
      </div>
    ),
  };
}
