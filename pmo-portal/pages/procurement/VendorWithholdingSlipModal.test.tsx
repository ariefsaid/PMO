import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { resetActiveLocale, setActiveLocale } from '@/src/lib/locale/activeLocale';
const h = vi.hoisted(() => ({ data: { pages: [] as unknown[] }, save: vi.fn() }));
vi.mock('@/src/hooks/useVendorWithholdingSlips', () => ({ useVendorWithholdingCandidates: () => ({ data: h.data, isLoading: false, isError: false, hasNextPage: false, refetch: vi.fn(), fetchNextPage: vi.fn(), isFetchingNextPage: false }) }));
import { VendorWithholdingSlipModal } from './VendorWithholdingSlipModal';
import type { ProcurementInvoiceRow } from '@/src/lib/db/procurementLifecycle';
const invoice = { id: 'invoice-a', currency: 'IDR', withheld_amount: 20000, withheld_pph_type: 'pph23' } as ProcurementInvoiceRow;
const bill = { invoice_id: 'invoice-a', vendor_id: 'vendor-a', currency: 'IDR', withheld_amount: '20000.00', withheld_pph_type: 'pph23', invoice_date: '2026-10-01' };
afterEach(() => resetActiveLocale());

describe('AC-BUPOT-017 capture form', () => {
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
  it('AC-BUPOT-017 preserves a user deselection and removes incompatible bills when PPh type changes', async () => {
    h.data = { pages: [{ rows: [bill, { ...bill, invoice_id: 'invoice-b', withheld_amount: '30000.00', withheld_pph_type: null }, { ...bill, invoice_id: 'invoice-c', withheld_amount: '40000.00' }] }] };
    render(<VendorWithholdingSlipModal invoice={invoice} vendorId="vendor-a" open onClose={vi.fn()} onSave={h.save} />);
    const starting = await screen.findByRole('checkbox', { name: /select bill invoice-a/i });
    fireEvent.click(starting);
    expect(starting).toHaveAttribute('aria-checked', 'false');
    fireEvent.click(screen.getByRole('checkbox', { name: /select bill invoice-c/i }));
    fireEvent.click(screen.getByRole('checkbox', { name: /select bill invoice-b/i }));
    fireEvent.click(screen.getByRole('checkbox', { name: /confirm as PPh 23 from issued slip/i }));
    expect(screen.getByRole('checkbox', { name: /confirm as PPh 23 from issued slip/i })).toHaveAttribute('aria-checked', 'true');
    fireEvent.change(screen.getByLabelText('PPh type'), { target: { value: 'pph4_2' } });
    expect(screen.getByRole('checkbox', { name: /select bill invoice-c/i })).toHaveAttribute('aria-checked', 'false');
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
    expect(screen.getByRole('checkbox', { name: /select bill VI-OTHER/i })).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByText(/Selected bills \(1\)/)).toBeInTheDocument();
    h.data = { pages: [{ rows: [firstPageBill] }, { rows: [{ ...bill, vi_number: 'VI-START', procurement_id: 'case-a' }] }] };
    view.rerender(<VendorWithholdingSlipModal invoice={startingInvoice} vendorId="vendor-a" open onClose={vi.fn()} onSave={h.save} />);
    const startingCheckbox = screen.getByRole('checkbox', { name: /select bill VI-START/i });
    expect(startingCheckbox).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(startingCheckbox);
    view.rerender(<VendorWithholdingSlipModal invoice={startingInvoice} vendorId="vendor-a" open onClose={vi.fn()} onSave={h.save} />);
    expect(screen.getByRole('checkbox', { name: /select bill VI-START/i })).toHaveAttribute('aria-checked', 'false');
    fireEvent.click(screen.getByRole('checkbox', { name: /select bill VI-OTHER/i }));
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
    h.data = { pages: [{ rows: [bill, { ...bill, invoice_id: 'invoice-unknown', withheld_amount: '30000.00', withheld_pph_type: null }] }] };
    render(<VendorWithholdingSlipModal invoice={invoice} vendorId="vendor-a" open onClose={vi.fn()} onSave={h.save} />);
    fireEvent.click(await screen.findByRole('checkbox', { name: /select bill invoice-unknown/i }));
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
