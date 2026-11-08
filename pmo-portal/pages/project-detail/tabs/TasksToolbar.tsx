import React from 'react';
import { useTranslation } from 'react-i18next';
import {
  Button,
  Checkbox,
  Icon,
  SelectField,
  TextField,
  ViewToggle,
} from '@/src/components/ui';
import type { TaskStatus } from '@/src/lib/db/tasks';
import { STATUSES, STATUS_OPTIONS } from './taskViewModel';
import type { ProfileRow } from '@/src/lib/db/profiles';

type ViewMode = 'list' | 'board' | 'timeline' | 'calendar';
type TaskScope = 'mine' | 'all';
type BulkAction = 'status' | 'assignee' | 'due' | 'archive' | null;

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
            <div className="relative">
              <Button
                variant="outline"
                size="sm"
                aria-label={t('projectDetail.tasks.moreOptions', 'More task options')}
                aria-haspopup="menu"
                aria-expanded={toolbarMenuOpen}
                onClick={() => setToolbarMenuOpen((open) => !open)}
              >
                <span aria-hidden="true">⋯</span>
              </Button>
              {toolbarMenuOpen && <div role="menu" className="absolute right-0 top-full z-30 mt-1 min-w-[190px] rounded-md border border-border bg-popover p-1 shadow-[0_10px_30px_hsl(240_10%_8%/0.16)]">
                <button role="menuitemcheckbox" aria-checked={showArchived} type="button" className="w-full rounded-sm px-3 py-2 text-left text-sm hover:bg-accent" onClick={() => { setShowArchived((value) => !value); onClearSelection(); setToolbarMenuOpen(false); }}>
                  {showArchived ? t('projectDetail.tasks.hideArchived', 'Hide archived') : t('projectDetail.tasks.showArchived', 'Show archived')}
                </button>
                <button role="menuitem" type="button" className="w-full rounded-sm px-3 py-2 text-left text-sm hover:bg-accent" onClick={() => { setToolbarMenuOpen(false); integrationsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }); }}>
                  {t('projectDetail.tasks.clickUpSettings', 'ClickUp list and sync')}
                </button>
              </div>}
            </div>
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
          <label className="min-w-[128px] flex-1 sm:flex-none">
            <span className="sr-only">{t('projectDetail.tasks.filter.status', 'Filter by status')}</span>
            <select value={statusFilter} onChange={(event) => onStatusFilter(event.target.value as TaskStatus | 'all')} className="h-9 w-full rounded-md border border-input bg-background px-2.5 text-sm text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring">
              <option value="all">{t('projectDetail.tasks.filter.allStatuses', 'All statuses')}</option>
              {STATUSES.map((status) => <option key={status} value={status}>{status}</option>)}
            </select>
          </label>
          <label className="min-w-[144px] flex-1 sm:flex-none">
            <span className="sr-only">{t('projectDetail.tasks.filter.assignee', 'Filter by assignee')}</span>
            <select value={assigneeFilter} onChange={(event) => onAssigneeFilter(event.target.value)} className="h-9 w-full rounded-md border border-input bg-background px-2.5 text-sm text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring">
              <option value="all">{t('projectDetail.tasks.filter.allAssignees', 'All assignees')}</option>
              <option value="unassigned">{t('projectDetail.tasks.filter.unassigned', 'Unassigned')}</option>
              {assignableProfiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.full_name}</option>)}
            </select>
          </label>
          <label className="relative min-w-[160px] flex-1">
            <span className="sr-only">{t('projectDetail.tasks.search', 'Search tasks')}</span>
            <Icon name="search" className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input value={searchText} onChange={(event) => onSearchText(event.target.value)} placeholder={t('projectDetail.tasks.searchPlaceholder', 'Search tasks…')} className="h-9 w-full rounded-md border border-input bg-background pl-8 pr-3 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring" />
          </label>
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
