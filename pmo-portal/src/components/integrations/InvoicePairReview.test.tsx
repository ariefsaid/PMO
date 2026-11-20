import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ImpersonationProvider } from '@/src/auth/impersonation';
import { createInstance } from 'i18next';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import en from '../../../public/locales/en/administration.json';
import id from '../../../public/locales/id/administration.json';
import { AppError } from '@/src/lib/appError';

const h = vi.hoisted(() => ({
  proposeInvoicePairs: vi.fn(),
  acceptInvoicePairs: vi.fn(),
  unpairInvoice: vi.fn(),
  compareAndUnpairInvoice: vi.fn(),
  listUnpairedNativeInvoices: vi.fn(),
  listAcceptedInvoicePairs: vi.fn(),
  listOwn: vi.fn(),
}));
vi.mock('@/src/lib/repositories', () => ({ repositories: { revenue: h, externalDomainOwnership: { listOwn: h.listOwn } } }));

import { InvoicePairReview } from './InvoicePairReview';

const proposal = (n: number, extra: Record<string, unknown> = {}) => ({
  pmoInvoiceId: `n${n}`, erpInvoiceId: `e${n}`, ambiguous: false, pmoNumber: `PMO-${n}`, erpNumber: `SI-${n}`,
  customerName: 'Acme Co', amount: 1000 * n, currency: 'IDR', invoiceDate: '2026-03-10', ...extra,
});

beforeEach(() => {
  vi.clearAllMocks();
  h.listOwn.mockResolvedValue([{ domain: 'revenue', externalTier: 'erp' }]);
  h.proposeInvoicePairs.mockResolvedValue([proposal(1), proposal(2)]);
  h.listUnpairedNativeInvoices.mockResolvedValue([]);
  h.listAcceptedInvoicePairs.mockResolvedValue([]);
  h.acceptInvoicePairs.mockResolvedValue(2);
  h.unpairInvoice.mockResolvedValue(undefined);
  h.compareAndUnpairInvoice.mockResolvedValue(undefined);
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
    { pmoInvoiceId: 'n9', pmoNumber: 'PMO-9', amount: 9000, currency: 'IDR', pairedAt: '2026-11-02T01:00:00Z', erpInvoiceId: 'e9', erpLifecycle: { docstatus: 1, cancelledAt: null }, erpNumber: 'SI-9', erpCancelled: false, erpReplacedBy: null },
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

const paired9 = { pmoInvoiceId: 'n9', pmoNumber: 'PMO-9', amount: 9000, currency: 'IDR', pairedAt: '2026-11-02T01:00:00Z', erpInvoiceId: 'e9', erpLifecycle: { docstatus: 1, cancelledAt: null }, erpNumber: 'SI-9', erpCancelled: false, erpReplacedBy: null };
const released = () => h.listOwn.mockResolvedValue([{ domain: 'procurement', externalTier: 'erp' }]);

it('PERF-FIN-1 reads no proposals or unpaired invoices, and shows nothing, while no ERP owns revenue', async () => {
  released();
  mount();
  await waitFor(() => expect(h.listAcceptedInvoicePairs).toHaveBeenCalled());
  await new Promise((r) => setTimeout(r, 20));
  expect(h.proposeInvoicePairs).not.toHaveBeenCalled();
  expect(h.listUnpairedNativeInvoices).not.toHaveBeenCalled();
  expect(screen.queryByText('PMO-1')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Count each once' })).not.toBeInTheDocument();
});

it('PERF-FIN-1 pairs accepted before the ERP released revenue still show their count and stay undoable', async () => {
  released();
  h.listAcceptedInvoicePairs.mockResolvedValue([paired9]);
  mount();

  fireEvent.click(await screen.findByText('1 invoice already counts once'));
  fireEvent.click(screen.getByRole('button', { name: 'Undo PMO-9' }));
  fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Undo' }));
  await waitFor(() => expect(h.compareAndUnpairInvoice).toHaveBeenCalledWith(expect.objectContaining({ pmoInvoiceId: 'n9', erpInvoiceId: 'e9' })));
  expect(h.proposeInvoicePairs).not.toHaveBeenCalled();
});

it('PERF-FIN-1 a failed ownership read still reads the proposals, as before', async () => {
  h.listOwn.mockRejectedValue(new Error('ownership down'));
  mount();
  expect(await screen.findByText('PMO-1')).toBeInTheDocument();
  expect(h.proposeInvoicePairs).toHaveBeenCalled();
});

it('PERF-FIN-1 proposals cached from an ERP era are not shown once ownership is released', async () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(['invoicePairs', 'propose', 'org-1'], [proposal(1)]);
  released();
  render(
    <QueryClientProvider client={qc}>
      <ImpersonationProvider realRole="Finance"><InvoicePairReview orgId='org-1' /></ImpersonationProvider>
    </QueryClientProvider>,
  );
  await waitFor(() => expect(h.listOwn).toHaveBeenCalled());
  await new Promise((r) => setTimeout(r, 20));
  expect(screen.queryByText('PMO-1')).not.toBeInTheDocument();
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
    { pmoInvoiceId: 'n9', pmoNumber: 'PMO-9', amount: 9000, currency: 'IDR', pairedAt: '2026-11-02T01:00:00Z', erpInvoiceId: 'e9', erpLifecycle: { docstatus: 1, cancelledAt: null }, erpNumber: 'SI-9', erpCancelled: false, erpReplacedBy: null },
  ]);
  mount();

  fireEvent.click(await screen.findByText('1 invoice already counts once'));
  fireEvent.click(screen.getByRole('button', { name: 'Undo PMO-9' }));
  const dialog = await screen.findByRole('dialog', { name: 'Count PMO-9 on its own again?' });
  expect(h.compareAndUnpairInvoice).not.toHaveBeenCalled();
  fireEvent.click(within(dialog).getByRole('button', { name: 'Undo' }));

  await waitFor(() => expect(h.compareAndUnpairInvoice).toHaveBeenCalledWith(expect.objectContaining({ pmoInvoiceId: 'n9', erpInvoiceId: 'e9' })));
  await waitFor(() => expect(h.listAcceptedInvoicePairs).toHaveBeenCalledTimes(2));
  expect(await screen.findByRole('status')).toHaveTextContent('PMO-9 counts on its own again.');
});

