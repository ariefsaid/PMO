import { calculateProjectInvoiceSummary } from './projectInvoicing';

describe('project invoicing summary', () => {
  it('AC-UNB-001: reports submitted invoice totals and remaining contract value on the contract basis', () => {
    expect(calculateProjectInvoiceSummary({
      contractAmount: 10_000,
      contractCurrency: 'IDR',
      contractTreatment: 'exclusive',
      invoices: [
        { amount: 2_200, currency: 'IDR', tax_treatment: 'inclusive', tax_amount: 200, status: 'Submitted' },
        { amount: 900, currency: 'IDR', tax_treatment: 'exclusive', tax_amount: 0, status: 'Unpaid' },
        { amount: 7_000, currency: 'IDR', tax_treatment: 'exclusive', tax_amount: 0, status: 'Draft' },
        { amount: 8_000, currency: 'IDR', tax_treatment: 'exclusive', tax_amount: 0, status: 'Cancelled' },
      ],
    })).toEqual({
      invoicedToDate: 2_900,
      remainingToInvoice: 7_100,
      currency: 'IDR',
      taxTreatment: 'exclusive',
    });
  });

  it('AC-UNB-003: converts exclusive invoices to an inclusive contract ceiling', () => {
    expect(calculateProjectInvoiceSummary({
      contractAmount: 1_100,
      contractCurrency: 'IDR',
      contractTreatment: 'inclusive',
      invoices: [
        { amount: 1_000, currency: 'IDR', tax_treatment: 'exclusive', tax_amount: 100, status: 'Paid' },
      ],
    })).toEqual({
      invoicedToDate: 1_100,
      remainingToInvoice: 0,
      currency: 'IDR',
      taxTreatment: 'inclusive',
    });
  });

  it('AC-UNB-003: returns unavailable when invoice currency or tax facts cannot be compared', () => {
    const project = {
      contractAmount: 10_000,
      contractCurrency: 'IDR',
      contractTreatment: 'exclusive',
      invoices: [{ amount: 1_000, currency: 'USD', tax_treatment: 'exclusive', tax_amount: 0, status: 'Paid' }],
    };
    expect(calculateProjectInvoiceSummary(project)).toBeNull();
  });
});
