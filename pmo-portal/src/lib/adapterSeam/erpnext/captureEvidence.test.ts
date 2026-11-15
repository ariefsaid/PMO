import { describe, expect, it, vi } from 'vitest';
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
it('AC-ROP-017 refuses missing and higher precision without guessing', async () => {
  await expect(readCapturePrecision(client('{"data":{}}'))).resolves.toMatchObject({ ok: false, reason: 'source_precision_unknown' });
  await expect(readCapturePrecision(client('{"data":{"currency_precision":"3","number_format":"#,###.###"}}'))).resolves.toMatchObject({ ok: false, reason: 'source_precision_exceeds_mirror' });
});

describe('#2195 a blank Currency Precision takes the number format decimals, as Frappe does', () => {
  const read = (data: Record<string, unknown>) => readCapturePrecision(client(JSON.stringify({ data })));
  it.each([
    [{ currency_precision: '', number_format: '#,###.##' }, 2],
    [{ currency_precision: null, number_format: '#,###.##' }, 2],
    [{ currency_precision: 0, number_format: '#,###.##' }, 2],
    [{ currency_precision: '0', number_format: '#.###,##' }, 2],
    [{ number_format: '#,###.##' }, 2],
    [{ currency_precision: '', number_format: '#.###' }, 0],
    [{ currency_precision: '', number_format: '#,###' }, 0],
  ])('blank precision %j books at scale %i', async (data, scale) => {
    await expect(read(data)).resolves.toEqual({ ok: true, scale });
  });
  it('an explicit positive precision wins over the number format', async () => {
    await expect(read({ currency_precision: 2, number_format: '#.###' })).resolves.toEqual({ ok: true, scale: 2 });
    await expect(read({ currency_precision: '1', number_format: '#,###.##' })).resolves.toEqual({ ok: true, scale: 1 });
  });
  it('more than 2 decimals, explicit or from the format, exceeds the mirror', async () => {
    await expect(read({ currency_precision: 3, number_format: '#,###.##' })).resolves.toEqual({ ok: false, reason: 'source_precision_exceeds_mirror' });
    await expect(read({ currency_precision: '', number_format: '#,###.###' })).resolves.toEqual({ ok: false, reason: 'source_precision_exceeds_mirror' });
  });
  it('a blank precision with an unknown or missing number format stays unknown', async () => {
    for (const data of [{ currency_precision: '', number_format: '#.########' }, { currency_precision: '', number_format: 'constructor' }, { currency_precision: '' }, { currency_precision: 0, number_format: null }]) {
      await expect(read(data)).resolves.toEqual({ ok: false, reason: 'source_precision_unknown' });
    }
  });
  it('a precision that is not a whole number stays unknown', async () => {
    for (const raw of ['2.5', -1, 'two', true]) {
      await expect(read({ currency_precision: raw, number_format: '#,###.##' })).resolves.toEqual({ ok: false, reason: 'source_precision_unknown' });
    }
  });
});

describe('#2195 unreadable System Settings is named, never a guessed scale', () => {
  it.each([401, 403, 404])('HTTP %i is source_settings_unreadable', async (status) => {
    await expect(readCapturePrecision(client('{"exc_type":"PermissionError"}', status))).resolves.toEqual({ ok: false, reason: 'source_settings_unreadable' });
  });
  it('a network failure is source_settings_unreadable', async () => {
    const c = client('{}');
    c.fetchImpl.mockRejectedValue(new TypeError('network down'));
    await expect(readCapturePrecision(c)).resolves.toEqual({ ok: false, reason: 'source_settings_unreadable' });
  });
  it.each(['not json', '[]', '"text"', 'null'])('an invalid body %s is source_settings_unreadable', async (body) => {
    await expect(readCapturePrecision(client(body))).resolves.toEqual({ ok: false, reason: 'source_settings_unreadable' });
  });
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
