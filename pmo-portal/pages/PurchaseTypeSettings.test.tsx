import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { ToastProvider } from '@/src/components/ui';

const h = vi.hoisted(() => ({ role: 'Engineer', enabled: true, upsert: vi.fn(), setActive: vi.fn(), setEnabled: vi.fn() }));
const ok = { isPending: false, isError: false, refetch: vi.fn() };
vi.mock('@/src/hooks/usePurchaseTypes', () => ({
  usePurchaseTypesEnabled: () => ({ ...ok, data: h.enabled }),
  usePurchaseTypes: () => ({ ...ok, data: [
    { id: 't1', name: 'Goods', nameId: 'Barang', isRental: false, position: 1, active: true },
    { id: 't2', name: 'Hire', nameId: null, isRental: true, position: 2, active: false },
  ] }),
  usePurchaseTypeMutations: () => ({
    setEnabled: { mutateAsync: h.setEnabled, isPending: false }, upsert: { mutateAsync: h.upsert, isPending: false }, setActive: { mutateAsync: h.setActive, isPending: false },
  }),
}));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 'u1', org_id: 'o1', role: h.role } }) }));
vi.mock('@/src/auth/impersonation', () => ({ useEffectiveRole: () => ({ realRole: h.role, effectiveRole: h.role }) }));
vi.mock('@/src/components/shell', () => ({ BackBar: () => null }));

import PurchaseTypeSettingsPage from './PurchaseTypeSettings';

const renderPage = () => render(<MemoryRouter><ToastProvider><PurchaseTypeSettingsPage /></ToastProvider></MemoryRouter>);

describe('purchase type settings (#2697)', () => {
  beforeEach(() => { h.role = 'Admin'; h.enabled = true; h.upsert.mockReset(); h.setActive.mockReset(); h.setEnabled.mockReset(); });

  it('AC-PTR-016 a non-Admin sees no save, add or retire control', () => {
    h.role = 'Engineer';
    renderPage();
    expect(screen.getByText('Only an Admin can change purchase types.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add type' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retire' })).not.toBeInTheDocument();
  });

  it('AC-PTR-016 an Admin lists the types as data, with a retired one marked and restorable', () => {
    renderPage();
    expect(screen.getAllByTestId('purchase-type-row')).toHaveLength(2);
    expect(screen.getByDisplayValue('Hire')).toBeInTheDocument();
    expect(screen.getByText('Retired')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Restore' })).toBeInTheDocument();
  });

  it('AC-PTR-016 an Admin adds a rental-flagged type with any name', async () => {
    h.upsert.mockResolvedValue(undefined);
    renderPage();
    const fresh = screen.getByTestId('purchase-type-new');
    await userEvent.type(fresh.querySelector('input[type="text"], input:not([type])') as HTMLElement, 'Plant hire');
    await userEvent.click(within(fresh).getByText('This type has a rental period'));
    await userEvent.click(screen.getByRole('button', { name: 'Add type' }));
    expect(h.upsert).toHaveBeenCalledWith({ id: null, name: 'Plant hire', nameId: null, isRental: true, position: 3 });
  });

  it('AC-PTR-016 a refusal from the server is shown in words, not swallowed', async () => {
    h.upsert.mockRejectedValue(new Error('PTYPE_IN_USE: purchases use this type; retire it and add a new one instead'));
    renderPage();
    const row = screen.getAllByTestId('purchase-type-row')[0];
    await userEvent.click(row.querySelector('input[type="checkbox"]') as HTMLElement);
    await userEvent.click(screen.getByRole('button', { name: 'Save', exact: true }));
    expect(await screen.findByText('Purchases use this type. Retire it and add a new one instead.')).toBeInTheDocument();
  });

  it('AC-PTR-013 the type list is not offered while purchase types are off', () => {
    h.enabled = false;
    renderPage();
    expect(screen.queryByTestId('purchase-type-row')).not.toBeInTheDocument();
  });
});
