// AC-3025 — the vendor's PMO-native master data (code, address, payment terms) on the ONE
// company create/edit form. The section belongs to the Vendor type only; a client edit never
// writes the vendor keys; clearing a prefilled value writes null.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { ToastProvider } from '@/src/components/ui';
import type { CompanyRow } from '@/src/lib/db/companies';

import { CompanyFormModal } from './CompanyFormModal';

const vendor = {
  id: 'v1',
  name: 'Paku Mas Supply',
  short_name: null,
  type: 'Vendor',
  client_number_segment: null,
  vendor_code: 'VEN-0077',
  address: 'Jl. Raya 12, Surabaya',
  payment_terms_days: 30,
  supply_risk_status: 'ok',
  org_id: 'org-1',
  archived_at: null,
  created_at: '2026-01-01T00:00:00Z',
} as unknown as CompanyRow;

const client = { ...vendor, id: 'c1', name: 'Cascade Port Authority', type: 'Client', vendor_code: null, address: null, payment_terms_days: null };

const wrap = (ui: React.ReactNode) =>
  render(
    <MemoryRouter>
      <ToastProvider>{ui}</ToastProvider>
    </MemoryRouter>,
  );

const renderEdit = (company: CompanyRow, onUpdate = vi.fn().mockResolvedValue(undefined)) => {
  const onError = vi.fn();
  const view = wrap(<CompanyFormModal company={company} ownership="pmo" onClose={vi.fn()} onUpdate={onUpdate} onError={onError} />);
  return { unmount: view.unmount, onUpdate, onError };
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('AC-3025 vendor details on the company form', () => {
  it('a vendor record shows the vendor details prefilled; a client record hides them', () => {
    const { unmount } = wrap(<CompanyFormModal company={vendor} ownership="pmo" onClose={vi.fn()} onUpdate={vi.fn()} onError={vi.fn()} />);
    expect(screen.getByLabelText(/Vendor code/i)).toHaveValue('VEN-0077');
    expect(screen.getByLabelText(/Payment terms \(days\)/i)).toHaveValue('30');
    expect(screen.getByLabelText(/^Address/i)).toHaveValue('Jl. Raya 12, Surabaya');
    unmount();

    wrap(<CompanyFormModal company={client} ownership="pmo" onClose={vi.fn()} onUpdate={vi.fn()} onError={vi.fn()} />);
    expect(screen.queryByLabelText(/Vendor code/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Payment terms \(days\)/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/^Address/i)).not.toBeInTheDocument();
  });

  it('saving a vendor edit sends the three fields, trimmed, and never sends them for a client', async () => {
    const onUpdate = vi.fn().mockResolvedValue(undefined);
    const { unmount } = renderEdit(vendor, onUpdate);
    await userEvent.click(screen.getByRole('button', { name: /^Save company$/i }));
    await waitFor(() => expect(onUpdate).toHaveBeenCalledTimes(1));
    expect(onUpdate.mock.calls[0][1]).toMatchObject({
      vendor_code: 'VEN-0077',
      address: 'Jl. Raya 12, Surabaya',
      payment_terms_days: 30,
    });
    unmount();

    const clientUpdate = vi.fn().mockResolvedValue(undefined);
    renderEdit(client, clientUpdate);
    await userEvent.click(screen.getByRole('button', { name: /^Save company$/i }));
    await waitFor(() => expect(clientUpdate).toHaveBeenCalledTimes(1));
    expect(clientUpdate.mock.calls[0][1]).not.toHaveProperty('vendor_code');
    expect(clientUpdate.mock.calls[0][1]).not.toHaveProperty('address');
    expect(clientUpdate.mock.calls[0][1]).not.toHaveProperty('payment_terms_days');
  });

  it('clearing a prefilled vendor field writes null', async () => {
    const onUpdate = vi.fn().mockResolvedValue(undefined);
    renderEdit(vendor, onUpdate);
    await userEvent.clear(screen.getByLabelText(/Vendor code/i));
    await userEvent.clear(screen.getByLabelText(/Payment terms \(days\)/i));
    await userEvent.click(screen.getByRole('button', { name: /^Save company$/i }));
    await waitFor(() => expect(onUpdate).toHaveBeenCalledTimes(1));
    expect(onUpdate.mock.calls[0][1]).toMatchObject({ vendor_code: null, payment_terms_days: null });
  });

  it('create mode reveals the vendor details when the type is Vendor', async () => {
    wrap(<CompanyFormModal company={null} ownership="pmo" onClose={vi.fn()} onUpdate={vi.fn()} onCreate={vi.fn().mockResolvedValue(undefined)} onError={vi.fn()} />);
    expect(screen.queryByLabelText(/Vendor code/i)).not.toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText(/^Type/i), 'Vendor');
    expect(screen.getByLabelText(/Vendor code/i)).toBeInTheDocument();
  });

  it('a payment-terms value that is not a whole number of days blocks the save with the error', async () => {
    const onUpdate = vi.fn().mockResolvedValue(undefined);
    renderEdit(vendor, onUpdate);
    await userEvent.clear(screen.getByLabelText(/Payment terms \(days\)/i));
    await userEvent.type(screen.getByLabelText(/Payment terms \(days\)/i), 'net-30');
    await userEvent.click(screen.getByRole('button', { name: /^Save company$/i }));
    expect(onUpdate).not.toHaveBeenCalled();
    expect(await screen.findByText(/whole number of days/i)).toBeInTheDocument();
  });
});
