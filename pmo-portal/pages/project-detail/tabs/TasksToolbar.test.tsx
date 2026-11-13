/**
 * Form B (fanout round 1, A9): the tasks toolbar's status/assignee filters and its search field are
 * the shared form controls (SelectField / TextField), and they keep exactly the values and change
 * behaviour the raw `<select>` / `<input>` had. The guard (scripts/check-ui-system.mjs) refuses a
 * raw control in app source; these tests prove the migration did not change what a person does.
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';

import TasksToolbar from './TasksToolbar';
import type { ViewMode, TaskScope, BulkAction } from './taskViewModel';
import type { TaskStatus } from '@/src/lib/db/tasks';

const baseProps = () => ({
  heading: 'Tasks',
  toolbarMenuOpen: false,
  setToolbarMenuOpen: vi.fn(),
  showArchived: false,
  setShowArchived: vi.fn(),
  onClearSelection: vi.fn(),
  integrationsRef: { current: null },
  canCreate: true,
  onNewTask: vi.fn(),
  scope: 'mine' as TaskScope,
  setTaskScope: vi.fn(),
  statusFilter: 'all' as TaskStatus | 'all',
  onStatusFilter: vi.fn(),
  assigneeFilter: 'all',
  onAssigneeFilter: vi.fn(),
  searchText: '',
  onSearchText: vi.fn(),
  view: 'list' as ViewMode,
  setTaskView: vi.fn(),
  state: undefined as 'loading' | 'empty' | 'error' | undefined,
  assignableProfiles: [
    { id: 'u2', full_name: 'Sam Member' },
    { id: 'u3', full_name: 'Ada Planner' },
  ] as never,
  selectedCount: 0,
  canBulkStatus: false,
  canBulkEdit: false,
  canBulkArchive: false,
  bulkAction: null as BulkAction,
  setBulkAction: vi.fn(),
  canApplyBulk: false,
  bulkStatus: '' as TaskStatus | '',
  setBulkStatus: vi.fn(),
  bulkAssignee: '',
  setBulkAssignee: vi.fn(),
  bulkDueDate: '',
  setBulkDueDate: vi.fn(),
  bulkClearDueDate: false,
  setBulkClearDueDate: vi.fn(),
  bulkPending: false,
  onApplyBulk: vi.fn(),
  selectedActiveCount: 0,
});

const renderToolbar = (overrides: Partial<ReturnType<typeof baseProps>> = {}) => {
  const props = { ...baseProps(), ...overrides };
  render(<TasksToolbar {...props} />);
  return props;
};

describe('TasksToolbar — form B shared controls', () => {
  it('the status filter keeps its label, options and change behaviour', async () => {
    const props = renderToolbar();
    const select = screen.getByRole('combobox', { name: 'Filter by status' });
    expect(select).toHaveValue('all');
    expect(screen.getByRole('option', { name: 'All statuses' })).toBeInTheDocument();
    await userEvent.selectOptions(select, 'Done');
    expect(props.onStatusFilter).toHaveBeenCalledWith('Done');
  });

  it('the assignee filter keeps its label, the unassigned choice and change behaviour', async () => {
    const props = renderToolbar();
    const select = screen.getByRole('combobox', { name: 'Filter by assignee' });
    expect(select).toHaveValue('all');
    expect(screen.getByRole('option', { name: 'Unassigned' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Sam Member' })).toBeInTheDocument();
    await userEvent.selectOptions(select, 'unassigned');
    expect(props.onAssigneeFilter).toHaveBeenCalledWith('unassigned');
  });

  it('the search field keeps its accessible name, value and change behaviour', async () => {
    const props = renderToolbar({ searchText: 'slab' });
    const search = screen.getByRole('textbox', { name: 'Search tasks' });
    expect(search).toHaveValue('slab');
    await userEvent.type(search, '!');
    expect(props.onSearchText).toHaveBeenCalled();
  });

  it('a status filter value on the screen is what the control shows', () => {
    renderToolbar({ statusFilter: 'Blocked' });
    expect(screen.getByRole('combobox', { name: 'Filter by status' })).toHaveValue('Blocked');
  });

  it('the view toggle still switches the list to board', async () => {
    const props = renderToolbar();
    // ViewToggle defaults to tabs semantics (role=tab inside the "Task view" tablist).
    await userEvent.click(screen.getByRole('tab', { name: 'Board' }));
    expect(props.setTaskView).toHaveBeenCalledWith('board');
  });
});
