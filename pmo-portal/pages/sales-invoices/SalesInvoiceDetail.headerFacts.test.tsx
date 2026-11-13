import React from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import type { SalesInvoiceRow } from '@/src/lib/db/revenue';
import { FinanceI18nTestProvider } from '@/test/financeI18nTestProvider';

vi.mock('./SalesInvoiceEvidence', () => ({ SalesInvoiceEvidenceSection: () => null }));
vi.mock('@/src/hooks/useRevenue', () => ({
  useSalesInvoiceEvidence: () => ({ data: { lines: [] }, isPending: false, isError: false, refetch: vi.fn() }),
}));
vi.mock('@/src/hooks/useFkOptions', () => ({
  useInvoiceProjectOptions: () => ({ data: [{ value: 'project-1', label: 'Northwind Build', contractualName: 'Northwind Build' }] }),
}));
vi.mock('@/src/hooks/useTasks', () => ({ useAssignableProfiles: () => ({ data: [] }) }));
vi.mock('@/src/components/fx/FxEquivalent', () => ({ default: () => null }));

import { SalesInvoiceDetail } from './SalesInvoiceDetail';

const target: SalesInvoiceRow = {
  id: 'invoice-1', org_id: 'org-1', project_id: 'project-1', erp_project: null,
  billing_kind: 'contract', customer_id: 'customer-1', customer_name: 'Acme Co',
  si_number: 'SI-2026-0001', pmo_number: 'PMO-2026-0001', pmo_native: false,
  reference_number: 'PO-77', invoice_date: '2026-10-01', amount: 1_110_000,
  currency: 'IDR', tax_treatment: 'inclusive', tax_amount: 110_000,
  erp_outstanding_amount: 1_110_000, status: 'Unpaid', erp_docstatus: 1,
  erp_modified: null, erp_amended_from: null, erp_cancelled_at: null,
  created_at: '2026-10-01T00:00:00Z', author_user_id: 'author-1', author_user_ids: ['author-1'],
  erp_payment_terms_days: 30, erp_due_date: null, received_date: null,
  efaktur_number: null, efaktur_date: null, native_lines: null,
};

afterEach(cleanup);

it('links the project in header facts and keeps Project and Invoice date facts once', () => {
  render(
    <FinanceI18nTestProvider>
      <MemoryRouter>
        <SalesInvoiceDetail
          viewTarget={target}
          projectName="Northwind Build"
          isPending={false}
          isError={false}
          data={[target]}
          mode="erp"
          organizationToday="2026-10-16"
          onBack={vi.fn()}
          refetch={vi.fn()}
          recordPrimaryAction={null}
          invoiceDisplayLabel={() => 'SI-2026-0001'}
          may={(() => false) as never}
          pdfDownload={{ download: vi.fn(), inFlightIds: new Set<string>() } as never}
          dialogs={null}
        />
      </MemoryRouter>
    </FinanceI18nTestProvider>,
  );

  const main = screen.getByRole('main');
  const header = screen.getByTestId('record-header');
  const projectLink = within(header).getByRole('link', { name: 'Open Northwind Build' });
  expect(projectLink).toHaveAttribute('href', '/projects/project-1');
  expect(within(main).getAllByText('Project')).toHaveLength(1);
  expect(within(main).getAllByText('Invoice date')).toHaveLength(1);
  expect(screen.getByText('Customer PO')).toBeInTheDocument();
});
