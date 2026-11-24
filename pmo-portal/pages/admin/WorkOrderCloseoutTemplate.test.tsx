import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ToastProvider } from '@/src/components/ui';

const h = vi.hoisted(() => ({
  save: vi.fn(),
  may: true,
  failed: false,
  data: [{ name: 'Item one', required: true, targetDays: null }, { name: 'Item two', required: false, targetDays: null }] as unknown,
}));
vi.mock('@/src/hooks/useCloseoutChecklist', () => ({
  useCloseoutTemplate: () => ({ data: h.failed ? undefined : h.data, isError: h.failed, refetch: vi.fn() }),
  useSaveCloseoutTemplate: () => ({ mutateAsync: h.save, isPending: false }),
}));
vi.mock('@/src/auth/usePermission', () => ({ usePermission: () => () => h.may }));
import WorkOrderCloseoutTemplate from './WorkOrderCloseoutTemplate';

const setup = () => render(<ToastProvider><WorkOrderCloseoutTemplate /></ToastProvider>);
/** One item's fieldset, so a field is addressed where it lives rather than by its position across the whole form. */
const itemField = (n: number) => within(screen.getByRole('group', { name: `Item ${n}` }));
beforeEach(() => {
  h.may = true; h.failed = false;
  h.data = [{ name: 'Item one', required: true, targetDays: null }, { name: 'Item two', required: false, targetDays: null }];
  h.save.mockReset().mockResolvedValue(2);
});

describe('AC-WCO-001 the organisation close-out checklist editor', () => {
  it('saves the whole list in order with each required flag, trimmed', async () => {
    const user = userEvent.setup(); setup();
    await user.type(itemField(1).getByRole('textbox', { name: 'Item name' }), ' x ');
    await user.click(screen.getByRole('button', { name: 'Add item' }));
    await user.type(itemField(3).getByRole('textbox', { name: 'Item name' }), 'Item three');
    await user.click(screen.getByRole('button', { name: 'Save checklist' }));
    await waitFor(() => expect(h.save).toHaveBeenCalledWith([
      { name: 'Item one x', required: true, targetDays: null },
      { name: 'Item two', required: false, targetDays: null },
      { name: 'Item three', required: true, targetDays: null }]));
  });

  it('moves an item up and removes one', async () => {
    const user = userEvent.setup(); setup();
    await user.click(screen.getByRole('button', { name: 'Move Item two up' }));
    await user.click(screen.getByRole('button', { name: 'Remove Item one' }));
    await user.click(screen.getByRole('button', { name: 'Save checklist' }));
    await waitFor(() => expect(h.save).toHaveBeenCalledWith([{ name: 'Item two', required: false, targetDays: null }]));
  });

  it('refuses an unnamed item and sends nothing', async () => {
    const user = userEvent.setup(); setup();
    await user.click(screen.getByRole('button', { name: 'Add item' }));
    await user.click(screen.getByRole('button', { name: 'Save checklist' }));
    expect(screen.getByText('Name the item.')).toBeVisible();
    expect(h.save).not.toHaveBeenCalled();
  });

  it('disables Save until the list changes', async () => {
    setup();
    expect(screen.getByRole('button', { name: 'Save checklist' })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'Add item' }));
    expect(screen.getByRole('button', { name: 'Save checklist' })).toBeEnabled();
  });

  it('FR-WCO-031 shows a non-Admin the list without edit controls', () => {
    h.may = false; setup();
    expect(screen.getAllByRole('textbox')[0]).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Save checklist' })).toBeNull();
    expect(screen.getByText('Only an Admin can change the checklist.')).toBeVisible();
  });

  it('shows a retry when the list cannot be read instead of an empty editable list', () => {
    h.failed = true; setup();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Add item' })).toBeNull();
  });

  it('surfaces a refused save', async () => {
    h.save.mockRejectedValue(new Error('Save refused'));
    const user = userEvent.setup(); setup();
    await user.click(screen.getByRole('button', { name: 'Add item' }));
    await user.type(itemField(3).getByRole('textbox', { name: 'Item name' }), 'Item three');
    await user.click(screen.getByRole('button', { name: 'Save checklist' }));
    expect(await screen.findByText('Save refused')).toBeVisible();
  });
});

describe('AC-CTD-010 the editor takes a target in days', () => {
  it('FR-CTD-001 saves each item’s target, and a blank target stays untargeted', async () => {
    const user = userEvent.setup(); setup();
    await user.type(itemField(1).getByRole('textbox', { name: 'Target (days)' }), '5');
    await user.click(screen.getByRole('button', { name: 'Save checklist' }));
    await waitFor(() => expect(h.save).toHaveBeenCalledWith([
      { name: 'Item one', required: true, targetDays: 5 },
      { name: 'Item two', required: false, targetDays: null },
    ]));
  });

  it('FR-CTD-001 an existing target is shown and saved back unchanged', async () => {
    h.data = [{ name: 'Item one', required: true, targetDays: 14 }];
    const user = userEvent.setup(); setup();
    expect(itemField(1).getByRole('textbox', { name: 'Target (days)' })).toHaveValue('14');
    await user.type(itemField(1).getByRole('textbox', { name: 'Item name' }), '!');
    await user.click(screen.getByRole('button', { name: 'Save checklist' }));
    await waitFor(() => expect(h.save).toHaveBeenCalledWith([{ name: 'Item one!', required: true, targetDays: 14 }]));
  });

  it('refuses a target that is not a whole number of days from 1 to 365, and sends nothing', async () => {
    const user = userEvent.setup(); setup();
    await user.type(itemField(1).getByRole('textbox', { name: 'Target (days)' }), '400');
    await user.click(screen.getByRole('button', { name: 'Save checklist' }));
    expect(itemField(1).getByText('Use a whole number of days from 1 to 365, or leave it blank.')).toBeVisible();
    expect(h.save).not.toHaveBeenCalled();
  });

  it('FR-CTD-001 the database’s own refusal is explained in the reader’s words', async () => {
    h.save.mockRejectedValue(Object.assign(
      new Error('COT_TARGET_DAYS: a target is a whole number of days from 1 to 365'),
      { code: '23514', details: 'item-target-invalid' },
    ));
    const user = userEvent.setup(); setup();
    await user.click(screen.getByRole('button', { name: 'Add item' }));
    await user.type(itemField(3).getByRole('textbox', { name: 'Item name' }), 'Item three');
    await user.click(screen.getByRole('button', { name: 'Save checklist' }));
    expect(await screen.findByText('A target is a whole number of days from 1 to 365.')).toBeVisible();
  });
});

it('AC-WCO-040 explains who completes an item without an owner role', () => {
  setup();
  expect(itemField(1).getByText('Without an owner job role, only an Admin, Finance, or the project manager can complete this item.')).toBeVisible();
});
