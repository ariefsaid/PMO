import { expect, it } from 'vitest';
import { salesInvoiceCreateFields } from './salesInvoiceCommand';

it('FR-AIN-025 builds the create record the dispatch expects, adding only erp_doc_kind', () => {
  const items = [{ item_code: 'SVC', qty: 1, rate: 100 }];
  expect(salesInvoiceCreateFields({ customerId: 'c', projectId: 'p', items }))
    .toEqual({ customerId: 'c', projectId: 'p', items, erp_doc_kind: 'sales-invoice' });
  expect(salesInvoiceCreateFields({ customerId: 'c', items, reference_number: 'PO-1' }))
    .toEqual({ customerId: 'c', items, reference_number: 'PO-1', erp_doc_kind: 'sales-invoice' });
});

it('AC-BWO-003 carries the work order an invoice bills', () => {
  const items = [{ item_code: 'SVC', qty: 1, rate: 100 }];
  expect(salesInvoiceCreateFields({ customerId: 'c', projectId: 'p', items, workOrderId: 'wo-1' }))
    .toEqual({ customerId: 'c', projectId: 'p', items, workOrderId: 'wo-1', erp_doc_kind: 'sales-invoice' });
});
