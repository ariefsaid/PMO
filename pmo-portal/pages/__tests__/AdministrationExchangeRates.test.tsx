import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { FxRateRow, FxRatePage } from '@/src/lib/repositories/types';

const h = vi.hoisted(() => ({
  list: vi.fn<(before?: string) => Promise<FxRatePage>>(),
  orgDay: vi.fn(),
  role: 'Admin',
  context: vi.fn(),
  upsert: vi.fn(),
  existing: vi.fn(),
}));
vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'user-1', org_id: 'org-1', role: h.role }, role: h.role }),
}));
vi.mock('@/src/auth/impersonation', () => ({
  useEffectiveRole: () => ({ realRole: h.role, effectiveRole: h.role }),
}));
vi.mock('@/src/auth/usePermission', () => ({
  usePermission: () => (action: string, entity: string) => {
    if (entity !== 'fxRate') return false;
    if (action === 'view' || action === 'upload') return h.role === 'Admin' || h.role === 'Finance';
    return h.role === 'Admin';
  },
}));
vi.mock('@/src/lib/repositories', () => ({
  repositories: {
    fxRates: { list: h.list, context: h.context, upsert: h.upsert, existing: h.existing },
  },
}));
vi.mock('@/src/hooks/useFxOrgDay', () => ({ useFxOrgDay: () => h.orgDay() }));

import AdministrationExchangeRates from '../AdministrationExchangeRates';
import { ToastProvider } from '@/src/components/ui';

const fxRow = (index: number): FxRateRow => ({
  id: `rate-${index}`,
  org_id: 'org-1',
  rate_date: new Date(Date.UTC(2026, 9, 31 - index)).toISOString().slice(0, 10),
  rate: 16000 + index,
  base_currency: 'USD',
  quote_currency: 'IDR',
  source: 'JISDOR',
  created_by: null,
  updated_by: null,
  created_at: '2026-10-01T00:00:00Z',
  updated_at: '2026-10-01T00:00:00Z',
});
const rows = Array.from({ length: 51 }, (_, i) => fxRow(i));

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <AdministrationExchangeRates />
      </ToastProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  h.role = 'Admin';
  h.list.mockReset();
  h.orgDay.mockReset();
  h.orgDay.mockReturnValue({ day: '2026-10-31', isPending: false, isError: false, retry: vi.fn() });
  h.list.mockImplementation(async (before) =>
    before
      ? { rows: rows.slice(50), nextCursor: null }
      : { rows: rows.slice(0, 50), nextCursor: rows[49].rate_date },
  );
  h.context.mockResolvedValue({ currency: 'IDR', timezone: 'Asia/Jakarta' });
  h.upsert.mockResolvedValue({ new: 1, changed: 0, unchanged: 0 });
  h.existing.mockResolvedValue([]);
});
afterEach(() => cleanup());

