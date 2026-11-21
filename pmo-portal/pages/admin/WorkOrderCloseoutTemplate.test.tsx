import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ToastProvider } from '@/src/components/ui';

const h = vi.hoisted(() => ({ save: vi.fn(), may: true, failed: false, data: [{ name: 'Item one', required: true }, { name: 'Item two', required: false }] as unknown }));
vi.mock('@/src/hooks/useCloseoutChecklist', () => ({
  useCloseoutTemplate: () => ({ data: h.failed ? undefined : h.data, isError: h.failed, refetch: vi.fn() }),
  useSaveCloseoutTemplate: () => ({ mutateAsync: h.save, isPending: false }),
}));
vi.mock('@/src/auth/usePermission', () => ({ usePermission: () => () => h.may }));
import WorkOrderCloseoutTemplate from './WorkOrderCloseoutTemplate';

const setup = () => render(<ToastProvider><WorkOrderCloseoutTemplate /></ToastProvider>);
beforeEach(() => {
  h.may = true; h.failed = false;
  h.data = [{ name: 'Item one', required: true }, { name: 'Item two', required: false }];
  h.save.mockReset().mockResolvedValue(2);
});

describe('AC-WCO-001 the organisation close-out checklist editor', () => {
  it('saves the whole list in order with each required flag, trimmed', async () => {
    const user = userEvent.setup(); setup();
    await user.type(screen.getAllByRole('textbox')[0], ' x ');
    await user.click(screen.getByRole('button', { name: 'Add item' }));
    await user.type(screen.getAllByRole('textbox')[2], 'Item three');
    await user.click(screen.getByRole('button', { name: 'Save checklist' }));
    await waitFor(() => expect(h.save).toHaveBeenCalledWith([
      { name: 'Item one x', required: true }, { name: 'Item two', required: false }, { name: 'Item three', required: true }]));
  });

  it('moves an item up and removes one', async () => {
    const user = userEvent.setup(); setup();
    await user.click(screen.getByRole('button', { name: 'Move Item two up' }));
    await user.click(screen.getByRole('button', { name: 'Remove Item one' }));
    await user.click(screen.getByRole('button', { name: 'Save checklist' }));
    await waitFor(() => expect(h.save).toHaveBeenCalledWith([{ name: 'Item two', required: false }]));
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
    await user.type(screen.getAllByRole('textbox')[2], 'Item three');
    await user.click(screen.getByRole('button', { name: 'Save checklist' }));
    expect(await screen.findByText('Save refused')).toBeVisible();
  });
});
