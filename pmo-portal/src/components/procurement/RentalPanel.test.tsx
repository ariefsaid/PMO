import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { ToastProvider } from '@/src/components/ui';

const h = vi.hoisted(() => ({ mayCreate: true, extend: vi.fn(), links: { extends: null as null | Record<string, unknown>, extensions: [] as Array<Record<string, unknown>> } }));
vi.mock('@/src/hooks/usePurchaseTypes', () => ({
  usePurchaseTypes: () => ({ isPending: false, isError: false, data: [
    { id: 'rent', name: 'Hire', nameId: null, isRental: true, position: 1, active: true },
    { id: 'buy', name: 'Rental', nameId: null, isRental: false, position: 2, active: true },
  ] }),
  useRentalLinks: () => ({ data: h.links }),
  useExtendRental: () => ({ mutateAsync: h.extend, isPending: false }),
}));
vi.mock('@/src/auth/usePermission', () => ({ usePermission: () => () => h.mayCreate }));

import RentalPanel, { type RentalPanelProps } from './RentalPanel';

const props: RentalPanelProps = { procurementId: 'p1', title: 'Crane hire', status: 'Approved', purchaseTypeId: 'rent', rentalFrom: '2026-01-01', rentalTo: '2026-01-31', extendsId: null,
  lines: [{ id: 'l1', name: 'Crane', description: null, quantity: 1, rate: 1000 }] };
const view = (over: Partial<RentalPanelProps> = {}) => render(<MemoryRouter><ToastProvider><RentalPanel {...props} {...over} /></ToastProvider></MemoryRouter>);

describe('rental panel and the guided extension (#2697)', () => {
  beforeEach(() => { h.mayCreate = true; h.extend.mockReset(); h.links = { extends: null, extensions: [] }; });

  it('AC-PTR-015 offers Extend rental on a live rental; the dialog proposes the day after the end and carries the lines', async () => {
    view();
    await userEvent.click(screen.getByRole('button', { name: 'Extend rental' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByLabelText(/From/)).toHaveValue('1 Feb 2026');
    expect(within(dialog).getByLabelText(/To/)).toHaveValue('3 Mar 2026');
    expect(within(dialog).getAllByTestId('extension-line')).toHaveLength(1);
  });

  it('AC-PTR-015 confirming sends the new period and the lines to the server, with the original named', async () => {
    h.extend.mockResolvedValue('p2');
    view();
    await userEvent.click(screen.getByRole('button', { name: 'Extend rental' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Create extension order' }));
    expect(h.extend).toHaveBeenCalledTimes(1);
    const arg = h.extend.mock.calls[0][0];
    expect(arg).toMatchObject({ originalId: 'p1', from: '2026-02-01', to: '2026-03-03' });
    expect(arg.lines).toEqual([expect.objectContaining({ name: 'Crane', quantity: 1, rate: 1000 })]);
  });

  it('AC-PTR-015 a refusal from the server shows on the form', async () => {
    h.extend.mockRejectedValue(new Error('PTYPE_EXT_OVERLAP: another extension of this rental already covers part of that period'));
    view();
    await userEvent.click(screen.getByRole('button', { name: 'Extend rental' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Create extension order' }));
    expect(await screen.findByText('another extension of this rental already covers part of that period')).toBeInTheDocument();
  });

  it('AC-PTR-004 a non-rental type, even one named Rental, has no Extend action', () => {
    view({ purchaseTypeId: 'buy', rentalFrom: null, rentalTo: null });
    expect(screen.getByText('Rental')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Extend rental' })).not.toBeInTheDocument();
  });

  it('AC-PTR-010 a cancelled rental, or a caller who cannot create purchases, has no Extend action', () => {
    view({ status: 'Cancelled' });
    expect(screen.queryByRole('button', { name: 'Extend rental' })).not.toBeInTheDocument();
  });
  it('FR-PTR-009 a caller who cannot create purchases has no Extend action', () => {
    h.mayCreate = false;
    view();
    expect(screen.queryByRole('button', { name: 'Extend rental' })).not.toBeInTheDocument();
  });

  it('FR-PTR-013 the panel links to the rental it extends and to its own extensions, with periods', () => {
    h.links = { extends: { id: 'p0', title: 'Crane hire (first)', rentalFrom: '2025-12-01', rentalTo: '2025-12-31', status: 'Paid' },
                extensions: [{ id: 'p9', title: 'Crane hire (next)', rentalFrom: '2026-02-01', rentalTo: '2026-02-28', status: 'Draft' }] };
    view({ extendsId: 'p0' });
    expect(screen.getByRole('link', { name: 'Crane hire (first)' })).toHaveAttribute('href', '/procurement/p0');
    expect(screen.getByRole('link', { name: 'Crane hire (next)' })).toHaveAttribute('href', '/procurement/p9');
  });
});