describe('AC-FX-008 Administration exchange-rate list', () => {
  it('shows 50 newest rows, keys the next page by the last shown date, and returns via Previous', async () => {
    renderPage();
    const table = await screen.findByRole('table');
    expect(within(table).getAllByRole('row')).toHaveLength(51);
    expect(h.list).toHaveBeenCalledWith(undefined);
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() => expect(h.list).toHaveBeenCalledWith(rows[49].rate_date));
    expect(within(await screen.findByRole('table')).getAllByRole('row')).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: 'Previous' }));
    await waitFor(() => expect(screen.getByRole('table')).toBeInTheDocument());
    expect(h.list).toHaveBeenCalledWith(undefined);
  });

  it('AC-FX-007 connects Upload to preview and saves once with committed counts', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Upload rates' }));
    const input = screen.getByLabelText(/Choose BI Excel or date,rate CSV/);
    const file = new File(['date,rate\n2026-10-12,16234.56'], 'rates.csv', { type: 'text/csv' });
    fireEvent.change(input, { target: { files: [file] } });
    expect(await screen.findByText(/1 new/i)).toBeInTheDocument();
    expect(h.upsert).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Save rates' }));
    await waitFor(() =>
      expect(h.upsert).toHaveBeenCalledWith([{ rate_date: '2026-10-12', rate: 16234.56 }]),
    );
    expect(await screen.findByRole('status')).toHaveTextContent(
      /Rates saved: 1 new, 0 changed, 0 unchanged/i,
    );
    expect(screen.queryByRole('dialog', { name: 'Upload rates' })).not.toBeInTheDocument();
  });

  it('AC-FX-009 looks up an existing date before writing and Cancel restores the edited draft', async () => {
    h.existing.mockResolvedValueOnce([{ rate_date: '2026-10-12', rate: 16019 }]);
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'New rate' }));
    fireEvent.change(screen.getByLabelText(/Publication date/), {
      target: { value: '2026-10-12' },
    });
    fireEvent.change(screen.getByLabelText(/IDR per USD/), { target: { value: '17000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save rate' }));
    expect(await screen.findByText(/Replace the rate for Oct 12, 2026/i)).toBeInTheDocument();
    expect(screen.getByText(/16,019 → 17,000 IDR per USD/)).toBeInTheDocument();
    expect(h.existing).toHaveBeenCalledWith(['2026-10-12']);
    expect(h.upsert).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(await screen.findByRole('dialog', { name: 'New rate' })).toBeInTheDocument();
    expect(screen.getByLabelText(/IDR per USD/)).toHaveValue('17,000');
    expect(h.upsert).not.toHaveBeenCalled();
  });

  it('AC-FX-009 confirms exactly one overwrite and reports the committed counts', async () => {
    h.existing.mockResolvedValueOnce([{ rate_date: '2026-10-12', rate: 16019 }]);
    h.upsert.mockResolvedValueOnce({ new: 0, changed: 1, unchanged: 0 });
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'New rate' }));
    fireEvent.change(screen.getByLabelText(/Publication date/), {
      target: { value: '2026-10-12' },
    });
    fireEvent.change(screen.getByLabelText(/IDR per USD/), { target: { value: '17000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save rate' }));
    await screen.findByText(/Replace the rate for Oct 12, 2026/i);
    fireEvent.click(screen.getByRole('button', { name: 'Save rates' }));
    await waitFor(() => expect(h.upsert).toHaveBeenCalledTimes(1));
    expect(h.upsert).toHaveBeenCalledWith([{ rate_date: '2026-10-12', rate: 17000 }]);
    expect(await screen.findByRole('status')).toHaveTextContent(
      /Rates saved: 0 new, 1 changed, 0 unchanged/i,
    );
  });

  it('AC-FX-009 treats an identical rate as unchanged without overwrite confirmation', async () => {
    h.existing.mockResolvedValueOnce([{ rate_date: '2026-10-12', rate: 17000 }]);
    h.upsert.mockResolvedValueOnce({ new: 0, changed: 0, unchanged: 1 });
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'New rate' }));
    fireEvent.change(screen.getByLabelText(/Publication date/), {
      target: { value: '2026-10-12' },
    });
    fireEvent.change(screen.getByLabelText(/IDR per USD/), { target: { value: '17000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save rate' }));
    await waitFor(() =>
      expect(h.upsert).toHaveBeenCalledWith([{ rate_date: '2026-10-12', rate: 17000 }]),
    );
    expect(screen.queryByText(/Replace the rate for/i)).not.toBeInTheDocument();
    expect(await screen.findByRole('status')).toHaveTextContent(
      /Rates saved: 0 new, 0 changed, 1 unchanged/i,
    );
  });

  it('AC-FX-009 preserves the entered date and rate after a failed write', async () => {
    h.existing.mockResolvedValueOnce([]);
    h.upsert.mockRejectedValueOnce(new Error('offline'));
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'New rate' }));
    fireEvent.change(screen.getByLabelText(/Publication date/), {
      target: { value: '2026-10-12' },
    });
    fireEvent.change(screen.getByLabelText(/IDR per USD/), { target: { value: '17000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save rate' }));
    expect(await screen.findByText(/offline/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Publication date/)).toHaveValue('2026-10-12');
    expect(screen.getByLabelText(/IDR per USD/)).toHaveValue('17,000');
  });

  it('keeps one primary Upload action when Finance sees an empty list', async () => {
    h.role = 'Finance';
    h.list.mockResolvedValueOnce({ rows: [], nextCursor: null });
    renderPage();

    expect(await screen.findByText('No JISDOR rates yet')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Upload rates' })).toHaveLength(1);
  });

  it('distinguishes loading, error with retry, and empty list states', async () => {
    let resolve: ((page: FxRatePage) => void) | undefined;
    h.list.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    renderPage();
    expect(screen.getByTestId('fx-rates-loading')).toHaveAttribute('aria-busy', 'true');
    resolve?.({ rows: [], nextCursor: null });
    expect(await screen.findByText('No JISDOR rates yet')).toBeInTheDocument();

    cleanup();
    h.list.mockClear();
    h.list.mockRejectedValueOnce(new Error('offline'));
    renderPage();
    expect(await screen.findByText('Could not load exchange rates')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(h.list).toHaveBeenCalledTimes(2));
  });
});

