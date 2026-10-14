import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { resetActiveLocale, setActiveLocale } from '@/src/lib/locale/activeLocale';
import { FinanceI18nTestProvider } from '@/pages/__tests__/financeI18nTestProvider';
import { financeTestI18n, financeTestI18nReady } from '@/pages/__tests__/financeI18nTestInstance';
const h = vi.hoisted(() => ({ data: { pages: [] as unknown[] }, contexts: {} as Record<string, { state: 'ready' | 'pending' | 'unavailable'; caseTitle?: string; projectName?: string; pmoProjectNumber?: string }>, isError: false, hasNextPage: false, refetch: vi.fn(), fetchNextPage: vi.fn(), save: vi.fn() }));
vi.mock('@/src/hooks/useVendorWithholdingSlips', () => ({ useVendorWithholdingCandidates: () => ({ data: h.data, isLoading: false, isError: h.isError, hasNextPage: h.hasNextPage, refetch: h.refetch, fetchNextPage: h.fetchNextPage, isFetchingNextPage: false }), useVendorWithholdingBillContexts: () => h.contexts }));
import { VendorWithholdingSlipModal } from './VendorWithholdingSlipModal';
import type { ProcurementInvoiceRow } from '@/src/lib/db/procurementLifecycle';
const invoice = { id: 'invoice-a', currency: 'IDR', withheld_amount: 20000, withheld_pph_type: 'pph23' } as ProcurementInvoiceRow;
const bill = { invoice_id: 'invoice-a', vendor_id: 'vendor-a', currency: 'IDR', withheld_amount: '20000.00', withheld_pph_type: 'pph23', invoice_date: '2026-10-01', reference_number: 'SUP-A-1', vi_number: 'VI-A' };
afterEach(() => resetActiveLocale());

