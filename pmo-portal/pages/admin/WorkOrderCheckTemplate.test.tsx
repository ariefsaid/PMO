/** #2898 — Administration › Projects › the standard checks for a new work order: an Admin edits the whole ordered list. */
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from '@/src/components/ui';

const h = vi.hoisted(() => ({ canManage: true, listTemplate: vi.fn(), saveTemplate: vi.fn() }));
vi.mock('@/src/lib/repositories', () => ({ repositories: { workOrderCheckTemplate: { list: h.listTemplate, save: h.saveTemplate } } }));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 'u', org_id: 'o' } }) }));
vi.mock('@/src/auth/usePermission', () => ({ usePermission: () => () => h.canManage }));
import WorkOrderCheckTemplate from './WorkOrderCheckTemplate';

beforeEach(() => {
  vi.clearAllMocks();
  h.canManage = true;
  h.listTemplate.mockResolvedValue([{ id: 'a', label: 'First check', position: 1, owner_job_role: 'engineer', target_days: 3 }, { id: 'b', label: 'Second check', position: 2, owner_job_role: 'hr_officer', target_days: 5 }]);
  h.saveTemplate.mockResolvedValue(2);
});
const renderEditor = () => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><ToastProvider><WorkOrderCheckTemplate /></ToastProvider></QueryClientProvider>);

describe('AC-WOC-001 standard checks editor', () => {
  it('offers only manager and officer job roles: a field account cannot own a check', async () => {
    renderEditor();
    const picker = await screen.findByLabelText('Job role for check 1');
    const values = Array.from(picker.querySelectorAll('option')).map((o) => o.getAttribute('value'));
    expect(values).toContain('engineer');
    expect(values).toContain('project_control_manager');
    expect(values).not.toContain('foreman');
    expect(values).not.toContain('field_user');
  });

  it('an Admin renames, reorders, adds and removes, then saves the whole list once', async () => {
    renderEditor();
    const user = userEvent.setup();
    const first = await screen.findByLabelText('Check 1');
    await user.clear(first); await user.type(first, 'Renamed');
    await user.click(screen.getByRole('button', { name: 'Move Second check up' }));
    await user.click(screen.getByRole('button', { name: 'Add a check' }));
    await user.type(screen.getByLabelText('Check 3'), 'Brand new');
    await user.selectOptions(screen.getByLabelText('Job role for check 3'), 'material_coordinator');
    await user.type(screen.getByLabelText('Days for check 3'), '4');
    await user.click(screen.getByRole('button', { name: 'Save checks' }));
    expect(h.saveTemplate).toHaveBeenCalledWith([
      { id: 'b', label: 'Second check', ownerJobRole: 'hr_officer', targetDays: 5 },
      { id: 'a', label: 'Renamed', ownerJobRole: 'engineer', targetDays: 3 },
      { id: null, label: 'Brand new', ownerJobRole: 'material_coordinator', targetDays: 4 },
    ]);
  });

  it('saving is off until something changes, and a line without its check, job role or days cannot be saved', async () => {
    renderEditor();
    const user = userEvent.setup();
    const save = await screen.findByRole('button', { name: 'Save checks' });
    expect(save).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Add a check' }));
    expect(save).toBeDisabled();
    await user.type(screen.getByLabelText('Check 3'), 'Permit');
    await user.selectOptions(screen.getByLabelText('Job role for check 3'), 'engineer');
    expect(save).toBeDisabled();
    await user.type(screen.getByLabelText('Days for check 3'), '400');
    expect(save).toBeDisabled();
    await user.clear(screen.getByLabelText('Days for check 3'));
    await user.type(screen.getByLabelText('Days for check 3'), '2');
    expect(save).toBeEnabled();
  });

  it('an empty list is valid and says new work orders start with none', async () => {
    h.listTemplate.mockResolvedValue([]);
    renderEditor();
    expect(await screen.findByText(/No standard checks/)).toBeInTheDocument();
  });

  it('anyone else sees no editor', () => {
    h.canManage = false;
    renderEditor();
    expect(screen.queryByText('Standard checks for a new work order')).toBeNull();
  });
});
