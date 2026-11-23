import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ToastProvider } from '@/src/components/ui';

const h = vi.hoisted(() => ({ create: { mutateAsync: vi.fn(), isPending: false }, save: { mutateAsync: vi.fn(), isPending: false } }));
vi.mock('@/src/hooks/useImprest', () => ({ useCreatePlan: () => h.create, useSavePlanLine: () => h.save }));

import { PlanSeedEditor } from './PlanSeedEditor';

const seed = [{ category: 'Equipment' as const, amount: 300000 }, { category: 'Materials' as const, amount: 600000 }];
const renderIt = (onDone = vi.fn()) => { render(<ToastProvider><PlanSeedEditor floatId="f1" month="2026-12-01" seed={seed} onDone={onDone} /></ToastProvider>); return onDone; };

describe('AC-CAE-003 the plan editor started from open requests', () => {
  beforeEach(() => { h.create.mutateAsync = vi.fn().mockResolvedValue('plan-1'); h.save.mutateAsync = vi.fn().mockResolvedValue('x'); });
  it('AC-CAE-003 is pre-filled with one amount per purpose and writes nothing until the person creates the draft', () => {
    renderIt();
    expect(screen.getByLabelText('Equipment')).toHaveValue('300000');
    expect(screen.getByLabelText('Materials')).toHaveValue('600000');
    expect(h.create.mutateAsync).not.toHaveBeenCalled();
    expect(h.save.mutateAsync).not.toHaveBeenCalled();
  });
  it('AC-CAE-003 saving goes through the existing plan path with the edited amounts, and a removed purpose is left out', async () => {
    const user = userEvent.setup();
    const onDone = renderIt();
    await user.clear(screen.getByLabelText('Materials'));
    await user.type(screen.getByLabelText('Materials'), '550000');
    await user.click(screen.getByRole('button', { name: 'Remove Equipment' }));
    await user.click(screen.getByRole('button', { name: 'Create draft plan' }));
    await waitFor(() => expect(onDone).toHaveBeenCalledWith('plan-1'));
    expect(h.create.mutateAsync).toHaveBeenCalledWith({ floatId: 'f1', month: '2026-12-01' });
    expect(h.save.mutateAsync).toHaveBeenCalledTimes(1);
    expect(h.save.mutateAsync).toHaveBeenCalledWith({ planId: 'plan-1', category: 'Materials', amount: 550000 });
  });
  it('AC-CAE-003 an amount that is not above zero disables the save and says why', async () => {
    const user = userEvent.setup();
    renderIt();
    await user.clear(screen.getByLabelText('Materials'));
    await user.type(screen.getByLabelText('Materials'), '0');
    expect(screen.getByRole('button', { name: 'Create draft plan' })).toBeDisabled();
    expect(screen.getByText('Every amount must be more than zero.')).toBeInTheDocument();
  });
  it('AC-CAE-003 Discard closes without writing', async () => {
    const onDone = renderIt();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Discard' }));
    expect(onDone).toHaveBeenCalledWith(null);
    expect(h.create.mutateAsync).not.toHaveBeenCalled();
  });
  it('AC-CAE-003 if the plan cannot be created nothing is saved and the editor stays open', async () => {
    h.create.mutateAsync = vi.fn().mockRejectedValue(new Error('boom'));
    const onDone = renderIt();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Create draft plan' }));
    await waitFor(() => expect(h.create.mutateAsync).toHaveBeenCalled());
    expect(h.save.mutateAsync).not.toHaveBeenCalled();
    expect(onDone).not.toHaveBeenCalled();
  });
  it('AC-CAE-003 a line that fails to save is told, and the draft plan opens so the person adds it', async () => {
    h.save.mutateAsync = vi.fn().mockRejectedValueOnce(new Error('no')).mockResolvedValue('x');
    const onDone = renderIt();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Create draft plan' }));
    await waitFor(() => expect(onDone).toHaveBeenCalledWith('plan-1'));
    expect(h.save.mutateAsync).toHaveBeenCalledTimes(2);
    expect((await screen.findAllByText(/1 line\(s\) were not saved/)).length).toBeGreaterThan(0);
  });
});
