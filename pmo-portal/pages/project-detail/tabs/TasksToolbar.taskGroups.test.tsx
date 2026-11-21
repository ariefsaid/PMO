/** AC-TGM-010 (#2679): the Tasks toolbar offers "Task groups" only when the tab passes the manager handler. */
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
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
  workOrderFilter: 'all', onWorkOrderFilter: vi.fn(), workOrderOptions: [],
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


const renderOpen = (extra: Record<string, unknown> = {}) =>
  render(<TasksToolbar {...baseProps()} toolbarMenuOpen {...extra} />);

describe('TasksToolbar — task groups entry', () => {
  it('AC-TGM-010: no Task groups item without the manager handler (Tasks tab unchanged)', () => {
    renderOpen();
    expect(screen.queryByText('Task groups')).not.toBeInTheDocument();
  });

  it('AC-TGM-010: the Task groups item appears for a manager and calls the handler', async () => {
    const onManageTaskGroups = vi.fn();
    renderOpen({ onManageTaskGroups });
    screen.getByText('Task groups').click();
    expect(onManageTaskGroups).toHaveBeenCalled();
  });
});
