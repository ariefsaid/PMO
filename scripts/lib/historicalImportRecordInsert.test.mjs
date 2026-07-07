import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildRecordInsert, RECORD_TABLE_BY_TYPE } from './historicalImportRecordInsert.mjs';

const prov = { importBatchId: 'batch-1', importedAt: '2025-01-01T00:00:00.000Z', importKey: 'K1' };

test('B1: PR/RFQ/PO map to {reference_number,status,date,amount} (schema-correct)', () => {
  const row = { type: 'PO', externalRef: 'PO-1', status: 'Ordered', date: '2025-02-01', amount: '900' };
  const { table, payload } = buildRecordInsert(row, 'proc-1', {}, prov);
  assert.equal(table, 'purchase_orders');
  assert.equal(payload.procurement_id, 'proc-1');
  assert.equal(payload.reference_number, 'PO-1');
  assert.equal(payload.status, 'Ordered');
  assert.equal(payload.date, '2025-02-01');
  assert.equal(payload.amount, 900);
  assert.equal(payload.import_batch_id, 'batch-1');
  assert.equal(payload.imported_at, prov.importedAt);
  assert.equal(payload.import_key, 'K1');
});

test('B1: GR maps date -> receipt_date, NO date/amount columns, status is required', () => {
  const row = { type: 'GR', externalRef: 'GR-1', status: 'Received', date: '2025-03-01', amount: '900' };
  const { table, payload } = buildRecordInsert(row, 'proc-1', {}, prov);
  assert.equal(table, 'procurement_receipts');
  assert.equal(payload.receipt_date, '2025-03-01');
  assert.equal(payload.status, 'Received');
  assert.equal(payload.reference_number, 'GR-1');
  assert.equal('date' in payload, false, 'receipts have no `date` column');
  assert.equal('amount' in payload, false, 'receipts have no `amount` column');
});

test('B1: VI maps date -> invoice_date and keeps amount + reference_number', () => {
  const row = { type: 'VI', externalRef: 'INV-1', status: 'Paid', date: '2025-04-01', amount: '900' };
  const { table, payload } = buildRecordInsert(row, 'proc-1', {}, prov);
  assert.equal(table, 'procurement_invoices');
  assert.equal(payload.invoice_date, '2025-04-01');
  assert.equal(payload.status, 'Paid');
  assert.equal(payload.amount, 900);
  assert.equal(payload.reference_number, 'INV-1');
  assert.equal('date' in payload, false, 'invoices have no `date` column');
});

test('B1: Quotation maps to {vendor_id,total_amount,received_date}, NO status/date/amount', () => {
  const row = { type: 'Quotation', vendor: 'Acme', amount: '1500', date: '2025-01-05' };
  const { table, payload } = buildRecordInsert(row, 'proc-1', { 'acme': 'vendor-uuid' }, prov);
  assert.equal(table, 'procurement_quotations');
  assert.equal(payload.vendor_id, 'vendor-uuid');
  assert.equal(payload.total_amount, 1500);
  assert.equal(payload.received_date, '2025-01-05');
  assert.equal('status' in payload, false, 'quotations have no `status` column');
  assert.equal('amount' in payload, false, 'quotations have no `amount` column');
});

test('B1: Payment maps to {invoice_id?,reference_number,status,date,amount}', () => {
  const row = { type: 'Payment', externalRef: 'PAY-1', status: 'Paid', date: '2025-05-01', amount: '900' };
  const { table, payload } = buildRecordInsert(row, 'proc-1', {}, { ...prov, invoiceId: 'vi-1' });
  assert.equal(table, 'payments');
  assert.equal(payload.invoice_id, 'vi-1');
  assert.equal(payload.reference_number, 'PAY-1');
  assert.equal(payload.amount, 900);
});

test('B1: empty amount/date coalesce to null, not "" (avoids numeric/date cast crash)', () => {
  const row = { type: 'PR', externalRef: 'PR-1', status: 'Approved', date: '', amount: '' };
  const { payload } = buildRecordInsert(row, 'proc-1', {}, prov);
  assert.equal(payload.amount, null);
  assert.equal(payload.date, null);
});

test('RECORD_TABLE_BY_TYPE covers all 7 record types', () => {
  assert.deepEqual(Object.keys(RECORD_TABLE_BY_TYPE).sort(),
    ['GR', 'PO', 'PR', 'Payment', 'Quotation', 'RFQ', 'VI'].sort());
});
