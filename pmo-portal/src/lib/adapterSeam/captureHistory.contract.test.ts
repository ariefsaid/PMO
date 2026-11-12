import { expect, it } from 'vitest';
import { collectPages } from './captureHistory';
import { createCaptureAdapter } from './odoo/captureHistory';
import { createCaptureAdapter as createErpnextAdapter } from './erpnext/captureHistory';

it('AC-ROP-021 Odoo names missing capabilities and cannot return an empty success', async () => {
  const result = await collectPages(createCaptureAdapter().listSources, { limit: 2 });
  expect(result.complete).toBe(false);
  expect(result.missing).toContain('purchase_source_feed');
  expect(result.missing).toContain('ledger_feed');
});
it('AC-ROP-021 ERPNext preserves page and generation evidence supplied by its reader', async () => {
  const adapter = createErpnextAdapter(async cursor => ({ supported: true as const, generation: 'g', nextCursor: cursor ? null : 'next', items: [] }), undefined, { sourceId: 'b', generation: 'g', linesAvailable: true, familiesAvailable: true, currencyAvailable: true });
  expect(await collectPages(adapter.listSources, { limit: 2 })).toMatchObject({ complete: true, generation: 'g', items: [] });
});
it('AC-ROP-021 read failure is incomplete rather than a zero census', async () => {
  expect(await collectPages(async () => { throw new Error('failed'); }, { limit: 1 })).toMatchObject({ complete: false, missing: ['read_failed'] });
});
it('AC-ROP-021 ERPNext cannot claim an empty complete feed without trusted capability evidence', async () => {
  const adapter = createErpnextAdapter(async () => ({ supported: true as const, generation: 'g', nextCursor: null, items: [] }));
  const result = await collectPages(adapter.listSources, { limit: 1 });
  expect(result.complete).toBe(false);
  expect(result.missing).toContain('source_capability_evidence');
});
it('AC-ROP-021 unsupported ERPNext capability names each absent evidence class', async () => {
  const adapter = createErpnextAdapter(async () => ({ supported: true as const, generation: 'g', nextCursor: null, items: [] }));
  const result = await collectPages(adapter.listSources, { limit: 1 });
  expect(result.missing).toEqual(expect.arrayContaining(['source_binding', 'source_generation', 'line_evidence', 'family_evidence', 'currency_evidence']));
});
