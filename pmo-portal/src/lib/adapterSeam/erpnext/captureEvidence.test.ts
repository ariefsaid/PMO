import { expect, it, vi } from 'vitest';
import { readCapturePrecision } from './captureEvidence';

function client(settings: string, status = 200) {
  const fetchImpl = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) =>
    new Response(settings, { status, headers: { 'content-type': 'application/json' } }));
  return { fetchImpl, apiKey: 'test', apiSecret: 'test', baseUrl: 'https://example.test', maxRetries: 0 };
}
it('AC-ROP-017 uses one settings GET as the field-precision witness', async () => {
  const c = client('{"data":{"currency_precision":"2","float_precision":"3","number_format":"#,###.##"}}');
  await expect(readCapturePrecision(c)).resolves.toEqual({ ok: true, scale: 2 });
  expect(c.fetchImpl).toHaveBeenCalledTimes(1);
  const [url, init] = c.fetchImpl.mock.calls[0];
  expect(new URL(String(url)).pathname).toBe('/api/resource/System%20Settings/System%20Settings');
  expect(init?.method).toBe('GET');
});
it('AC-ROP-017 refuses missing, denied and higher precision without guessing', async () => {
  await expect(readCapturePrecision(client('{"data":{}}'))).resolves.toMatchObject({ ok: false, reason: 'source_precision_unknown' });
  await expect(readCapturePrecision(client('{"error":"denied"}', 403))).resolves.toMatchObject({ ok: false, reason: 'source_precision_unknown' });
  await expect(readCapturePrecision(client('{"data":{"currency_precision":"3","number_format":"#,###.###"}}'))).resolves.toMatchObject({ ok: false, reason: 'source_precision_exceeds_mirror' });
});

it('AC-ROP-017 caches precision per company and document kind for a run and rereads for apply', async () => {
  const { createCapturePrecisionReader } = await import('./captureEvidence');
  const c = client('{"data":{"currency_precision":"2","float_precision":"3","number_format":"#,###.##"}}');
  const preview = createCapturePrecisionReader(c);
  const first = await Promise.all(Array.from({ length: 500 }, () => preview.read('Company', 'order')));
  expect(first.every(result => result.ok)).toBe(true);
  expect(c.fetchImpl).toHaveBeenCalledTimes(1);
  await preview.read('Company', 'supplier_invoice');
  expect(c.fetchImpl).toHaveBeenCalledTimes(2);
  const apply = createCapturePrecisionReader(c);
  await apply.read('Company', 'order');
  expect(c.fetchImpl).toHaveBeenCalledTimes(3);
});
