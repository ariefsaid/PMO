import React from 'react';
import { scrollBehavior } from '@/src/lib/motion';
import { Menu } from '@/src/components/ui/menu';
import { cn } from '@/src/components/ui/cn';
import { menuItemClass, menuPopupClass, menuPopupOrigin } from '@/src/components/ui/menuStyles';
import { useTranslation } from 'react-i18next';
import {
  Button,
  Checkbox,
  Icon,
  SearchMini,
  SelectField,
  TextField,
  ViewToggle,
} from '@/src/components/ui';
import type { TaskStatus } from '@/src/lib/db/tasks';
import { STATUSES, STATUS_OPTIONS, type ViewMode, type TaskScope, type BulkAction } from './taskViewModel';
import type { ProfileRow } from '@/src/lib/db/profiles';


/** The tasks toolbar: heading, more-options menu, filters, search, view toggle and the bulk bars. */
const TasksToolbar: React.FC<{
  heading: string;
  toolbarMenuOpen: boolean;
  setToolbarMenuOpen: React.Dispatch<React.SetStateAction<boolean>>;
  showArchived: boolean;
  setShowArchived: React.Dispatch<React.SetStateAction<boolean>>;
  onClearSelection: () => void;
  integrationsRef: React.RefObject<HTMLDivElement | null>;
  canCreate: boolean;
  onNewTask: () => void;
  scope: TaskScope;
  setTaskScope: (scope: TaskScope) => void;
  statusFilter: TaskStatus | 'all';
  onStatusFilter: (value: TaskStatus | 'all') => void;
  assigneeFilter: string;
  onAssigneeFilter: (value: string) => void;
  searchText: string;
  onSearchText: (value: string) => void;
  view: ViewMode;
  setTaskView: (view: ViewMode) => void;
  state: 'loading' | 'empty' | 'error' | undefined;
  assignableProfiles: ProfileRow[];
  selectedCount: number;
  canBulkStatus: boolean;
  canBulkEdit: boolean;
  canBulkArchive: boolean;
  bulkAction: BulkAction;
  setBulkAction: React.Dispatch<React.SetStateAction<BulkAction>>;
  canApplyBulk: boolean;
  bulkStatus: TaskStatus | '';
  setBulkStatus: React.Dispatch<React.SetStateAction<TaskStatus | ''>>;
  bulkAssignee: string;
  setBulkAssignee: React.Dispatch<React.SetStateAction<string>>;
  bulkDueDate: string;
  setBulkDueDate: React.Dispatch<React.SetStateAction<string>>;
  bulkClearDueDate: boolean;
  setBulkClearDueDate: React.Dispatch<React.SetStateAction<boolean>>;
  bulkPending: boolean;
  onApplyBulk: () => void;
  selectedActiveCount: number;
}> = ({
  heading,
  toolbarMenuOpen,
  setToolbarMenuOpen,
  showArchived,
  setShowArchived,
  onClearSelection,
  integrationsRef,
  canCreate,
  onNewTask,
  scope,
  setTaskScope,
  statusFilter,
  onStatusFilter,
  assigneeFilter,
  onAssigneeFilter,
  searchText,
  onSearchText,
  view,
  setTaskView,
  state,
  assignableProfiles,
  selectedCount,
  canBulkStatus,
  canBulkEdit,
  canBulkArchive,
  bulkAction,
  setBulkAction,
  canApplyBulk,
  bulkStatus,
  setBulkStatus,
  bulkAssignee,
  setBulkAssignee,
  bulkDueDate,
  setBulkDueDate,
  bulkClearDueDate,
  setBulkClearDueDate,
  bulkPending,
  onApplyBulk,
  selectedActiveCount,
}) => {
  const { t } = useTranslation('project');
  return (
    <>
      <div className="mb-3.5 flex flex-col gap-3 p-[var(--panel-inset)]">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-page font-bold tracking-[-0.02em]">{heading}</h2>
          <div className="flex items-center gap-2">
            <Menu.Root open={toolbarMenuOpen} onOpenChange={setToolbarMenuOpen}>
              <Menu.Trigger render={<Button variant="outline" size="sm" />} aria-label={t('projectDetail.tasks.moreOptions', 'More task options')}>
                <span aria-hidden="true">⋯</span>
              </Menu.Trigger>
              <Menu.Portal>
                <Menu.Positioner side="bottom" align="end" sideOffset={4} collisionPadding={12} className="z-50">
                  <Menu.Popup className={cn(menuPopupClass, 'min-w-[190px]')} style={menuPopupOrigin}>
                    <Menu.CheckboxItem checked={showArchived} onCheckedChange={() => { setShowArchived((value) => !value); onClearSelection(); }} className={menuItemClass}>
                      {showArchived ? t('projectDetail.tasks.hideArchived', 'Hide archived') : t('projectDetail.tasks.showArchived', 'Show archived')}
                    </Menu.CheckboxItem>
                    <Menu.Item onClick={() => integrationsRef.current?.scrollIntoView({ behavior: scrollBehavior(), block: 'center' })} className={menuItemClass}>
                      {t('projectDetail.tasks.clickUpSettings', 'ClickUp list and sync')}
                    </Menu.Item>
                  </Menu.Popup>
                </Menu.Positioner>
              </Menu.Portal>
            </Menu.Root>
            {canCreate && <Button variant="outline" size="sm" onClick={onNewTask}>
              <Icon name="plus" />{t('projectDetail.tasks.newTask', 'New task')}
            </Button>}
          </div>
        </div>

        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <ViewToggle<TaskScope>
            options={[
              { value: 'mine', label: t('projectDetail.tasks.scope.mine', 'Mine') },
              { value: 'all', label: t('projectDetail.tasks.scope.all', 'All') },
            ]}
            value={scope}
            onChange={setTaskScope}
            ariaLabel={t('projectDetail.tasks.scopeAriaLabel', 'Task scope')}
            semantics="toggle"
          />
          <div className="min-w-[128px] flex-1 sm:flex-none">
            <SelectField
              id="tasks-filter-status"
              hideLabel
              label={t('projectDetail.tasks.filter.status', 'Filter by status')}
              value={statusFilter}
              onChange={(value) => onStatusFilter(value as TaskStatus | 'all')}
              options={[
                { value: 'all', label: t('projectDetail.tasks.filter.allStatuses', 'All statuses') },
                ...STATUSES.map((status) => ({ value: status, label: status })),
              ]}
            />
          </div>
          <div className="min-w-[144px] flex-1 sm:flex-none">
            <SelectField
              id="tasks-filter-assignee"
              hideLabel
              label={t('projectDetail.tasks.filter.assignee', 'Filter by assignee')}
              value={assigneeFilter}
              onChange={onAssigneeFilter}
              options={[
                { value: 'all', label: t('projectDetail.tasks.filter.allAssignees', 'All assignees') },
                { value: 'unassigned', label: t('projectDetail.tasks.filter.unassigned', 'Unassigned') },
                ...assignableProfiles.map((profile) => ({ value: profile.id, label: profile.full_name })),
              ]}
            />
          </div>
          <div className="min-w-[160px] flex-1">
            {/* F6: the shared list-toolbar search (SearchMini) — same shell, magnifier and
                searchbox role the FilterBar/DataTable toolbars give. TextField has no leading
                icon, and inventing a second search look is exactly what the picture sitting caught. */}
            <SearchMini
              aria-label={t('projectDetail.tasks.search', 'Search tasks')}
              placeholder={t('projectDetail.tasks.searchPlaceholder', 'Search tasks…')}
              value={searchText}
              onChange={(event) => onSearchText(event.target.value)}
              containerClassName="sm:min-w-0"
            />
          </div>
          {state !== 'loading' && state !== 'error' && state !== 'empty' && <ViewToggle<ViewMode>
            options={[
              { value: 'list', label: t('projectDetail.tasks.view.list', 'List') },
              { value: 'board', label: t('projectDetail.tasks.view.board', 'Board') },
              { value: 'timeline', label: t('projectDetail.tasks.view.timeline', 'Timeline') },
              { value: 'calendar', label: t('projectDetail.tasks.view.calendar', 'Calendar') },
            ]}
            value={view}
            onChange={setTaskView}
            ariaLabel={t('projectDetail.tasks.viewAriaLabel', 'Task view')}
          />}
        </div>
        {view === 'list' && selectedCount > 0 && <div role="group" aria-label={t('projectDetail.tasks.bulk.actions', 'Bulk task actions')} className="flex min-w-0 flex-wrap items-center gap-2 rounded-md border border-border bg-secondary/30 px-3 py-2">
          <span aria-live="polite" className="mr-1 text-sm font-medium text-foreground">{t('projectDetail.tasks.bulk.selected', '{{count}} selected', { count: selectedCount })}</span>
          {canBulkStatus && <Button variant="outline" size="sm" aria-pressed={bulkAction === 'status'} onClick={() => { setBulkStatus(''); setBulkAction((current) => current === 'status' ? null : 'status'); }}>{t('projectDetail.tasks.bulk.changeStatus', 'Change status')}</Button>}
          {canBulkEdit && <Button variant="outline" size="sm" aria-pressed={bulkAction === 'assignee'} onClick={() => { setBulkAssignee(''); setBulkAction((current) => current === 'assignee' ? null : 'assignee'); }}>{t('projectDetail.tasks.bulk.reassign', 'Reassign')}</Button>}
          {canBulkEdit && <Button variant="outline" size="sm" aria-pressed={bulkAction === 'due'} onClick={() => { setBulkDueDate(''); setBulkClearDueDate(false); setBulkAction((current) => current === 'due' ? null : 'due'); }}>{t('projectDetail.tasks.bulk.changeDueDate', 'Change due date')}</Button>}
          {canBulkArchive && <Button variant="outline" size="sm" aria-pressed={bulkAction === 'archive'} onClick={() => setBulkAction((current) => current === 'archive' ? null : 'archive')}>{t('projectDetail.tasks.bulk.archive', 'Archive')}</Button>}
          <Button variant="ghost" size="sm" onClick={onClearSelection}>{t('projectDetail.tasks.bulk.clearSelection', 'Clear selection')}</Button>
        </div>}
        {view === 'list' && bulkAction && canApplyBulk && selectedCount > 0 && <div className="flex min-w-0 flex-wrap items-end gap-2 rounded-md border border-border bg-card px-3 py-2.5">
          {bulkAction === 'status' && <SelectField
            hideLabel
            label={t('projectDetail.tasks.bulk.statusLabel', 'New status for selected tasks')}
            value={bulkStatus}
            onChange={(value) => setBulkStatus(value as TaskStatus | '')}
            options={[{ value: '', label: t('projectDetail.tasks.bulk.chooseStatus', 'Choose a status') }, ...STATUS_OPTIONS]}
          />}
          {bulkAction === 'assignee' && <SelectField
            hideLabel
            label={t('projectDetail.tasks.bulk.assigneeLabel', 'Assignee for selected tasks')}
            value={bulkAssignee}
            onChange={setBulkAssignee}
            options={[{ value: '', label: t('projectDetail.tasks.bulk.chooseAssignee', 'Choose an assignee') }, { value: '__unassigned__', label: t('projectDetail.tasks.unassigned', 'Unassigned') }, ...assignableProfiles.map((profile) => ({ value: profile.id, label: profile.full_name }))]}
          />}
          {bulkAction === 'due' && <>
            <TextField
              label={t('projectDetail.tasks.bulk.dueDateLabel', 'Due date for selected tasks')}
              type="date"
              value={bulkDueDate}
              onChange={(value) => { setBulkDueDate(value); setBulkClearDueDate(false); }}
              disabled={bulkClearDueDate}
            />
            <label className="inline-flex items-center gap-2 pb-2 text-sm text-muted-foreground">
              <Checkbox checked={bulkClearDueDate} onChange={(checked) => { setBulkClearDueDate(checked); if (checked) setBulkDueDate(''); }} label={t('projectDetail.tasks.bulk.clearDueDate', 'Clear due date')} />
            </label>
          </>}
          {bulkAction === 'archive' && <p className="mr-auto text-sm text-muted-foreground">{t('projectDetail.tasks.bulk.archiveHelp', 'Archive {{count}} active selected tasks.', { count: selectedActiveCount })}</p>}
          <Button variant="primary" size="sm" disabled={bulkPending || (bulkAction === 'status' && !bulkStatus) || (bulkAction === 'assignee' && !bulkAssignee) || (bulkAction === 'due' && !bulkDueDate && !bulkClearDueDate)} onClick={onApplyBulk}>
            {bulkPending ? t('projectDetail.tasks.bulk.applying', 'Applying…') : t('projectDetail.tasks.bulk.apply', 'Apply')}
          </Button>
          <Button variant="ghost" size="sm" disabled={bulkPending} onClick={() => setBulkAction(null)}>{t('projectDetail.tasks.bulk.cancel', 'Cancel')}</Button>
        </div>}
      </div>
    </>
  );
};

export default TasksToolbar;
