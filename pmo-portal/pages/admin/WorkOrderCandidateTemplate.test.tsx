/** #2595 (FR-CWO-007/008) — Administration › Projects › the candidate checklist: an Admin edits the whole ordered list. */
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from '@/src/components/ui';

const h = vi.hoisted(() => ({ canManage: true, listTemplate: vi.fn(), saveTemplate: vi.fn() }));
vi.mock('@/src/lib/repositories', () => ({ repositories: { workOrderCandidate: { listTemplate: h.listTemplate, saveTemplate: h.saveTemplate } } }));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 'u', org_id: 'o' } }) }));
vi.mock('@/src/auth/usePermission', () => ({ usePermission: () => () => h.canManage }));
import WorkOrderCandidateTemplate from './WorkOrderCandidateTemplate';

beforeEach(() => {
  vi.clearAllMocks();
  h.canManage = true;
  h.listTemplate.mockResolvedValue([{ id: 'a', label: 'First check', position: 1, required: true }, { id: 'b', label: 'Second check', position: 2, required: false }]);
  h.saveTemplate.mockResolvedValue(2);
});
const renderEditor = () => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><ToastProvider><WorkOrderCandidateTemplate /></ToastProvider></QueryClientProvider>);

describe('candidate checklist editor', () => {
  it('an Admin renames, reorders, adds and removes, then saves the whole list once', async () => {
    renderEditor();
    const user = userEvent.setup();
    const first = await screen.findByLabelText('Check 1');
    await user.clear(first); await user.type(first, 'Renamed');
    await user.click(screen.getByRole('button', { name: 'Move Second check up' }));
    await user.click(screen.getByRole('button', { name: 'Add a check' }));
    await user.type(screen.getByLabelText('Check 3'), 'Brand new');
    await user.click(screen.getByRole('button', { name: 'Save checklist' }));
    expect(h.saveTemplate).toHaveBeenCalledWith([
      { id: 'b', label: 'Second check', required: false },
      { id: 'a', label: 'Renamed', required: true },
      { id: null, label: 'Brand new', required: true },
    ]);
  });

  it('saving is off until something changes, and a blank check cannot be saved', async () => {
    renderEditor();
    const user = userEvent.setup();
    const save = await screen.findByRole('button', { name: 'Save checklist' });
    expect(save).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Add a check' }));
    expect(save).toBeDisabled();
  });

  it('an empty checklist is valid and says candidates can then be accepted straight away', async () => {
    h.listTemplate.mockResolvedValue([]);
    renderEditor();
    expect(await screen.findByText(/No checks yet/)).toBeInTheDocument();
  });

  it('anyone else sees no editor', () => {
    h.canManage = false;
    renderEditor();
    expect(screen.queryByText('Candidate work order checklist')).toBeNull();
  });
});
