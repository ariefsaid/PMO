// AC-3025 slice 2 — the vendor's tax number on the ONE company form: rendered only where the
// caller can save it (edit paths that pass the follow-up write), saved after the company row,
// cleared to null, and reported as a partial save when the follow-up write fails.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { ToastProvider } from '@/src/components/ui';
import { AppError } from '@/src/lib/appError';
import type { CompanyRow } from '@/src/lib/db/companies';

import { CompanyFormModal } from './CompanyFormModal';

const vendor = {
  id: 'v1',
  name: 'Paku Mas Supply',
  short_name: null,
  type: 'Vendor',
  client_number_segment: null,
  vendor_code: 'VEN-0077',
  address: null,
  payment_terms_days: 30,
  supply_risk_status: 'ok',
  org_id: 'org-1',
  archived_at: null,
  created_at: '2026-01-01T00:00:00Z',
} as unknown as CompanyRow;

const wrap = (ui: React.ReactNode) =>
  render(
    <MemoryRouter>
      <ToastProvider>{ui}</ToastProvider>
    </MemoryRouter>,
  );

beforeEach(() => {
  vi.clearAllMocks();
});

describe('AC-3025 slice 2: the tax number on the company form', () => {
  it('renders prefilled for a vendor edit with a follow-up writer, and is absent without one', () => {
    const { unmount } = wrap(
      <CompanyFormModal company={vendor} ownership="pmo" taxNumber="01.234.567.8-901.000" onTaxNumberUpdate={vi.fn().mockResolvedValue(undefined)} onClose={vi.fn()} onUpdate={vi.fn()} onError={vi.fn()} />,
    );
    expect(screen.getByLabelText(/Tax number/i)).toHaveValue('01.234.567.8-901.000');
    unmount();

    // Without the writer the form must not offer (or touch) the field.
    wrap(
      <CompanyFormModal company={vendor} ownership="pmo" onClose={vi.fn()} onUpdate={vi.fn()} onError={vi.fn()} />,
    );
    expect(screen.queryByLabelText(/Tax number/i)).not.toBeInTheDocument();
  });

  it('saves the trimmed value after the company row, and clears to null', async () => {
    const onTaxNumberUpdate = vi.fn().mockResolvedValue(undefined);
    const onUpdate = vi.fn().mockResolvedValue(undefined);
    wrap(
      <CompanyFormModal company={vendor} ownership="pmo" taxNumber="01.234.567.8-901.000" onTaxNumberUpdate={onTaxNumberUpdate} onClose={vi.fn()} onUpdate={onUpdate} onError={vi.fn()} />,
    );
    await userEvent.click(screen.getByRole('button', { name: /^Save company$/i }));
    await waitFor(() => expect(onUpdate).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(onTaxNumberUpdate).toHaveBeenCalledTimes(1));
    expect(onTaxNumberUpdate).toHaveBeenCalledWith('v1', '01.234.567.8-901.000');

    await userEvent.clear(screen.getByLabelText(/Tax number/i));
    await userEvent.click(screen.getByRole('button', { name: /^Save company$/i }));
    await waitFor(() => expect(onTaxNumberUpdate).toHaveBeenCalledTimes(2));
    expect(onTaxNumberUpdate).toHaveBeenLastCalledWith('v1', null);
  });

  it('reports a failed tax write as a partial save and keeps the modal open', async () => {
    const onTaxNumberUpdate = vi.fn().mockRejectedValue(new AppError('tax write refused', '42501'));
    const onError = vi.fn();
    wrap(
      <CompanyFormModal company={vendor} ownership="pmo" taxNumber="01.234.567.8-901.000" onTaxNumberUpdate={onTaxNumberUpdate} onClose={vi.fn()} onUpdate={vi.fn().mockResolvedValue(undefined)} onError={onError} />,
    );
    await userEvent.click(screen.getByRole('button', { name: /^Save company$/i }));
    const note = await screen.findByTestId('company-partial-save');
    expect(note).toHaveTextContent(/saved/i);
    expect(note).toHaveTextContent(/tax number/i);
    expect(screen.getByRole('button', { name: /^Save company$/i })).toBeInTheDocument();
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it('a non-vendor edit never writes the tax number, even when the writer is wired', async () => {
    const client = { ...vendor, id: 'c1', name: 'Cascade Port Authority', type: 'Client' } as unknown as CompanyRow;
    const onTaxNumberUpdate = vi.fn().mockResolvedValue(undefined);
    wrap(
      <CompanyFormModal company={client} ownership="pmo" taxNumber="01.234.567.8-901.000" onTaxNumberUpdate={onTaxNumberUpdate} onClose={vi.fn()} onUpdate={vi.fn().mockResolvedValue(undefined)} onError={vi.fn()} />,
    );
    expect(screen.queryByLabelText(/Tax number/i)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /^Save company$/i }));
    await waitFor(() => expect(onTaxNumberUpdate).not.toHaveBeenCalled());
  });
});
