import { afterEach, expect, it, vi } from 'vitest';
import { createPriceVisibilityFetch } from './priceVisibilityFetch';
import { setHidePricesActive } from './priceReadPath';

afterEach(() => setHidePricesActive(false));

it('AC-HPG-P2 waits for visibility and sends only the resolved masked read', async () => {
  setHidePricesActive(null);
  const base = vi.fn().mockResolvedValue(new Response('{}'));
  const request = createPriceVisibilityFetch(base)('https://example.test/rest/v1/procurements?select=payments(amount)');
  await Promise.resolve();
  expect(base).not.toHaveBeenCalled();
  setHidePricesActive(true);
  await request;
  expect(String(base.mock.calls[0][0])).toContain('/procurements_masked?');
  expect(decodeURIComponent(String(base.mock.calls[0][0]))).toContain('payments:payments_masked(amount)');
});

it('AC-HPG-P2 releases an ordinary read only after confirmed off, without blocking unrelated reads', async () => {
  setHidePricesActive(null);
  const base = vi.fn().mockResolvedValue(new Response('{}'));
  const wrapped = createPriceVisibilityFetch(base);
  await wrapped('https://example.test/rest/v1/projects?select=id');
  expect(base).toHaveBeenCalledTimes(1);
  const request = wrapped('https://example.test/rest/v1/payments_masked?select=amount');
  expect(base).toHaveBeenCalledTimes(1);
  setHidePricesActive(false);
  await request;
  expect(String(base.mock.calls[1][0])).toContain('/payments?');
});

it.each(['procurements', 'procurement_items', 'procurement_invoices', 'purchase_orders', 'purchase_requests', 'payments', 'purchase_order_lines', 'po_variation_lines', 'stock_document_lines', 'stock_ledger', 'stock_balances', 'equipment_plan_lines'])(
  'AC-HPG-P2 masks the %s read even when its URL was constructed while off', async (table) => {
    setHidePricesActive(true);
    const base = vi.fn().mockResolvedValue(new Response('{}'));
    await createPriceVisibilityFetch(base)(`https://example.test/rest/v1/${table}?select=*`);
    expect(String(base.mock.calls[0][0])).toContain(`/${table}_masked?`);
  },
);

it.each(['project_committed_spend', 'procurement_open_commitments'])(
  'AC-HPG-P2 masks derived read %s while preserving its POST body', async (name) => {
    setHidePricesActive(null);
    const base = vi.fn().mockResolvedValue(new Response('{}'));
    const init = { method: 'POST', body: '{"p_ids":["p"]}' };
    const pending = createPriceVisibilityFetch(base)(`https://example.test/rest/v1/rpc/${name}`, init);
    expect(base).not.toHaveBeenCalled();
    setHidePricesActive(true);
    await pending;
    expect(String(base.mock.calls[0][0])).toContain(`/${name}_masked`);
    expect(base.mock.calls[0][1]).toBe(init);
  },
);

it('AC-HPG-P2 sends a price-free embed read exactly as constructed while it waits for the answer', async () => {
  setHidePricesActive(null);
  const base = vi.fn().mockResolvedValue(new Response('{}'));
  const pending = createPriceVisibilityFetch(base)('https://example.test/rest/v1/stock_documents?select=stock_document_lines(id,qty_rejected,item:stock_items(code))');
  await Promise.resolve();
  expect(base).not.toHaveBeenCalled();
  setHidePricesActive(true);
  await pending;
  const sent = String(base.mock.calls[0][0]);
  expect(sent).toContain('/stock_documents?');
  expect(decodeURIComponent(sent)).toContain('stock_document_lines(id,qty_rejected,item:stock_items(code))');
  expect(sent).not.toContain('_masked');
});

it('AC-HPG-P2 cancels a pending read without dispatching it', async () => {
  setHidePricesActive(null);
  const controller = new AbortController();
  const base = vi.fn();
  const pending = createPriceVisibilityFetch(base)('https://example.test/rest/v1/payments', { signal: controller.signal });
  controller.abort();
  await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  setHidePricesActive(true);
  expect(base).not.toHaveBeenCalled();
});

it('leaves writes and unrelated RPCs unchanged while unresolved', async () => {
  setHidePricesActive(null);
  const base = vi.fn().mockResolvedValue(new Response('{}'));
  const wrapped = createPriceVisibilityFetch(base);
  await wrapped('https://example.test/rest/v1/payments', { method: 'PATCH', body: '{}' });
  await wrapped('https://example.test/rest/v1/rpc/save_equipment_plan', { method: 'POST' });
  expect(base).toHaveBeenCalledTimes(2);
});