describe('AC-BUPOT-017 capture form', () => {
  it('#961 F13 makes candidate checkbox targets at least 44px on phone', async () => {
    h.data = { pages: [{ rows: [bill, { ...bill, invoice_id: 'invoice-unknown', withheld_pph_type: null }] }] };
    render(<VendorWithholdingSlipModal invoice={invoice} vendorId="vendor-a" open onClose={vi.fn()} onSave={h.save} />);
    const select = (await screen.findAllByRole('checkbox', { name: /Select bill.*SUP-A-1/ }))[0];
    expect(select.className).toContain('touch-target');
    expect(select.className).toContain('max-[767px]:!size-11');
    const confirm = screen.getByRole('checkbox', { name: 'Confirm as PPh 23 from issued slip' });
    expect(confirm.className).toContain('touch-target');
    expect(confirm.className).toContain('max-[767px]:!size-11');
  });

  it('#961 F16 retains currency and two cents in candidate reconciliation', async () => {
    const centsBill = { ...bill, withheld_amount: '12345.67' };
    h.data = { pages: [{ rows: [centsBill] }] };
    render(<VendorWithholdingSlipModal invoice={invoice} vendorId="vendor-a" open onClose={vi.fn()} onSave={h.save} />);
    fireEvent.change(await screen.findByLabelText(/issued slip number/i), { target: { value: 'DJ-CENTS-1' } });
    fireEvent.change(screen.getByLabelText(/tax base/i), { target: { value: '50000.00' } });
    fireEvent.change(screen.getByLabelText(/issued withheld amount/i), { target: { value: '12345.67' } });
    const reconciliation = screen.getByText(/Selection .* · Slip .* · Difference/);
    expect(reconciliation).toHaveTextContent(/Selection IDR\s?12,345\.67/);
    expect(reconciliation).toHaveTextContent(/Slip IDR\s?12,345\.67/);
    expect(reconciliation).toHaveTextContent(/Difference IDR\s?0\.00/);
    expect(reconciliation).not.toHaveTextContent(/12345\.67/);
    expect(reconciliation.className).toContain('tabular-nums');
  });

  it('#961 F17 keeps case/date context and appends candidate page two', async () => {
    const first = { ...bill, vi_number: 'VI-FIRST', procurement_id: 'case-first', project_id: 'project-first', invoice_date: '2026-09-03' };
    const second = { ...bill, invoice_id: 'invoice-b', reference_number: 'SUP-B', vi_number: 'VI-SECOND', procurement_id: 'case-second', project_id: 'project-second', invoice_date: '2026-09-04' };
    h.data = { pages: [{ rows: [first] }] };
    h.contexts = { 'invoice-a': { state: 'ready', caseTitle: 'Case first', projectName: 'Project first', pmoProjectNumber: 'PRJ-1' } };
    h.hasNextPage = true;
    h.fetchNextPage.mockClear();
    const view = render(<VendorWithholdingSlipModal invoice={invoice} vendorId="vendor-a" open onClose={vi.fn()} onSave={h.save} />);
    expect(await screen.findByText('Case: Case first')).toBeInTheDocument();
    expect(screen.getByText('Bill date: 2026-09-03')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Load more bills' }));
    expect(h.fetchNextPage).toHaveBeenCalledOnce();
    h.data = { pages: [{ rows: [first] }, { rows: [second] }] };
    h.contexts = { 'invoice-a': { state: 'ready', caseTitle: 'Case first', projectName: 'Project first', pmoProjectNumber: 'PRJ-1' }, 'invoice-b': { state: 'ready', caseTitle: 'Case second', projectName: 'Project second', pmoProjectNumber: 'PRJ-2' } };
    h.hasNextPage = false;
    view.rerender(<VendorWithholdingSlipModal invoice={invoice} vendorId="vendor-a" open onClose={vi.fn()} onSave={h.save} />);
    expect(screen.getByText('System VI number: VI-FIRST')).toBeInTheDocument();
    expect(screen.getByText('System VI number: VI-SECOND')).toBeInTheDocument();
    expect(screen.getByText('Case: Case second')).toBeInTheDocument();
    expect(screen.getByText('Bill date: 2026-09-04')).toBeInTheDocument();
    expect(screen.getByText('Selected bills (1)')).toBeInTheDocument();
  });

  it('#961 F19 retains selected entries across candidate error retry and renders empty copy', async () => {
    h.data = { pages: [{ rows: [bill] }] };
    h.isError = false;
    h.refetch.mockClear();
    const view = render(<VendorWithholdingSlipModal invoice={invoice} vendorId="vendor-a" open onClose={vi.fn()} onSave={h.save} />);
    fireEvent.change(await screen.findByLabelText(/issued slip number/i), { target: { value: 'DJ-RETRY-1' } });
    fireEvent.change(screen.getByLabelText(/tax base/i), { target: { value: '50000.00' } });
    fireEvent.change(screen.getByLabelText(/issued withheld amount/i), { target: { value: '20000.00' } });
    h.isError = true;
    view.rerender(<VendorWithholdingSlipModal invoice={invoice} vendorId="vendor-a" open onClose={vi.fn()} onSave={h.save} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Unable to load eligible bills. Your entries are kept. Retry loading.');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(h.refetch).toHaveBeenCalledOnce();
    expect(screen.getByLabelText(/issued slip number/i)).toHaveValue('DJ-RETRY-1');
    expect(screen.getByText('Selected bills (1)')).toBeInTheDocument();
    h.isError = false;
    h.data = { pages: [{ rows: [] }] };
    view.rerender(<VendorWithholdingSlipModal invoice={invoice} vendorId="vendor-a" open onClose={vi.fn()} onSave={h.save} />);
    expect(screen.getByText('No eligible bills for this vendor, currency and PPh type.')).toBeInTheDocument();
    expect(screen.getByLabelText(/issued slip number/i)).toHaveValue('DJ-RETRY-1');
    expect(screen.getByText('Selected bills (1)')).toBeInTheDocument();
  });

  it('pins the vendor/currency, preselects the starting bill, and refuses a one-cent mismatch', async () => {
    h.data = { pages: [{ rows: [bill] }] };
    render(<VendorWithholdingSlipModal invoice={invoice} vendorId="vendor-a" vendorName="Northwind Supplies" open onClose={vi.fn()} onSave={h.save} />);
    expect((await screen.findAllByText(/IDR.?20,000\.00/)).length).toBeGreaterThan(0);
    expect(screen.getByText(/Northwind Supplies/)).toBeInTheDocument();
    expect(screen.queryByText('vendor-a')).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/issued slip number/i), { target: { value: 'DJ-TEST-1' } });
    fireEvent.change(screen.getByLabelText(/tax base/i), { target: { value: '20000.00' } });
    fireEvent.change(screen.getByLabelText(/issued withheld amount/i), { target: { value: '19999.99' } });
    expect(screen.getByText(/must exactly equal/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /record bukti potong/i })).toBeDisabled();
    expect(h.save).not.toHaveBeenCalled();
  });
  it.each(['en', 'id'] as const)('AC-UXT-001 shows external, system, and case/project identity before selection in %s', async (locale) => {
    await financeTestI18nReady;
    await financeTestI18n.changeLanguage(locale);
    const rows = [
      { ...bill, reference_number: 'SUP-DUP-7', vi_number: 'VI-7001', procurement_id: 'case-a', project_id: 'project-a' },
      { ...bill, invoice_id: 'invoice-b', reference_number: 'SUP-DUP-7', vi_number: 'VI-7002', procurement_id: 'case-b', project_id: 'project-b' },
      { ...bill, invoice_id: 'invoice-c', reference_number: null, vi_number: 'VI-7003', procurement_id: 'case-b', project_id: 'project-b' },
    ];
    h.data = { pages: [{ rows }] };
    h.contexts = {
      'invoice-a': { state: 'ready', caseTitle: 'Case North', projectName: 'Harbor works', pmoProjectNumber: 'PRJ-2641' },
      'invoice-b': { state: 'ready', caseTitle: 'Case South', projectName: 'Canal works', pmoProjectNumber: 'PRJ-2642' },
      'invoice-c': { state: 'ready', caseTitle: 'Case South', projectName: 'Canal works', pmoProjectNumber: 'PRJ-2642' },
    };
    render(<FinanceI18nTestProvider><VendorWithholdingSlipModal invoice={invoice} vendorId="vendor-a" open onClose={vi.fn()} onSave={h.save} /></FinanceI18nTestProvider>);
    const label = locale === 'en' ? /SUP-DUP-7/ : /SUP-DUP-7/;
    expect(screen.getAllByText(label).length).toBeGreaterThan(0);
    expect(screen.getByRole('checkbox', { name: /SUP-DUP-7.*VI-7001.*Case North.*Harbor works.*PRJ-2641.*2026-10-01/ })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /SUP-DUP-7.*VI-7002.*Case South.*Canal works.*PRJ-2642/ })).toBeInTheDocument();
    expect(screen.getByText(locale === 'en' ? 'Vendor invoice reference not recorded' : 'Referensi faktur vendor belum dicatat')).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent('invoice-a');
    await financeTestI18n.changeLanguage('en');
  });

  it('AC-UXT-002 keeps intended IDs, declaration, typed facts, and exact-cent total through page append and retry', async () => {
    h.save.mockReset().mockResolvedValue(undefined);
    h.isError = false;
    h.hasNextPage = true;
    h.fetchNextPage.mockClear();
    h.refetch.mockClear();
    const initiating = { ...bill, reference_number: 'SUP-START', vi_number: 'VI-START' };
    const other = { ...bill, invoice_id: 'invoice-other', reference_number: 'SUP-OTHER', vi_number: 'VI-OTHER', withheld_amount: '30000.00', withheld_pph_type: null };
    const pageTwo = { ...bill, invoice_id: 'invoice-page-two', reference_number: 'SUP-PAGE-2', vi_number: 'VI-PAGE-2', withheld_amount: '10000.00' };
    h.data = { pages: [{ rows: [initiating, other] }] };
    h.contexts = {};
    const view = render(<VendorWithholdingSlipModal invoice={invoice} vendorId="vendor-a" open onClose={vi.fn()} onSave={h.save} />);
    fireEvent.click(await screen.findByRole('checkbox', { name: /SUP-START/ }));
    fireEvent.click(screen.getByRole('checkbox', { name: /SUP-OTHER/ }));
    fireEvent.click(screen.getByRole('checkbox', { name: /Confirm as PPh 23/ }));
    fireEvent.change(screen.getByLabelText(/issued slip number/i), { target: { value: 'TAX-ISSUED-92' } });
    fireEvent.change(screen.getByLabelText(/tax base/i), { target: { value: '50000.00' } });
    fireEvent.change(screen.getByLabelText(/issued withheld amount/i), { target: { value: '40000.00' } });

    fireEvent.click(screen.getByRole('button', { name: 'Load more bills' }));
    expect(h.fetchNextPage).toHaveBeenCalledOnce();
    h.data = { pages: [{ rows: [initiating, other] }, { rows: [pageTwo] }] };
    h.contexts = { 'invoice-other': { state: 'ready', caseTitle: 'Case resolved', projectName: 'Project resolved', pmoProjectNumber: 'PMO-42' } };
    h.hasNextPage = false;
    view.rerender(<VendorWithholdingSlipModal invoice={invoice} vendorId="vendor-a" open onClose={vi.fn()} onSave={h.save} />);
    expect(screen.getByRole('checkbox', { name: /SUP-START/ })).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByRole('checkbox', { name: /SUP-OTHER/ })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('checkbox', { name: /SUP-PAGE-2/ })).toHaveAttribute('aria-checked', 'false');
    fireEvent.click(screen.getByRole('checkbox', { name: /SUP-PAGE-2/ }));
    expect(screen.getByText('Selected bills (2)')).toBeInTheDocument();
    expect(screen.getByText(/Selection IDR\s?40,000\.00/)).toBeInTheDocument();

    h.isError = true;
    view.rerender(<VendorWithholdingSlipModal invoice={invoice} vendorId="vendor-a" open onClose={vi.fn()} onSave={h.save} />);
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(h.refetch).toHaveBeenCalledOnce();
    expect(screen.getByLabelText(/issued slip number/i)).toHaveValue('TAX-ISSUED-92');
    expect(screen.getByText('Selected bills (2)')).toBeInTheDocument();
    h.isError = false;
    view.rerender(<VendorWithholdingSlipModal invoice={invoice} vendorId="vendor-a" open onClose={vi.fn()} onSave={h.save} />);
    expect(screen.getByLabelText(/tax base/i)).toHaveValue('50000.00');
    expect(screen.getByLabelText(/issued withheld amount/i)).toHaveValue('40000.00');
    expect(screen.getByRole('checkbox', { name: /Confirm as PPh 23/ })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('checkbox', { name: /SUP-OTHER/ })).toHaveAttribute('aria-checked', 'true');

    fireEvent.click(screen.getByRole('button', { name: /record bukti potong/i }));
    await waitFor(() => expect(h.save).toHaveBeenCalledWith(expect.objectContaining({
      slipNumber: 'TAX-ISSUED-92', invoiceIds: ['invoice-other', 'invoice-page-two'], declaredInvoiceIds: ['invoice-other'], withheldAmount: '40000.00',
    })));
  });

  it('AC-BUPOT-017 preserves a user deselection and removes incompatible bills when PPh type changes', async () => {
    h.data = { pages: [{ rows: [{ ...bill, reference_number: 'SUP-A' }, { ...bill, invoice_id: 'invoice-b', reference_number: 'SUP-B', vi_number: 'VI-B', withheld_amount: '30000.00', withheld_pph_type: null }, { ...bill, invoice_id: 'invoice-c', reference_number: 'SUP-C', vi_number: 'VI-C', withheld_amount: '40000.00' }] }] };
    render(<VendorWithholdingSlipModal invoice={invoice} vendorId="vendor-a" open onClose={vi.fn()} onSave={h.save} />);
    const starting = await screen.findByRole('checkbox', { name: /select bill.*SUP-A/i });
    fireEvent.click(starting);
    expect(starting).toHaveAttribute('aria-checked', 'false');
    fireEvent.click(screen.getByRole('checkbox', { name: /select bill.*SUP-C/i }));
    fireEvent.click(screen.getByRole('checkbox', { name: /select bill.*SUP-B/i }));
    fireEvent.click(screen.getByRole('checkbox', { name: /confirm as PPh 23 from issued slip/i }));
    expect(screen.getByRole('checkbox', { name: /confirm as PPh 23 from issued slip/i })).toHaveAttribute('aria-checked', 'true');
    fireEvent.change(screen.getByLabelText('PPh type'), { target: { value: 'pph4_2' } });
    expect(screen.getByRole('checkbox', { name: /select bill.*SUP-C/i })).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByRole('checkbox', { name: /confirm as PPh 4\(2\) from issued slip/i })).toHaveAttribute('aria-checked', 'false');
    expect(screen.queryByText(/Selected total: IDR 40000/)).not.toBeInTheDocument();
  });

  it('AC-BUPOT-017 initializes the starting bill before its candidate page arrives and keeps deselection across paging', async () => {
    const startingInvoice = { ...invoice, vi_number: 'VI-START', procurement_id: 'case-a', invoice_date: '2026-10-01' } as ProcurementInvoiceRow;
    h.data = { pages: [] };
    const view = render(<VendorWithholdingSlipModal invoice={startingInvoice} vendorId="vendor-a" open onClose={vi.fn()} onSave={h.save} />);
    const firstPageBill = { ...bill, invoice_id: 'invoice-other', vi_number: 'VI-OTHER', procurement_id: 'case-b', withheld_amount: '30000.00' };
    h.data = { pages: [{ rows: [firstPageBill] }] };
    view.rerender(<VendorWithholdingSlipModal invoice={startingInvoice} vendorId="vendor-a" open onClose={vi.fn()} onSave={h.save} />);
    expect(screen.getByRole('checkbox', { name: /select bill.*VI-OTHER/i })).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByText(/Selected bills \(1\)/)).toBeInTheDocument();
    h.data = { pages: [{ rows: [firstPageBill] }, { rows: [{ ...bill, vi_number: 'VI-START', procurement_id: 'case-a' }] }] };
    view.rerender(<VendorWithholdingSlipModal invoice={startingInvoice} vendorId="vendor-a" open onClose={vi.fn()} onSave={h.save} />);
    const startingCheckbox = screen.getByRole('checkbox', { name: /select bill.*VI-START/i });
    expect(startingCheckbox).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(startingCheckbox);
    view.rerender(<VendorWithholdingSlipModal invoice={startingInvoice} vendorId="vendor-a" open onClose={vi.fn()} onSave={h.save} />);
    expect(screen.getByRole('checkbox', { name: /select bill.*VI-START/i })).toHaveAttribute('aria-checked', 'false');
    fireEvent.click(screen.getByRole('checkbox', { name: /select bill.*VI-OTHER/i }));
    fireEvent.change(screen.getByLabelText(/issued slip number/i), { target: { value: 'DJ-PAGED-1' } });
    fireEvent.change(screen.getByLabelText(/tax base/i), { target: { value: '50000' } });
    fireEvent.change(screen.getByLabelText(/issued withheld amount/i), { target: { value: '30000' } });
    fireEvent.click(screen.getByRole('button', { name: /record bukti potong/i }));
    await waitFor(() => expect(h.save).toHaveBeenCalledWith(expect.objectContaining({ invoiceIds: ['invoice-other'] })));
    expect(screen.getByText(/Selected bills \(1\)/)).toBeInTheDocument();
  });

  it('AC-BUPOT-017 parses id-ID grouping at the form boundary and submits canonical exact decimals', async () => {
    setActiveLocale({ locale: 'id', numberLocale: 'id-ID', timezone: 'Asia/Jakarta' });
    h.data = { pages: [{ rows: [bill] }] };
    render(<VendorWithholdingSlipModal invoice={invoice} vendorId="vendor-a" open onClose={vi.fn()} onSave={h.save} />);
    fireEvent.change(await screen.findByLabelText(/issued slip number/i), { target: { value: 'DJ-ID-1' } });
    fireEvent.change(screen.getByLabelText(/tax base/i), { target: { value: '100.000,00' } });
    fireEvent.change(screen.getByLabelText(/issued withheld amount/i), { target: { value: '20.000,00' } });
    fireEvent.click(screen.getByRole('button', { name: /record bukti potong/i }));
    await waitFor(() => expect(h.save).toHaveBeenCalledWith(expect.objectContaining({ taxBase: '100000.00', withheldAmount: '20000.00' })));
  });

  it('AC-BUPOT-017 records a slip covering an unknown-type bill once Finance confirms its type', async () => {
    h.save.mockReset().mockResolvedValue(undefined);
    h.data = { pages: [{ rows: [bill, { ...bill, invoice_id: 'invoice-unknown', vi_number: 'VI-UNKNOWN', reference_number: 'SUP-UNKNOWN', withheld_amount: '30000.00', withheld_pph_type: null }] }] };
    render(<VendorWithholdingSlipModal invoice={invoice} vendorId="vendor-a" open onClose={vi.fn()} onSave={h.save} />);
    fireEvent.click(await screen.findByRole('checkbox', { name: /select bill.*SUP-UNKNOWN/i }));
    fireEvent.change(screen.getByLabelText(/issued slip number/i), { target: { value: 'DJ-UNKNOWN-1' } });
    fireEvent.change(screen.getByLabelText(/tax base/i), { target: { value: '100000' } });
    fireEvent.change(screen.getByLabelText(/issued withheld amount/i), { target: { value: '50000' } });
    const record = screen.getByRole('button', { name: /record bukti potong/i });
    expect(record).toBeDisabled(); // an unknown type must be confirmed before it can be recorded
    fireEvent.click(screen.getByRole('checkbox', { name: /confirm as PPh 23 from issued slip/i }));
    expect(record).toBeEnabled();
    fireEvent.click(record);
    await waitFor(() => expect(h.save).toHaveBeenCalledWith(expect.objectContaining({
      invoiceIds: ['invoice-a', 'invoice-unknown'], declaredInvoiceIds: ['invoice-unknown'], withheldAmount: '50000.00' })));
  });

  it('retains the stable capture intent across a refused attempt', async () => {
    h.data = { pages: [{ rows: [bill] }] };
    h.save.mockRejectedValueOnce({ code: '23514', details: 'bupot-amount-mismatch' });
    render(<VendorWithholdingSlipModal invoice={invoice} vendorId="vendor-a" open onClose={vi.fn()} onSave={h.save} />);
    fireEvent.change(await screen.findByLabelText(/issued slip number/i), { target: { value: 'DJ-TEST-2' } });
    fireEvent.change(screen.getByLabelText(/tax base/i), { target: { value: '20000.00' } });
    fireEvent.change(screen.getByLabelText(/issued withheld amount/i), { target: { value: '20000.00' } });
    fireEvent.click(screen.getByRole('button', { name: /record bukti potong/i }));
    await waitFor(() => expect(h.save).toHaveBeenCalledOnce());
    expect(await screen.findByText(/issued amount does not match/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/issued slip number/i)).toHaveValue('DJ-TEST-2');
  });
});
