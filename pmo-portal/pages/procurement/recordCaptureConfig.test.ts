import { describe, it, expect } from 'vitest';
import { kindConfig, STATUS_OPTIONS, GROUP_REF_KINDS, localizedRecordKindLabel, statusOptionLabel } from './recordCaptureConfig';
import { VI_FIELD_TEST_IDS } from './vendorInvoiceTestIds';

const t = ((_k: string, fb: string) => fb) as never;

describe('recordCaptureConfig', () => {
  it('GR keeps its bespoke ids, no amount, default Complete', () => {
    const c = kindConfig('goods_receipt');
    expect(c).toMatchObject({ formTestId: 'form-create-gr', showAmount: false, defaultStatus: 'Complete', saveTestId: 'btn-save-gr' });
  });
  it('VI single-sources its field ids and never offers Paid', () => {
    const c = kindConfig('vendor_invoice');
    expect(c.refTestId).toBe(VI_FIELD_TEST_IDS.ref);
    expect(STATUS_OPTIONS.vendor_invoice).not.toContain('Paid');
  });
  it('generic kinds derive ids from the kind; only payment links an invoice', () => {
    expect(kindConfig('purchase_order')).toMatchObject({ formTestId: 'form-capture-purchase_order', defaultStatus: 'Draft', showInvoiceFk: false });
    expect(kindConfig('payment')).toMatchObject({ showInvoiceFk: true, defaultStatus: 'Pending', saveLabel: 'Save Payment' });
  });
  it('group-ref kinds and labels', () => {
    expect([...GROUP_REF_KINDS].sort()).toEqual(['purchase_order', 'purchase_request', 'vendor_invoice']);
    expect(localizedRecordKindLabel('vendor_invoice', t)).toBe('Supplier Invoice');
    expect(statusOptionLabel('Scheduled', t)).toBe('Scheduled');
    expect(statusOptionLabel('Unknown', t)).toBe('Unknown');
  });
});