describe('S-38 / RF-054 — empty reference-rate history leaves a useful setup path', () => {
  it('offers the reviewed setup path: consequence copy, reference-vs-accounting scope, and one Upload action that opens the dialog', async () => {
    h.role = 'Finance';
    h.list.mockResolvedValue({ rows: [], nextCursor: null });
    renderPage();

    expect(await screen.findByText('No JISDOR rates yet')).toBeInTheDocument();
    // The missing rates have a named consequence (RF-054): rupiah equivalents stay unavailable.
    expect(
      screen.getByText(/Upload BI's JISDOR history to show rupiah equivalents/),
    ).toBeInTheDocument();
    // Reference equivalents are not accounting figures — the page says so before any upload.
    expect(
      screen.getByText(/accounting records are never changed/i),
    ).toBeInTheDocument();
    // Exactly one primary setup action (the empty state carries it; the header stands down).
    const uploadButtons = screen.getAllByRole('button', { name: 'Upload rates' });
    expect(uploadButtons).toHaveLength(1);
    fireEvent.click(uploadButtons[0]);
    expect(await screen.findByRole('dialog', { name: 'Upload rates' })).toBeInTheDocument();
  });

  it('without upload permission the path names who can act and renders no dead control', async () => {
    h.role = 'PM';
    h.list.mockResolvedValue({ rows: [], nextCursor: null });
    renderPage();

    expect(await screen.findByText('No JISDOR rates yet')).toBeInTheDocument();
    expect(
      screen.getByText(/An Admin or Finance member can upload them from this page/i),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Upload rates' })).not.toBeInTheDocument();
  });

  it('loaded pages state the shown coverage and flag earlier pages instead of implying the whole history', async () => {
    renderPage();
    await screen.findByRole('table');
    const summary = screen.getByTestId('fx-page-summary');
    expect(summary).toHaveTextContent('Rates shown: 50');
    expect(summary).toHaveTextContent('dates Sep 12, 2026 to Oct 31, 2026');
    expect(summary).toHaveTextContent('earlier rates on the next pages');

    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    const lastPage = await screen.findByTestId('fx-page-summary');
    expect(lastPage).toHaveTextContent('Rates shown: 1');
    expect(lastPage).toHaveTextContent('dates Sep 11, 2026 to Sep 11, 2026');
    expect(lastPage).not.toHaveTextContent('earlier rates on the next pages');
  });

  it('upload preview states the reviewed file’s coverage window before confirmation', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Upload rates' }));
    const input = screen.getByLabelText(/Choose BI Excel or date,rate CSV/);
    const file = new File(
      ['date,rate\n2026-10-05,16100\n2026-10-07,16150\n2026-10-09,16200'],
      'rates.csv',
      { type: 'text/csv' },
    );
    fireEvent.change(input, { target: { files: [file] } });
    expect(await screen.findByText('3 new')).toBeInTheDocument();
    const summary = screen.getByLabelText('Import preview summary');
    expect(summary).toHaveTextContent('Covers Oct 5, 2026 → Oct 9, 2026');
  });

  it('shows the publication date when a valid file contains one accepted rate', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Upload rates' }));
    const input = screen.getByLabelText(/Choose BI Excel or date,rate CSV/);
    const file = new File(['date,rate\n2026-10-12,16400'], 'rates.csv', {
      type: 'text/csv',
    });
    fireEvent.change(input, { target: { files: [file] } });

    expect(await screen.findByText('1 new')).toBeInTheDocument();
    expect(screen.getByLabelText('Import preview summary')).toHaveTextContent(
      'Covers Oct 12, 2026 → Oct 12, 2026',
    );
  });
});
