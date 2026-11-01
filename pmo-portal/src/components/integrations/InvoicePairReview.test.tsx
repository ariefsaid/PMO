import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ImpersonationProvider } from '@/src/auth/impersonation';
import { AppError } from '@/src/lib/appError';

const h = vi.hoisted(() => ({
  proposeInvoicePairs: vi.fn(),
  acceptInvoicePairs: vi.fn(),
  unpairInvoice: vi.fn(),
  listUnpairedNativeInvoices: vi.fn(),
  listAcceptedInvoicePairs: vi.fn(),
}));
vi.mock('@/src/lib/repositories', () => ({ repositories: { revenue: h } }));

import { InvoicePairReview } from './InvoicePairReview';

const proposal = (n: number, extra: Record<string, unknown> = {}) => ({
  pmoInvoiceId: `n${n}`, erpInvoiceId: `e${n}`, ambiguous: false, pmoNumber: `PMO-${n}`, erpNumber: `SI-${n}`,
  customerName: 'Acme Co', amount: 1000 * n, currency: 'IDR', invoiceDate: '2026-03-10', ...extra,
});

beforeEach(() => {
  vi.clearAllMocks();
  h.proposeInvoicePairs.mockResolvedValue([proposal(1), proposal(2)]);
  h.listUnpairedNativeInvoices.mockResolvedValue([]);
  h.listAcceptedInvoicePairs.mockResolvedValue([]);
  h.acceptInvoicePairs.mockResolvedValue(2);
  h.unpairInvoice.mockResolvedValue(undefined);
});
afterEach(cleanup);

function mount(role: 'Admin' | 'Finance' | 'Engineer' | 'Project Manager' | 'Executive' | null = 'Finance') {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ImpersonationProvider realRole={role}>
        <InvoicePairReview orgId='org-1' />
      </ImpersonationProvider>
    </QueryClientProvider>,
  );
}

it('AC-ECA-030 lists the matching invoices and writes nothing until Finance confirms the count', async () => {
  mount();

  expect(await screen.findByText('PMO-1')).toBeInTheDocument();
  expect(screen.getByText('SI-1')).toBeInTheDocument();
  expect(screen.getByText('PMO-2')).toBeInTheDocument();
  expect(h.acceptInvoicePairs).not.toHaveBeenCalled();

  fireEvent.click(screen.getByRole('button', { name: 'Count each once' }));
  const dialog = await screen.findByRole('dialog', { name: 'Count these invoices once?' });
  expect(dialog).toHaveTextContent('Count 2 invoices once, as the ERP copy?');
  expect(h.acceptInvoicePairs).not.toHaveBeenCalled();

  fireEvent.click(within(dialog).getByRole('button', { name: 'Count once' }));
  await waitFor(() => expect(h.acceptInvoicePairs).toHaveBeenCalledWith([
    { pmoInvoiceId: 'n1', erpInvoiceId: 'e1' },
    { pmoInvoiceId: 'n2', erpInvoiceId: 'e2' },
  ]));
  expect(await screen.findByRole('status')).toHaveTextContent('2 invoices now count once.');
});

it('AC-ECA-030 an invoice that matches more than one ERP invoice needs a decision and is never accepted in bulk', async () => {
  h.proposeInvoicePairs.mockResolvedValue([
    proposal(1),
    proposal(5, { ambiguous: true, erpInvoiceId: 'e5a', erpNumber: 'SI-5A' }),
    proposal(5, { ambiguous: true, erpInvoiceId: 'e5b', erpNumber: 'SI-5B' }),
  ]);
  mount('Admin');

  const needs = await screen.findByRole('region', { name: 'Needs a decision' });
  expect(needs).toHaveTextContent('PMO-5');
  expect(needs).toHaveTextContent('SI-5A');
  expect(needs).toHaveTextContent('SI-5B');

  fireEvent.click(screen.getByRole('button', { name: 'Count each once' }));
  const dialog = await screen.findByRole('dialog', { name: 'Count these invoices once?' });
  expect(dialog).toHaveTextContent('Count 1 invoice once, as the ERP copy?');
  fireEvent.click(within(dialog).getByRole('button', { name: 'Count once' }));
  await waitFor(() => expect(h.acceptInvoicePairs).toHaveBeenCalledWith([{ pmoInvoiceId: 'n1', erpInvoiceId: 'e1' }]));
});

it('AC-ECA-030 PMO invoices without a pair keep counting and say why', async () => {
  h.proposeInvoicePairs.mockResolvedValue([]);
  h.listUnpairedNativeInvoices.mockResolvedValue([
    { invoiceId: 'a', pmoNumber: 'PMO-A', customerName: 'Acme Co', invoiceDate: '2026-03-10', amount: 5000, currency: 'IDR', reason: 'no-match' },
    { invoiceId: 'b', pmoNumber: 'PMO-B', customerName: 'Acme Co', invoiceDate: '2026-03-11', amount: 3000, currency: 'IDR', reason: 'has-receipt' },
  ]);
  mount();

  const region = await screen.findByRole('region', { name: 'Still counted as PMO invoices' });
  expect(region).toHaveTextContent('PMO-A');
  expect(region).toHaveTextContent('No matching ERP invoice');
  expect(region).toHaveTextContent('PMO-B');
  expect(region).toHaveTextContent('PMO already recorded a payment on this invoice');
  expect(screen.queryByRole('button', { name: 'Count each once' })).not.toBeInTheDocument();
});

