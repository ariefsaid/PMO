import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import type { SalesInvoiceRow } from '@/src/lib/db/revenue';

vi.mock('./SalesInvoiceEvidence', () => ({ SalesInvoiceEvidenceSection: () => null }));
vi.mock('@/pages/approvals/SalesInvoiceApprovalRow', () => ({ SalesInvoiceApprovalPreview: () => null }));
vi.mock('@/src/components/fx/FxEquivalent', () => ({ default: () => null }));

import { SalesInvoiceDetail } from './SalesInvoiceDetail';

const invoice = (over: Partial<SalesInvoiceRow> = {}): SalesInvoiceRow => ({
  id: 'n1', org_id: 'org-1', project_id: null, erp_project: null, billing_kind: 'contract', customer_id: 'c1', customer_name: 'Acme Co',
  si_number: null, pmo_number: 'PMO-1', pmo_native: true, reference_number: 'PO-7', invoice_date: '2026-03-10', amount: 100, currency: 'IDR',
  tax_treatment: 'exclusive', tax_amount: 0, erp_outstanding_amount: 100, status: 'Unpaid', erp_docstatus: null, erp_modified: null,
  erp_amended_from: null, erp_cancelled_at: null, created_at: '2026-03-10T00:00:00Z', author_user_id: 'u1', author_user_ids: ['u1'],
  erp_payment_terms_days: 14, erp_due_date: null, received_date: null, efaktur_number: null, efaktur_date: null, ...over,
});

function mount(viewTarget: SalesInvoiceRow) {
  render(
    <MemoryRouter>
      <SalesInvoiceDetail
        viewTarget={viewTarget} isPending={false} isError={false} data={[viewTarget]} mode={'native' as never} organizationToday='2026-03-20'
        onBack={vi.fn()} refetch={vi.fn()} recordPrimaryAction={null} invoiceDisplayLabel={() => 'PMO-1'}
        may={(() => false) as never} pdfDownload={{ download: vi.fn(), inFlightIds: new Set<string>() } as never} dialogs={null}
      />
    </MemoryRouter>,
  );
}
afterEach(cleanup);

it('M10 a paired PMO invoice says it is counted once with its ERP invoice', () => {
  mount(invoice({ paired_erp_invoice_id: 'e1', paired_erp_number: 'SI-9' }));
  expect(screen.getByText('Counted once with the ERP invoice SI-9.')).toBeInTheDocument();
});

it('M10 an invoice that is not paired carries no such note', () => {
  mount(invoice({ paired_erp_invoice_id: null }));
  expect(screen.queryByText(/Counted once/)).not.toBeInTheDocument();
});
