/** #1126 — a work order is created from the Work orders page: the form leads with the Project field. */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import type { WorkOrderLists } from '@/src/hooks/useWorkOrderLists';

const NONE: WorkOrderLists = { areas: [], groups: [], liveAreas: [], liveGroups: [], hasLists: false };
vi.mock('@/src/hooks/useWorkOrderLists', () => ({ useWorkOrderLists: () => NONE }));
import WorkOrderFormModal from '../WorkOrderFormModal';
import type { WorkOrderProjectChoice } from '@/src/hooks/useWorkOrderProjectChoices';

const PROJECTS: WorkOrderProjectChoice[] = [
  { value: 'p1', label: 'Harbour fit-out', currency: 'USD' },
  { value: 'p2', label: 'Depot extension', currency: 'IDR' },
];
const onCreate = vi.fn();
const renderForm = (project: { options: WorkOrderProjectChoice[]; lockedId?: string } | undefined) =>
  render(<WorkOrderFormModal workOrder={null} currencySymbolPrefix="$" onClose={vi.fn()} onCreate={onCreate} project={project} />);

async function fillRest() {
  await userEvent.type(screen.getByLabelText(/Title/), 'Phase 1');
  await userEvent.type(screen.getByTestId('wo-order-value'), '500');
  await userEvent.selectOptions(screen.getByTestId('wo-tax-treatment'), 'exclusive');
  await userEvent.type(screen.getByTestId('wo-tax-amount'), '0');
}

beforeEach(() => { onCreate.mockReset().mockResolvedValue(undefined); });

describe('work-order form: Project field (#1126)', () => {
  it('offers no Project field when no project list is supplied (a project\'s own form, edit)', () => {
    renderForm(undefined);
    expect(screen.queryByRole('combobox', { name: /Project/ })).not.toBeInTheDocument();
  });

  it('requires a project: Create draft stays disabled until one is chosen, then creates on that project in its currency', async () => {
    renderForm({ options: PROJECTS });
    await fillRest();
    expect(screen.getByRole('button', { name: 'Create draft' })).toBeDisabled();

    await userEvent.click(screen.getByRole('combobox', { name: /Project/ }));
    await userEvent.click(await screen.findByRole('option', { name: /Depot extension/ }));
    expect(screen.getByRole('button', { name: 'Create draft' })).toBeEnabled();

    await userEvent.click(screen.getByRole('button', { name: 'Create draft' }));
    await waitFor(() => expect(onCreate).toHaveBeenCalled());
    expect(onCreate.mock.calls[0][0]).toMatchObject({ title: 'Phase 1', orderValue: 500 });
    expect(onCreate.mock.calls[0][1]).toBe('p2');
  });

  it('opened from a project: the project is preset and locked, and the create goes to it', async () => {
    renderForm({ options: PROJECTS, lockedId: 'p1' });
    const field = screen.getByRole('combobox', { name: /Project/ });
    expect(field).toBeDisabled();
    expect(field).toHaveTextContent('Harbour fit-out');
    await fillRest();
    await userEvent.click(screen.getByRole('button', { name: 'Create draft' }));
    await waitFor(() => expect(onCreate).toHaveBeenCalled());
    expect(onCreate.mock.calls[0][1]).toBe('p1');
  });

  it('says so when there is no project to add a work order to', () => {
    renderForm({ options: [] });
    expect(screen.getByText('There is no project to add a work order to yet.')).toBeInTheDocument();
  });
});
