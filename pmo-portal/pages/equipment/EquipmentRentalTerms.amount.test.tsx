import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ToastProvider } from '@/src/components/ui';
import { resetActiveLocale, setActiveLocale } from '@/src/lib/locale/activeLocale';

const h = vi.hoisted(() => ({ saveTerm: vi.fn(), changeRate: vi.fn() }));
vi.mock('@/src/hooks/useCompanies', () => ({ useCompanies: () => ({ data: [{ id: 'v1', name: 'Vendor' }] }) }));
vi.mock('@/src/hooks/useEquipmentAvailability', () => ({
  useRentalTerms: () => ({ mutateAsync: h.saveTerm, isPending: false }),
  useEquipmentOwnership: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useChangeRentalRate: () => ({ mutateAsync: h.changeRate, isPending: false }),
  useRentalTermHistory: () => ({ data: [], isError: false }),
}));
import { EquipmentRentalTerms } from './EquipmentRentalTerms';

const dlg = () => within(screen.getByRole('dialog'));
const use = (locale: 'en' | 'id', numberLocale: string) => setActiveLocale({ locale, numberLocale, timezone: 'UTC' });
const fill = async () => {
  render(<ToastProvider><EquipmentRentalTerms asset={{ id: 'a1', ownership: 'rented' }} /></ToastProvider>);
  await userEvent.click(screen.getByRole('button', { name: 'Add rental terms' }));
  await userEvent.selectOptions(dlg().getByLabelText('Vendor'), 'v1');
  await userEvent.type(dlg().getByLabelText('Rental start'), '2026-01-01');
};
beforeEach(() => { vi.clearAllMocks(); h.saveTerm.mockResolvedValue(undefined); h.changeRate.mockResolvedValue(undefined); });
afterEach(() => resetActiveLocale());

describe('#2618 rental rate is read in the viewer\'s number convention', () => {
  it('Bahasa: 15.000 is fifteen thousand, sent as 15000', async () => {
    use('en', 'id-ID');
    await fill();
    await userEvent.type(dlg().getByLabelText('Rate'), '15.000');
    await userEvent.click(screen.getByRole('button', { name: 'Save rental terms' }));
    expect(h.saveTerm).toHaveBeenCalledWith(expect.objectContaining({ rate: '15000' }));
  });
  it('Bahasa: 1.500.000,50 is sent as 1500000.5', async () => {
    use('en', 'id-ID');
    await fill();
    await userEvent.type(dlg().getByLabelText('Rate'), '1.500.000,50');
    await userEvent.click(screen.getByRole('button', { name: 'Save rental terms' }));
    expect(h.saveTerm).toHaveBeenCalledWith(expect.objectContaining({ rate: '1500000.5' }));
  });
  it('English: 15,000.25 is sent as 15000.25 and the change-rate action sends the same canonical text', async () => {
    use('en', 'en-US');
    render(<ToastProvider><EquipmentRentalTerms asset={{ id: 'a1', ownership: 'rented' }} /></ToastProvider>);
    await userEvent.click(screen.getByRole('button', { name: 'Other asset actions' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Change rate from date' }));
    await userEvent.type(dlg().getByLabelText('New rate from'), '2026-01-01');
    await userEvent.type(dlg().getByLabelText('Rate'), '15,000.25');
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Change rate from date' }));
    expect(h.changeRate).toHaveBeenCalledWith({ assetId: 'a1', date: '2026-01-01', rate: '15000.25' });
  });
  it('an amount with too many decimals is refused with a message and nothing is sent', async () => {
    use('en', 'en-US');
    await fill();
    await userEvent.type(dlg().getByLabelText('Rate'), '1.234');
    await userEvent.click(screen.getByRole('button', { name: 'Save rental terms' }));
    expect(await screen.findByText(/at most 2 decimals/)).toBeInTheDocument();
    expect(h.saveTerm).not.toHaveBeenCalled();
  });
});
