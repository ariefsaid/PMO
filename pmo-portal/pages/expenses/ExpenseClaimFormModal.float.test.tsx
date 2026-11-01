import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import React from 'react';
import { ToastProvider } from '@/src/components/ui';

const h = vi.hoisted(() => ({ choices: [] as unknown[], args: [] as unknown[][] }));
vi.mock('@/src/hooks/useExpensePostingReadiness', () => ({ useExpensePostingReadiness: () => ({ state: 'ready', retry: vi.fn() }) }));
vi.mock('@/src/hooks/useImprest', () => ({
  useImprestFloatChoices: (...a: unknown[]) => { h.args.push(a); return { data: a[0] ? h.choices : [] }; },
}));

import { ExpenseClaimFormModal } from './ExpenseClaimFormModal';

const FLOATS = [{ float_id: 'f1', custodian_name: 'Cass Custodian', remaining: 500000 }];
const renderForm = (props: Partial<React.ComponentProps<typeof ExpenseClaimFormModal>>) => {
  const onSubmit = vi.fn().mockResolvedValue(undefined);
  render(
    <ToastProvider>
      <ExpenseClaimFormModal kind="advance" projectOptions={[{ value: 'p1', label: 'Harbour Upgrade' }]} advanceOptions={[]}
        onClose={vi.fn()} onSubmit={onSubmit} {...props} />
    </ToastProvider>,
  );
  return onSubmit;
};

beforeEach(() => { h.choices = FLOATS; h.args = []; });

describe('AC-IMP-084 an advance and an edited Draft are charged to a site float', () => {
  it('AC-IMP-084 an advance sends the chosen float', async () => {
    const onSubmit = renderForm({});
    fireEvent.change(screen.getByLabelText(/Title/), { target: { value: 'Site cash advance' } });
    fireEvent.change(screen.getByLabelText(/^Amount/), { target: { value: '1000' } });
    expect(screen.queryByLabelText('Charge to site float')).toBeNull(); // no project yet, no float
    fireEvent.change(screen.getByLabelText('Project'), { target: { value: 'p1' } });
    expect(within(screen.getByLabelText('Charge to site float')).getByRole('option', { name: /Cass Custodian/ })).toHaveValue('f1');
    fireEvent.change(screen.getByLabelText('Charge to site float'), { target: { value: 'f1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ kind: 'advance', imprestFloatId: 'f1' });
  });

  it('AC-IMP-084 an advance with no float chosen sends none', async () => {
    const onSubmit = renderForm({});
    fireEvent.change(screen.getByLabelText(/Title/), { target: { value: 'Plain advance' } });
    fireEvent.change(screen.getByLabelText(/^Amount/), { target: { value: '1000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit.mock.calls[0][0].imprestFloatId ?? null).toBeNull();
  });

  it('AC-IMP-084 an edited Draft can release its float', async () => {
    const onSubmit = renderForm({
      kind: 'claim',
      initial: { title: 'Diesel', projectId: 'p1', budgetCategory: 'Vehicle', purpose: null, amount: 0, advanceId: null, imprestFloatId: 'f1' },
    });
    expect(screen.getByLabelText('Charge to site float')).toHaveValue('f1');
    fireEvent.change(screen.getByLabelText('Charge to site float'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ imprestFloatId: null });
  });

  it('AC-IMP-084 an edited Draft keeps its float when only the title changes', async () => {
    const onSubmit = renderForm({
      kind: 'claim',
      initial: { title: 'Diesel', projectId: 'p1', budgetCategory: 'Vehicle', purpose: null, amount: 0, advanceId: null, imprestFloatId: 'f1' },
    });
    fireEvent.change(screen.getByLabelText(/Title/), { target: { value: 'Diesel for site' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ imprestFloatId: 'f1' });
  });

  it('AC-IMP-084 moving the Draft to another project drops the float (it belongs to the old project)', async () => {
    const onSubmit = renderForm({
      kind: 'claim', projectOptions: [{ value: 'p1', label: 'Harbour Upgrade' }, { value: 'p2', label: 'Second site' }],
      initial: { title: 'Diesel', projectId: 'p1', budgetCategory: 'Vehicle', purpose: null, amount: 0, advanceId: null, imprestFloatId: 'f1' },
    });
    fireEvent.change(screen.getByLabelText('Project'), { target: { value: 'p2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ projectId: 'p2', imprestFloatId: null });
  });
});
