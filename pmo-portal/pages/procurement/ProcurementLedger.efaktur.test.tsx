import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProcurementLedger } from './ProcurementLedger';
import type { LedgerRow } from '@/src/lib/db/procurementLedger';
import type { ProcurementDetail } from '@/src/lib/db/procurementLifecycle';
import { formatDateOnly } from '@/src/lib/format';

vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'user-finance', org_id: 'org-1', role: 'Finance' } }),
}));
vi.mock('@/src/auth/impersonation', () => ({
  useEffectiveRole: () => ({ realRole: 'Finance', effectiveRole: 'Finance', canImpersonate: false, viewAs: vi.fn() }),
}));
vi.mock('@/src/hooks/useProcurementRecords', () => ({
  useProcurementRecordMutations: () => ({
    createPurchaseRequest: { mutateAsync: vi.fn(), isPending: false },
    createRfq: { mutateAsync: vi.fn(), isPending: false },
    createPurchaseOrder: { mutateAsync: vi.fn(), isPending: false },
    createPayment: { mutateAsync: vi.fn(), isPending: false },
    pendingPush: { status: 'idle', lastError: null, lastPushAt: null },
  }),
}));
vi.mock('@/src/hooks/useProcurementFiles', () => ({
  useProcurementFiles: () => ({ list: { data: [], isPending: false, isError: false }, upload: { mutate: vi.fn(), isPending: false }, archive: { mutate: vi.fn(), isPending: false }, download: vi.fn(), progress: null, uploadError: null, cancelUpload: vi.fn(), clearUploadError: vi.fn() }),
}));
vi.mock('@/src/lib/db/procurementFiles', () => ({ listProcurementFiles: vi.fn(), getSignedDownloadUrl: vi.fn() }));

const detail = { id: 'proc-1', status: 'Paid', created_at: '2026-10-01T00:00:00Z' } as ProcurementDetail;
const invoiceRow: LedgerRow = {
  id: 'Invoice-vi-1', date: '2026-10-01', type: 'Invoice', systemNumber: 'VI-1', externalRef: null,
  amount: 100, status: 'Paid', statusVariant: 'won', fileHref: null, fileTitle: null, fileCount: 0,
  financial: true, recordId: 'vi-1', currency: 'IDR', taxTreatment: 'inclusive',
  efakturNumber: '010.001-26.12345678', efakturDate: '2026-09-28', efakturLocked: false,
};
const paymentRow: LedgerRow = {
  ...invoiceRow, id: 'Payment-pay-1', type: 'Payment', systemNumber: 'PAY-1', recordId: 'pay-1',
  efakturNumber: null, efakturDate: null,
};

/** `rowLabel`'s cell under the column headed `header`. */
function cellOf(rowLabel: string, header: string): HTMLElement {
  const headers = screen.getAllByRole('columnheader').map((h) => h.textContent?.trim());
  const col = headers.indexOf(header);
  expect(col).toBeGreaterThanOrEqual(0);
  const row = screen.getByText(rowLabel).closest('tr');
  if (!row) throw new Error(`no table row for ${rowLabel}`);
  return within(row).getAllByRole('cell')[col];
}

/** Stubs `matchMedia` so the shared DataTable renders its <768px card branch. */
function mockMobile() {
  vi.stubGlobal('matchMedia', vi.fn().mockImplementation((query: string) => ({
    matches: false, media: query, onchange: null, addEventListener: vi.fn(), removeEventListener: vi.fn(),
    addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn(),
  })));
}

afterEach(() => vi.unstubAllGlobals());

function renderLedger(props: Partial<React.ComponentProps<typeof ProcurementLedger>> = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter><QueryClientProvider client={queryClient}>
      <ProcurementLedger
        detail={detail} rows={[invoiceRow, paymentRow]} procurementId="proc-1" uploadedById={null}
        canWrite={false} invoices={[]} {...props}
      />
    </QueryClientProvider></MemoryRouter>,
  );
}

describe('ProcurementLedger e-Faktur details', () => {
  it('AC-EFK-005 shows the vendor invoice number + date in ONE e-Faktur cell; other record types render none', () => {
    renderLedger();
    const headers = screen.getAllByRole('columnheader').map((h) => h.textContent?.trim());
    expect(headers).not.toContain('e-Faktur number');
    expect(headers).not.toContain('e-Faktur date');
    const cell = cellOf('VI-1', 'e-Faktur');
    expect(within(cell).getByText('010.001-26.12345678')).toHaveClass('font-mono');
    // the e-Faktur date is its own fact, not the invoice date (2026-10-01), as a muted second line
    expect(within(cell).getByText(formatDateOnly('2026-09-28'))).toHaveClass('text-muted-foreground');
    // a payment carries no e-Faktur: blank, not a dash
    expect(cellOf('PAY-1', 'e-Faktur').textContent).toBe('');
  });

  it('AC-EFK-005 an invoice with no e-Faktur yet shows a dash; on mobile only the invoice card carries the e-Faktur line', () => {
    mockMobile();
    renderLedger({ rows: [{ ...invoiceRow, efakturNumber: null, efakturDate: null }, paymentRow] });
    const cards = Array.from(screen.getByTestId('dt-card-branch').querySelectorAll(':scope > li'));
    const invoiceCard = cards.find((c) => c.textContent?.includes('VI-1'))!;
    const paymentCard = cards.find((c) => c.textContent?.includes('PAY-1'))!;
    const labels = (card: Element) => Array.from(card.querySelectorAll('dt')).map((dt) => dt.textContent);
    expect(labels(invoiceCard)).toContain('e-Faktur');
    expect(labels(paymentCard)).not.toContain('e-Faktur');
  });

  it('AC-EFK-005 offers the Admin/Finance edit action only for non-cancelled invoices and saves selected id', async () => {
    const onSetEfaktur = vi.fn().mockResolvedValue(undefined);
    renderLedger({ canRecordEfaktur: true, onSetEfaktur });
    expect(screen.getAllByRole('button', { name: 'Row actions' })).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Row actions' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Record e-Faktur' }));
    fireEvent.change(screen.getByLabelText('e-Faktur number'), { target: { value: ' 010.001-26.12345678 ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(onSetEfaktur).toHaveBeenCalledWith('vi-1', {
      efakturNumber: '010.001-26.12345678', efakturDate: '2026-09-28',
    }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('AC-EFK-005 hides edit for cancelled vendor invoices and non-Finance/Admin users', () => {
    const cancelled = renderLedger({ canRecordEfaktur: true, rows: [{ ...invoiceRow, efakturLocked: true }] });
    expect(screen.queryByRole('button', { name: 'Row actions' })).not.toBeInTheDocument();
    cancelled.unmount();
    renderLedger({ canRecordEfaktur: false });
    expect(screen.queryByRole('button', { name: 'Row actions' })).not.toBeInTheDocument();
  });
});
