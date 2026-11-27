import { afterEach, expect, it, vi } from 'vitest';
import { createPriceVisibilityFetch } from './priceVisibilityFetch';
import { MASKABLE_TABLES, priceFn, priceSource, setHidePricesActive } from './priceReadPath';

afterEach(() => setHidePricesActive(false));

it('AC-HPG-P2 waits for visibility and sends only the resolved masked read', async () => {
  setHidePricesActive(null);
  const base = vi.fn().mockResolvedValue(new Response('{}'));
  const request = createPriceVisibilityFetch(base)(`https://example.test/rest/v1/${priceSource('procurements')}?select=payments(amount)`);
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

it.each(MASKABLE_TABLES)(
  'AC-HPG-P2 holds the opted-in %s read built while unresolved and sends it masked once on', async (table) => {
    setHidePricesActive(null);
    const base = vi.fn().mockResolvedValue(new Response('{}'));
    const pending = createPriceVisibilityFetch(base)(`https://example.test/rest/v1/${priceSource(table)}?select=*`);
    await Promise.resolve();
    expect(base).not.toHaveBeenCalled();
    setHidePricesActive(true);
    await pending;
    expect(String(base.mock.calls[0][0])).toContain(`/${table}_masked?`);
  },
);

it('AC-HPG-P2 sends a plain read of a maskable table unchanged while prices are hidden (Return issue lines)', async () => {
  setHidePricesActive(true);
  const base = vi.fn().mockResolvedValue(new Response('[]'));
  const select = 'id, item_id, quantity, boq_item_id, item:stock_items(code,name,unit:stock_units(code)), boq:boq_items(item_code,description), document:stock_documents!inner(id,number,occurred_on,warehouse_id,work_order_id,kind,status,project_id)';
  const url = `https://example.test/rest/v1/stock_document_lines?select=${encodeURIComponent(select)}&document.kind=eq.issue`;
  await createPriceVisibilityFetch(base)(url);
  const sent = new URL(String(base.mock.calls[0][0]));
  expect(sent.pathname).toBe('/rest/v1/stock_document_lines');
  expect(sent.searchParams.get('select')).toBe(select);
  expect(sent.searchParams.get('select')).not.toMatch(/unit_cost|_masked/);
});

it('AC-HPG-P2 sends an opted-in masked read to the table once the setting resolves off', async () => {
  setHidePricesActive(false);
  const base = vi.fn().mockResolvedValue(new Response('{}'));
  await createPriceVisibilityFetch(base)('https://example.test/rest/v1/procurements_masked?select=id');
  expect(new URL(String(base.mock.calls[0][0])).pathname).toBe('/rest/v1/procurements');
});

it.each(['project_committed_spend', 'procurement_open_commitments'] as const)(
  'AC-HPG-P2 masks derived read %s while preserving its POST body', async (name) => {
    setHidePricesActive(null);
    const base = vi.fn().mockResolvedValue(new Response('{}'));
    const init = { method: 'POST', body: '{"p_ids":["p"]}' };
    const pending = createPriceVisibilityFetch(base)(`https://example.test/rest/v1/rpc/${priceFn(name)}`, init);
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