it('I3 a refused undo says nothing changed', async () => {
  h.proposeInvoicePairs.mockResolvedValue([]);
  h.listAcceptedInvoicePairs.mockResolvedValue([
    { pmoInvoiceId: 'n9', pmoNumber: 'PMO-9', amount: 9000, currency: 'IDR', pairedAt: '2026-11-02T01:00:00Z', erpInvoiceId: 'e9', erpLifecycle: { docstatus: 1, cancelledAt: null }, erpNumber: 'SI-9', erpCancelled: false, erpReplacedBy: null },
  ]);
  h.compareAndUnpairInvoice.mockRejectedValue(new AppError('this invoice is not paired', '23514', 'not-paired'));
  mount();

  fireEvent.click(await screen.findByText('1 invoice already counts once'));
  fireEvent.click(screen.getByRole('button', { name: 'Undo PMO-9' }));
  fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Undo' }));

  expect(await screen.findByRole('alert')).toHaveTextContent('Nothing was changed');
});

it('a changed pair asks Finance to review the refreshed information', async () => {
  h.proposeInvoicePairs.mockResolvedValue([]);
  h.listAcceptedInvoicePairs.mockResolvedValue([paired9]);
  h.compareAndUnpairInvoice.mockRejectedValue(new AppError('pair changed; review it again', '23514', 'pair-changed'));
  mount();
  fireEvent.click(await screen.findByText('1 invoice already counts once'));
  fireEvent.click(screen.getByRole('button', { name: 'Undo PMO-9' }));
  fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Undo' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('The pair or ERP status changed. Review the refreshed information and try again.');
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

it('a failed read is shown with a retry, never as an empty or complete list', async () => {
  h.proposeInvoicePairs.mockRejectedValueOnce(new AppError('network down', 'FETCH'));
  h.listUnpairedNativeInvoices.mockResolvedValue([
    { invoiceId: 'n2', pmoNumber: 'PMO-2', customerName: 'Acme Co', invoiceDate: '2026-03-11', amount: 5000, currency: 'IDR', reason: 'no-match' },
  ]);
  mount();

  const alert = await screen.findByRole('alert');
  expect(alert).toHaveTextContent('Could not load the matching invoices.');
  expect(screen.getByText(/PMO-2/)).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Count each once' })).not.toBeInTheDocument();

  fireEvent.click(within(alert).getByRole('button', { name: 'Retry' }));
  expect(await screen.findByText('PMO-1')).toBeInTheDocument();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

it('every failed read says so, even when nothing else loaded', async () => {
  h.proposeInvoicePairs.mockRejectedValue(new AppError('down', 'FETCH'));
  h.listUnpairedNativeInvoices.mockRejectedValue(new AppError('down', 'FETCH'));
  h.listAcceptedInvoicePairs.mockRejectedValue(new AppError('down', 'FETCH'));
  mount();

  await waitFor(() => expect(screen.getAllByRole('alert')).toHaveLength(3));
  expect(screen.getByText('Could not load the matching invoices.')).toBeInTheDocument();
  expect(screen.getByText('Could not load the invoices still counted as PMO invoices.')).toBeInTheDocument();
  expect(screen.getByText('Could not load the invoices that already count once.')).toBeInTheDocument();
});

const pair = (n: number, extra: Record<string, unknown> = {}) => ({
  pmoInvoiceId: `n${n}`, pmoNumber: `PMO-${n}`, amount: 1000 * n, currency: 'IDR', pairedAt: '2026-11-02T01:00:00Z',
  erpInvoiceId: `e${n}`, erpLifecycle: { docstatus: 2, cancelledAt: null },
  erpNumber: `SI-${n}`, erpCancelled: false, erpReplacedBy: null, ...extra,
});

it('AC-ECA-033 a pair whose ERP invoice was cancelled is flagged without claiming an unverified replacement', async () => {
  h.proposeInvoicePairs.mockResolvedValue([]);
  h.listAcceptedInvoicePairs.mockResolvedValue([
    pair(1, { erpCancelled: true, erpReplacedBy: 'SI-1-1' }),
    pair(2, { erpCancelled: true }),
    pair(3),
  ]);
  mount();

  const flagged = await screen.findByRole('region', { name: 'ERP invoice cancelled' });
  expect(flagged).toHaveTextContent('excluded from the project invoice total');
  expect(within(flagged).getByText('PMO-1')).toBeInTheDocument();
  expect(flagged).toHaveTextContent('ERP invoice SI-1 was cancelled');
  expect(flagged).not.toHaveTextContent('SI-1-1');
  expect(flagged).toHaveTextContent('ERP invoice SI-2 was cancelled');
  expect(within(flagged).queryByText('PMO-3')).not.toBeInTheDocument();
  expect(within(flagged).getByRole('button', { name: 'Undo PMO-2' })).toBeVisible();
  // the done list counts only the pair that really counts once
  expect(screen.getByText('1 invoice already counts once')).toBeInTheDocument();
});

it('AC-ECA-033 undoing a cancelled pair says the sale will count as the PMO invoice, then unpairs it', async () => {
  h.proposeInvoicePairs.mockResolvedValue([]);
  h.listAcceptedInvoicePairs.mockResolvedValue([pair(1, { erpCancelled: true })]);
  mount();

  const flagged = await screen.findByRole('region', { name: 'ERP invoice cancelled' });
  fireEvent.click(within(flagged).getByRole('button', { name: 'Undo PMO-1' }));
  const dialog = await screen.findByRole('dialog', { name: 'Count PMO-1 on its own again?' });
  expect(dialog).toHaveTextContent('ERP invoice SI-1 is cancelled. Undo the pair to count PMO-1 on its own again.');
  expect(h.compareAndUnpairInvoice).not.toHaveBeenCalled();
  fireEvent.click(within(dialog).getByRole('button', { name: 'Undo' }));

  await waitFor(() => expect(h.compareAndUnpairInvoice).toHaveBeenCalledWith(expect.objectContaining({ pmoInvoiceId: 'n1', erpInvoiceId: 'e1', pairedAt: '2026-11-02T01:00:00Z', erpLifecycle: { docstatus: 2, cancelledAt: null } })));
  expect(await screen.findByRole('status')).toHaveTextContent('PMO-1 counts on its own again.');
});

it('AC-ECA-033 the cancelled section stays hidden while no pair points at a cancelled ERP invoice', async () => {
  h.proposeInvoicePairs.mockResolvedValue([]);
  h.listAcceptedInvoicePairs.mockResolvedValue([pair(3)]);
  mount();

  expect(await screen.findByText('1 invoice already counts once')).toBeInTheDocument();
  expect(screen.queryByRole('region', { name: 'ERP invoice cancelled' })).not.toBeInTheDocument();
});


it('a cancelled pair stays reviewable and undoable after ERP ownership is released', async () => {
  released();
  h.listAcceptedInvoicePairs.mockResolvedValue([pair(1, { erpCancelled: true })]);
  mount();
  const section = await screen.findByRole('region', { name: 'ERP invoice cancelled' });
  expect(h.compareAndUnpairInvoice).not.toHaveBeenCalled();
  fireEvent.click(within(section).getByRole('button', { name: 'Undo PMO-1' }));
  expect(h.compareAndUnpairInvoice).not.toHaveBeenCalled();
  fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Undo' }));
  await waitFor(() => expect(h.compareAndUnpairInvoice).toHaveBeenCalledWith(expect.objectContaining({ pmoInvoiceId: 'n1', erpInvoiceId: 'e1' })));
  expect(h.proposeInvoicePairs).not.toHaveBeenCalled();
});

it('a role without pairing permission cannot read or undo a cancelled pair', () => {
  h.listAcceptedInvoicePairs.mockResolvedValue([pair(1, { erpCancelled: true })]);
  mount('Engineer');
  expect(h.listAcceptedInvoicePairs).not.toHaveBeenCalled();
  expect(screen.queryByRole('button', { name: 'Undo PMO-1' })).not.toBeInTheDocument();
});

it('does not offer stale identities when the accepted-pair refresh itself fails', async () => {
  h.proposeInvoicePairs.mockResolvedValue([]);
  h.listAcceptedInvoicePairs.mockResolvedValueOnce([pair(1)]).mockRejectedValue(new Error('read failed'));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><ImpersonationProvider realRole='Finance'><InvoicePairReview orgId='org-1' /></ImpersonationProvider></QueryClientProvider>);
  expect(await screen.findByText('1 invoice already counts once')).toBeInTheDocument();
  await client.invalidateQueries({ queryKey: ['invoicePairs', 'accepted', 'org-1'] });
  expect(await screen.findByText('Could not load the invoices that already count once.')).toBeInTheDocument();
  expect(screen.queryByText('1 invoice already counts once')).not.toBeInTheDocument();
  expect(screen.queryByRole('region', { name: 'ERP invoice status unknown' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Undo PMO-1' })).not.toBeInTheDocument();
});


it('an unknown ERP lifecycle is not counted as confirmed and remains undoable', async () => {
  h.proposeInvoicePairs.mockResolvedValue([]);
  h.listAcceptedInvoicePairs.mockResolvedValue([pair(1, { erpCancelled: null, erpLifecycle: { docstatus: null, cancelledAt: null } })]);
  mount();
  const unknown = await screen.findByRole('region', { name: 'ERP invoice status unknown' });
  expect(unknown).toHaveTextContent('PMO-1');
  expect(screen.queryByText('1 invoice already counts once')).not.toBeInTheDocument();
  expect(h.compareAndUnpairInvoice).not.toHaveBeenCalled();
  fireEvent.click(within(unknown).getByRole('button', { name: 'Undo PMO-1' }));
  const dialog = await screen.findByRole('dialog');
  expect(dialog).toHaveTextContent('The ERP invoice status could not be confirmed. Undo may restore PMO-1 while the ERP copy is still counted, so the sale may be counted twice.');
  expect(h.compareAndUnpairInvoice).not.toHaveBeenCalled();
  fireEvent.click(within(dialog).getByRole('button', { name: 'Undo' }));
  await waitFor(() => expect(h.compareAndUnpairInvoice).toHaveBeenCalledWith(expect.objectContaining({ pmoInvoiceId: 'n1', erpInvoiceId: 'e1', erpLifecycle: { docstatus: null, cancelledAt: null } })));
});

it('does not confirm coverage when lifecycle information is missing', async () => {
  h.proposeInvoicePairs.mockResolvedValue([]);
  h.listAcceptedInvoicePairs.mockResolvedValue([pair(1, { erpCancelled: undefined })]);
  mount();
  expect(await screen.findByRole('region', { name: 'ERP invoice status unknown' })).toHaveTextContent('PMO-1');
  expect(screen.queryByText('1 invoice already counts once')).not.toBeInTheDocument();
});


it('requires a successful lifecycle retry before confirming an undo', async () => {
  h.proposeInvoicePairs.mockResolvedValue([]);
  h.listAcceptedInvoicePairs.mockResolvedValueOnce([pair(1)]).mockResolvedValueOnce([pair(2, { erpCancelled: null, erpNumber: null, erpLifecycle: null, lifecycleReadFailed: true })]).mockResolvedValue([pair(2, { erpCancelled: null, erpLifecycle: { docstatus: null, cancelledAt: null } })]);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><ImpersonationProvider realRole='Finance'><InvoicePairReview orgId='org-1' /></ImpersonationProvider></QueryClientProvider>);
  expect(await screen.findByText('1 invoice already counts once')).toBeInTheDocument();
  await client.invalidateQueries({ queryKey: ['invoicePairs', 'accepted', 'org-1'] });
  const unknown = await screen.findByRole('region', { name: 'ERP invoice status unknown' });
  expect(unknown).toHaveTextContent('PMO-2');
  expect(screen.getByRole('alert')).toHaveTextContent('Could not load ERP invoice status');
  expect(screen.queryByText('1 invoice already counts once')).not.toBeInTheDocument();
  fireEvent.click(within(unknown).getByRole('button', { name: 'Undo PMO-2' }));
  expect(await screen.findByRole('dialog')).toHaveTextContent('Retry loading the ERP invoice status before undoing this pair.');
  expect(within(screen.getByRole('dialog')).getByRole('button', { name: 'Undo' })).toBeDisabled();
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }));
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  await waitFor(() => expect(screen.queryByText('Could not load ERP invoice status. Review the pairs below.')).not.toBeInTheDocument());
  fireEvent.click(within(await screen.findByRole('region', { name: 'ERP invoice status unknown' })).getByRole('button', { name: 'Undo PMO-2' }));
  fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Undo' }));
  await waitFor(() => expect(h.compareAndUnpairInvoice).toHaveBeenCalledWith(expect.objectContaining({ pmoInvoiceId: 'n2', erpLifecycle: { docstatus: null, cancelledAt: null } })));
});

it('shows an initial lifecycle read failure with the fresh pair available for review', async () => {
  h.proposeInvoicePairs.mockResolvedValue([]);
  h.listAcceptedInvoicePairs.mockResolvedValue([pair(1, { erpCancelled: null, lifecycleReadFailed: true })]);
  mount();
  expect(await screen.findByRole('region', { name: 'ERP invoice status unknown' })).toHaveTextContent('PMO-1');
  expect(screen.getByRole('alert')).toHaveTextContent('Could not load ERP invoice status');
});

it('updates an open undo confirmation when the lifecycle refresh fails', async () => {
  h.proposeInvoicePairs.mockResolvedValue([]);
  h.listAcceptedInvoicePairs.mockResolvedValueOnce([pair(1)]).mockResolvedValue([pair(1, { erpCancelled: null, erpNumber: null, erpLifecycle: null, lifecycleReadFailed: true })]);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><ImpersonationProvider realRole='Finance'><InvoicePairReview orgId='org-1' /></ImpersonationProvider></QueryClientProvider>);
  fireEvent.click(await screen.findByText('1 invoice already counts once'));
  fireEvent.click(screen.getByRole('button', { name: 'Undo PMO-1' }));
  expect(await screen.findByRole('dialog')).toHaveTextContent('ERP invoice SI-1 stays');
  await client.invalidateQueries({ queryKey: ['invoicePairs', 'accepted', 'org-1'] });
  await waitFor(() => expect(screen.getByRole('dialog')).toHaveTextContent('Retry loading the ERP invoice status before undoing this pair.'));
  expect(within(screen.getByRole('dialog')).getByRole('button', { name: 'Undo' })).toBeDisabled();
  expect(h.compareAndUnpairInvoice).not.toHaveBeenCalled();
});


it.each([
  ['en', en, 'ERP invoice cancelled', 'Undo PMO-1', 'The cancelled ERP copy and the paired PMO copy are excluded from the project invoice total.', 'If the sale still stands, undo the pair. If the sale was cancelled, leave it paired.', 'ERP invoice status unknown', 'The ERP invoice status could not be confirmed. Undo may restore PMO-1 while the ERP copy is still counted, so the sale may be counted twice.'],
  ['id', id, 'Invoice ERP dibatalkan', 'Batalkan PMO-1', 'Salinan ERP yang dibatalkan dan salinan PMO yang dipasangkan tidak termasuk dalam total invoice proyek.', 'Jika penjualan masih berlaku, batalkan pasangan. Jika penjualan dibatalkan, biarkan tetap berpasangan.', 'Status invoice ERP tidak diketahui', 'Status invoice ERP tidak dapat dipastikan. Pembatalan pasangan dapat mengembalikan PMO-1 sementara salinan ERP masih terhitung, sehingga penjualan dapat terhitung dua kali.'],
])('explains cancellation and uncertain undo in %s', async (language, catalogue, cancelledTitle, undoLabel, impact, choice, unknownTitle, warning) => {
  const i18n = createInstance();
  await i18n.use(initReactI18next).init({ lng: language, resources: { [language]: { administration: catalogue } }, interpolation: { escapeValue: false } });
  h.proposeInvoicePairs.mockResolvedValue([]);
  h.listAcceptedInvoicePairs.mockResolvedValue([pair(1, { erpCancelled: true }), pair(2, { pmoNumber: 'PMO-1', erpCancelled: null })]);
  render(<I18nextProvider i18n={i18n}><QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><ImpersonationProvider realRole='Finance'><InvoicePairReview orgId='org-1' /></ImpersonationProvider></QueryClientProvider></I18nextProvider>);
  const cancelled = await screen.findByRole('region', { name: cancelledTitle });
  expect(cancelled).toHaveTextContent(impact);
  expect(cancelled).toHaveTextContent(choice);
  const unknown = screen.getByRole('region', { name: unknownTitle });
  fireEvent.click(within(unknown).getByRole('button', { name: undoLabel }));
  expect(await screen.findByRole('dialog')).toHaveTextContent(warning);
});
