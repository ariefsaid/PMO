/** AC-EQM-002 (unit layer): one form adds an owned or a rented machine (rental fields on the same form) and edits a machine. */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { ToastProvider } from '@/src/components/ui';

const h = vi.hoisted(() => ({ create: vi.fn(), createRented: vi.fn(), update: vi.fn() }));
vi.mock('@/src/hooks/useEquipment', () => ({
  useCreateAsset: () => ({ mutateAsync: h.create, isPending: false }),
  useCreateRentedAsset: () => ({ mutateAsync: h.createRented, isPending: false }),
  useUpdateAsset: () => ({ mutateAsync: h.update, isPending: false }),
}));
vi.mock('@/src/hooks/useCompanies', () => ({ useCompanyOptions: () => ({ data: [{ id: 'v1', name: 'Rental Co' }] }) }));

import { AssetFormModal } from './AssetFormModal';

const open = (props: Partial<React.ComponentProps<typeof AssetFormModal>> = {}) => {
  const onClose = vi.fn();
  render(<MemoryRouter><ToastProvider><AssetFormModal onClose={onClose} {...props} /></ToastProvider></MemoryRouter>);
  return onClose;
};

beforeEach(() => { h.create = vi.fn().mockResolvedValue({}); h.createRented = vi.fn().mockResolvedValue('a9'); h.update = vi.fn().mockResolvedValue(undefined); });

describe('asset form', () => {
  it('AC-EQM-002 an owned machine is created without any rental field', async () => {
    open();
    expect(screen.queryByLabelText('Vendor')).not.toBeInTheDocument();
    await userEvent.type(screen.getByLabelText(/^Code/), 'EX-1');
    await userEvent.type(screen.getByLabelText(/^Name/), 'Excavator');
    await userEvent.click(screen.getByRole('button', { name: 'Create asset' }));
    await waitFor(() => expect(h.create).toHaveBeenCalledWith({ code: 'EX-1', name: 'Excavator', default_unit: 'hours' }));
    expect(h.createRented).not.toHaveBeenCalled();
  });

  it('AC-EQM-002 a rented machine takes vendor, rate and start on the same form and is saved in one step', async () => {
    open();
    await userEvent.type(screen.getByLabelText(/^Code/), 'CR-7');
    await userEvent.type(screen.getByLabelText(/^Name/), 'Crane');
    await userEvent.selectOptions(screen.getByLabelText('Owned or rented'), 'rented');
    await userEvent.selectOptions(screen.getByLabelText(/Vendor/), 'v1');
    await userEvent.type(screen.getByRole('textbox', { name: /^Rate/ }), '1500000');
    await userEvent.type(screen.getByLabelText(/Rental start/), '2 Nov 2026');
    await userEvent.tab();
    await userEvent.click(screen.getByRole('button', { name: 'Create asset' }));
    await waitFor(() => expect(h.createRented).toHaveBeenCalledWith(expect.objectContaining({
      code: 'CR-7', name: 'Crane', vendor_id: 'v1', rate: '1500000', basis: 'day', currency: 'IDR', rented_from: '2026-11-02', rented_to: null,
    })));
    expect(h.create).not.toHaveBeenCalled();
  });

  it('AC-EQM-002 a rented machine without a rate or start is refused with a sentence, nothing is sent', async () => {
    open();
    await userEvent.type(screen.getByLabelText(/^Code/), 'CR-8');
    await userEvent.type(screen.getByLabelText(/^Name/), 'Crane 2');
    await userEvent.selectOptions(screen.getByLabelText('Owned or rented'), 'rented');
    await userEvent.click(screen.getByRole('button', { name: 'Create asset' }));
    expect(await screen.findByText('Choose the vendor the machine is rented from.')).toBeInTheDocument();
    expect(h.createRented).not.toHaveBeenCalled();
  });

  it('AC-EQM-002 an existing machine is edited (code, name, unit) and points to its page for rental terms', async () => {
    const asset = { id: 'a1', code: 'EX-1', name: 'Excavator', default_unit: 'hours' } as never;
    open({ asset });
    expect(screen.getByRole('link', { name: 'Open the equipment page' })).toHaveAttribute('href', '/equipment/assets/a1');
    await userEvent.clear(screen.getByLabelText(/^Name/));
    await userEvent.type(screen.getByLabelText(/^Name/), 'Excavator 20t');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(h.update).toHaveBeenCalledWith({ id: 'a1', patch: { code: 'EX-1', name: 'Excavator 20t', default_unit: 'hours' } }));
  });
});
