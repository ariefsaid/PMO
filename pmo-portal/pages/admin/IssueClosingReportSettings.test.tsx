import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { ToastProvider } from '@/src/components/ui';
import type { IssueClosingReportSettings, IssueDepartmentGroup } from '@/src/lib/db/issueClosingReport';

const { settingsState, updateSettingsMutation, groupsState, saveGroupMutation, removeGroupMutation } = vi.hoisted(() => ({
  settingsState: {
    data: { id: 's1', org_id: 'org1', enabled: false, grouping_mode: 'type', updated_at: '2026-01-01T00:00:00Z' } as IssueClosingReportSettings | null,
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  },
  updateSettingsMutation: {
    mutateAsync: vi.fn().mockResolvedValue({}),
    isPending: false,
  },
  groupsState: {
    data: [
      {
        id: 'g1',
        org_id: 'org1',
        name: 'HSE & Safety',
        issue_types: ['Near Miss', 'Injury'],
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
      },
    ] as IssueDepartmentGroup[],
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  },
  saveGroupMutation: {
    mutateAsync: vi.fn().mockResolvedValue({}),
    isPending: false,
  },
  removeGroupMutation: {
    mutateAsync: vi.fn().mockResolvedValue({}),
    isPending: false,
  },
}));

vi.mock('@/src/hooks/useIssueClosingReport', () => ({
  useIssueClosingReportSettings: () => settingsState,
  useUpdateIssueClosingReportSettings: () => updateSettingsMutation,
  useIssueDepartmentGroups: () => groupsState,
  useIssueDepartmentGroupMutations: () => ({
    save: saveGroupMutation,
    remove: removeGroupMutation,
  }),
}));

let mockCanManage = true;
vi.mock('@/src/auth/usePermission', () => ({
  usePermission: () => () => mockCanManage,
}));

import { IssueClosingReportSettings as IssueClosingReportSettingsComp } from './IssueClosingReportSettings';

const renderSettings = () =>
  render(
    <ToastProvider>
      <IssueClosingReportSettingsComp />
    </ToastProvider>,
  );

describe('IssueClosingReportSettings (AC-CTR-006, AC-CTR-007)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCanManage = true;
    settingsState.data = {
      id: 's1',
      org_id: 'org1',
      enabled: false,
      grouping_mode: 'type',
      updated_at: '2026-01-01T00:00:00Z',
    };
    groupsState.data = [
      {
        id: 'g1',
        org_id: 'org1',
        name: 'HSE & Safety',
        issue_types: ['Near Miss', 'Injury'],
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
      },
    ];
  });

  it('renders nothing when user has no permission', () => {
    mockCanManage = false;
    renderSettings();
    expect(screen.queryByRole('heading', { name: /Issue closing-time report/i })).not.toBeInTheDocument();
  });

  it('renders settings card with the grouping choice and department groups, and no on/off switch (on for everyone, #2746)', () => {
    renderSettings();
    expect(screen.getByRole('heading', { level: 2, name: /Issue closing-time report/i })).toBeInTheDocument();
    expect(screen.queryByRole('switch')).not.toBeInTheDocument();
    expect(screen.getByText('HSE & Safety')).toBeInTheDocument();
    expect(screen.getByText('Near Miss, Injury')).toBeInTheDocument();
  });

  it('changes the default grouping', async () => {
    renderSettings();
    await userEvent.selectOptions(screen.getByLabelText('Default grouping'), 'department_groups');

    expect(updateSettingsMutation.mutateAsync).toHaveBeenCalledWith({ grouping_mode: 'department_groups' });
  });

  it('submits a new department group', async () => {
    renderSettings();
    const nameInput = screen.getByLabelText(/Department name/i);
    const typesInput = screen.getByLabelText(/Issue types/i);

    await userEvent.type(nameInput, 'Operations');
    await userEvent.type(typesInput, 'Machinery, Logistics');

    const addBtn = screen.getByRole('button', { name: /Add department group/i });
    await userEvent.click(addBtn);

    expect(saveGroupMutation.mutateAsync).toHaveBeenCalledWith({
      name: 'Operations',
      issue_types: ['Machinery', 'Logistics'],
    });
  });

  it('deletes an existing department group', async () => {
    renderSettings();
    const deleteBtn = screen.getByRole('button', { name: /Delete/i });
    await userEvent.click(deleteBtn);

    expect(removeGroupMutation.mutateAsync).toHaveBeenCalledWith('g1');
  });
});
