import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ToastProvider } from '@/src/components/ui';
import { resetActiveLocale, setActiveLocale } from '@/src/lib/locale/activeLocale';

import type { RentalTermRow } from '@/src/lib/db/equipmentAvailability';

const h = vi.hoisted(() => ({
  saveTerm: vi.fn(),
  changeRate: vi.fn(),
  endTerm: vi.fn(),
  terms: [] as RentalTermRow[],
}));
vi.mock('@/src/hooks/useCompanies', () => ({ useCompanies: () => ({ data: [{ id: 'v1', name: 'Vendor' }] }) }));
vi.mock('@/src/hooks/useEquipmentAvailability', () => ({
  useRentalTerms: () => ({ mutateAsync: h.saveTerm, isPending: false }),
  useEquipmentOwnership: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useChangeRentalRate: () => ({ mutateAsync: h.changeRate, isPending: false }),
  useEndRentalTerm: () => ({ mutateAsync: h.endTerm, isPending: false }),
  useRentalTermHistory: () => ({ data: h.terms, isError: false }),
}));
import { EquipmentRentalTerms } from './EquipmentRentalTerms';

const use = (locale: 'en' | 'id', numberLocale: string) => setActiveLocale({ locale, numberLocale, timezone: 'UTC' });
const fill = async () => {
  render(<ToastProvider><EquipmentRentalTerms asset={{ id: 'a1', ownership: 'rented' }} /></ToastProvider>);
  await userEvent.selectOptions(screen.getByLabelText('Vendor'), 'v1');
  await userEvent.type(screen.getByLabelText('Rental start'), '2026-01-01');
};
beforeEach(() => { vi.clearAllMocks(); h.saveTerm.mockResolvedValue(undefined); h.changeRate.mockResolvedValue(undefined); });
afterEach(() => { h.terms = []; resetActiveLocale(); });

describe('#2618 rental rate is read in the viewer\'s number convention', () => {
  it('Bahasa: 15.000 is fifteen thousand, sent as 15000', async () => {
    use('en', 'id-ID');
    await fill();
    await userEvent.type(screen.getByLabelText('Rate'), '15.000');
    await userEvent.click(screen.getByRole('button', { name: 'Save rental terms' }));
    expect(h.saveTerm).toHaveBeenCalledWith(expect.objectContaining({ rate: '15000' }));
  });
  it('Bahasa: 1.500.000,50 is sent as 1500000.5', async () => {
    use('en', 'id-ID');
    await fill();
    await userEvent.type(screen.getByLabelText('Rate'), '1.500.000,50');
    await userEvent.click(screen.getByRole('button', { name: 'Save rental terms' }));
    expect(h.saveTerm).toHaveBeenCalledWith(expect.objectContaining({ rate: '1500000.5' }));
  });
  it('English: 15,000.25 is sent as 15000.25 and the change-rate action sends the same canonical text', async () => {
    use('en', 'en-US');
    await fill();
    await userEvent.type(screen.getByLabelText('Rate'), '15,000.25');
    await userEvent.click(screen.getByText('Other asset actions'));
    await userEvent.click(screen.getByRole('button', { name: 'Change rate from date' }));
    expect(h.changeRate).toHaveBeenCalledWith({ assetId: 'a1', date: '2026-01-01', rate: '15000.25' });
  });
  it('an amount with too many decimals is refused with a message and nothing is sent', async () => {
    use('en', 'en-US');
    await fill();
    await userEvent.type(screen.getByLabelText('Rate'), '1.234');
    await userEvent.click(screen.getByRole('button', { name: 'Save rental terms' }));
    expect(await screen.findByText(/at most 2 decimals/)).toBeInTheDocument();
    expect(h.saveTerm).not.toHaveBeenCalled();
  });
});

it('AC-EQM-001 ends only an open period on the selected date', async () => {
  h.endTerm.mockResolvedValue(undefined);
  h.terms = [
    { id: 'open', vendor_id: 'v1', rate: 100, basis: 'day', currency: 'USD', rented_from: '2026-02-01', rented_to: null },
    { id: 'closed', vendor_id: 'v1', rate: 100, basis: 'day', currency: 'USD', rented_from: '2026-01-01', rented_to: '2026-01-31' },
  ];
  render(<ToastProvider><EquipmentRentalTerms asset={{ id: 'a1', ownership: 'rented' }} /></ToastProvider>);
  await userEvent.click(screen.getByRole('button', { name: /^End rental period$/ }));
  await userEvent.type(screen.getByLabelText('Last rental day'), '2026-02-10');
  await userEvent.click(screen.getByRole('button', { name: 'Confirm end date' }));
  expect(h.endTerm).toHaveBeenCalledExactlyOnceWith({ termId: 'open', date: '2026-02-10' });
  expect(screen.queryByLabelText('Last rental day')).not.toBeInTheDocument();
});
