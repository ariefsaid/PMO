import { describe, it, expect } from 'vitest';
import { tabFromParam, procurementTabs, procurementDetailRows, procurementAttachTargets } from './procurementDetailView';

const t = ((_k: string, d: unknown) => (typeof d === 'string' ? d : (d as { defaultValue: string }).defaultValue)) as never;

describe('tabFromParam', () => {
  it('maps legacy and unknown segments to the current tabs', () => {
    expect(tabFromParam('documents')).toBe('files');
    expect(tabFromParam('overview')).toBe('timeline');
    expect(tabFromParam('history')).toBe('timeline');
    expect(tabFromParam('quotes')).toBe('quotes');
    expect(tabFromParam('nonsense')).toBe('timeline');
    expect(tabFromParam(undefined)).toBe('timeline');
  });
});

describe('procurement detail projections', () => {
  const p = { items: [{}, {}], quotations: [], status: 'Draft', purchase_orders: [{}], project: null, vendor: null, approved_by: null, requested_by: null, budget_category: null } as never;

  it('shows a count only when the tab has rows', () => {
    const tabs = procurementTabs(p, t, 0, [{ fileCount: 2 }, { fileCount: 1 }] as never);
    expect(tabs.map((x) => [x.value, x.count ?? null])).toEqual([
      ['timeline', null], ['items', 2], ['quotes', null], ['files', 3], ['details', null],
    ]);
  });

  it('reads muted placeholders while supplier and project are absent', () => {
    const rows = procurementDetailRows(p, t, 0);
    expect(rows.map((r) => r.label)).toContain('Supplier');
    expect(rows).toHaveLength(6);
  });

  it('labels attach targets by type and number, with ERP documents last', () => {
    const targets = procurementAttachTargets(
      [{ type: 'PO', recordId: 'po1', systemNumber: 'PO-1' }, { type: 'GR', recordId: 'gr1', systemNumber: null }] as never,
      [{ id: 'd1', doctype: 'Purchase Order', name: 'ACC-1' }] as never,
      t,
    );
    expect(targets.map((x) => x.value)).toEqual(['purchase_order:po1', 'goods_receipt:gr1', 'erp_document:d1']);
    expect(targets[0].label).toBe('Purchase order PO-1');
    expect(targets[1].label).toBe('Goods receipt');
  });
});