it('lists the invoices that already count once, with the ERP invoice they point to', async () => {
  h.proposeInvoicePairs.mockResolvedValue([]);
  h.listAcceptedInvoicePairs.mockResolvedValue([
    { pmoInvoiceId: 'n9', pmoNumber: 'PMO-9', amount: 9000, currency: 'IDR', pairedAt: '2026-11-02T01:00:00Z', erpNumber: 'SI-9' },
  ]);
  mount();

  fireEvent.click(await screen.findByText('1 invoice already counts once'));
  expect(screen.getByText('PMO-9')).toBeInTheDocument();
  expect(screen.getByText(/SI-9/)).toBeInTheDocument();
});

it('AC-ECA-030 a refused accept says so, keeps the list and reports no success', async () => {
  h.acceptInvoicePairs.mockRejectedValue(new Error('these invoices are not an unambiguous match'));
  mount();

  fireEvent.click(await screen.findByRole('button', { name: 'Count each once' }));
  const dialog = await screen.findByRole('dialog', { name: 'Count these invoices once?' });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Count once' }));

  expect(await screen.findByRole('alert')).toHaveTextContent('No invoice was changed');
  expect(screen.queryByText(/now count once/)).not.toBeInTheDocument();
  expect(screen.getByText('PMO-1')).toBeInTheDocument();
});

it('shows nothing, and reads nothing, for a role that cannot pair invoices', () => {
  mount('Engineer');
  expect(screen.queryByText('PMO-1')).not.toBeInTheDocument();
  expect(h.proposeInvoicePairs).not.toHaveBeenCalled();
});

it('renders nothing when there is nothing to review', async () => {
  h.proposeInvoicePairs.mockResolvedValue([]);
  mount();
  await waitFor(() => expect(h.proposeInvoicePairs).toHaveBeenCalled());
  await waitFor(() => expect(h.listAcceptedInvoicePairs).toHaveBeenCalled());
  expect(screen.queryByRole('heading')).not.toBeInTheDocument();
});

// I2 (ECA-5 review): Finance, the spec's actor, must see the review; it is mounted outside the Admin-only integrations card.
it.each([
  ['Admin', true], ['Finance', true], ['Executive', false], ['Project Manager', false], ['Engineer', false], [null, false],
] as const)('I2 the pair review is shown to %s: %s', async (role, shown) => {
  mount(role);
  if (shown) {
    expect(await screen.findByText('PMO-1')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Count each once' })).toBeInTheDocument();
  } else {
    expect(screen.queryByText('PMO-1')).not.toBeInTheDocument();
    expect(h.proposeInvoicePairs).not.toHaveBeenCalled();
  }
});

it('I3 an accepted pair can be undone after a confirmation, and the lists reload', async () => {
  h.proposeInvoicePairs.mockResolvedValue([]);
  h.listAcceptedInvoicePairs.mockResolvedValue([
    { pmoInvoiceId: 'n9', pmoNumber: 'PMO-9', amount: 9000, currency: 'IDR', pairedAt: '2026-11-02T01:00:00Z', erpNumber: 'SI-9' },
  ]);
  mount();

  fireEvent.click(await screen.findByText('1 invoice already counts once'));
  fireEvent.click(screen.getByRole('button', { name: 'Undo PMO-9' }));
  const dialog = await screen.findByRole('dialog', { name: 'Count PMO-9 on its own again?' });
  expect(h.unpairInvoice).not.toHaveBeenCalled();
  fireEvent.click(within(dialog).getByRole('button', { name: 'Undo' }));

  await waitFor(() => expect(h.unpairInvoice).toHaveBeenCalledWith('n9'));
  await waitFor(() => expect(h.listAcceptedInvoicePairs).toHaveBeenCalledTimes(2));
  expect(await screen.findByRole('status')).toHaveTextContent('PMO-9 counts on its own again.');
});

it('I3 a refused undo says nothing changed', async () => {
  h.proposeInvoicePairs.mockResolvedValue([]);
  h.listAcceptedInvoicePairs.mockResolvedValue([
    { pmoInvoiceId: 'n9', pmoNumber: 'PMO-9', amount: 9000, currency: 'IDR', pairedAt: '2026-11-02T01:00:00Z', erpNumber: 'SI-9' },
  ]);
  h.unpairInvoice.mockRejectedValue(new AppError('this invoice is not paired', '23514', 'not-paired'));
  mount();

  fireEvent.click(await screen.findByText('1 invoice already counts once'));
  fireEvent.click(screen.getByRole('button', { name: 'Undo PMO-9' }));
  fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Undo' }));

  expect(await screen.findByRole('alert')).toHaveTextContent('Nothing was changed');
});

it('I1 an invoice whose ERP twin sits on another project or work order says so', async () => {
  h.proposeInvoicePairs.mockResolvedValue([]);
  h.listUnpairedNativeInvoices.mockResolvedValue([
    { invoiceId: 'a', pmoNumber: 'PMO-A', customerName: 'Acme Co', invoiceDate: '2026-03-10', amount: 5000, currency: 'IDR', reason: 'project-differs' },
  ]);
  mount();
  const region = await screen.findByRole('region', { name: 'Still counted as PMO invoices' });
  expect(region).toHaveTextContent('The ERP invoice is on a different project or work order');
});

it('M9 a stale pair says the list is out of date instead of a generic failure', async () => {
  h.acceptInvoicePairs.mockRejectedValue(new AppError('these invoices are not an unambiguous match', '23514', 'pair-not-eligible'));
  mount();

  fireEvent.click(await screen.findByRole('button', { name: 'Count each once' }));
  fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Count once' }));

  expect(await screen.findByRole('alert')).toHaveTextContent('no longer a clear match');
});
