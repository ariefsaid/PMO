import { describe, expect, it, vi } from 'vitest';
import { readCapturePrecision } from './captureEvidence';
import { ERP_DEFAULT_MAX_RETRIES, ERP_RESPONSE_MAX_BYTES } from './client';

function client(settings: string, versionMajor: number | null, status = 200) {
  const fetchImpl = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) =>
    new Response(settings, { status, headers: { 'content-type': 'application/json' } }));
  return { fetchImpl, apiKey: 'test', apiSecret: 'test', baseUrl: 'https://example.test', maxRetries: 0, versionMajor };
}
it('AC-ROP-017 uses one settings GET as the field-precision witness', async () => {
  const c = client('{"data":{"currency_precision":"2","float_precision":"3","number_format":"#,###.##"}}', 15);
  await expect(readCapturePrecision(c)).resolves.toEqual({ ok: true, scale: 2 });
  expect(c.fetchImpl).toHaveBeenCalledTimes(1);
  const [url, init] = c.fetchImpl.mock.calls[0];
  expect(new URL(String(url)).pathname).toBe('/api/resource/System%20Settings/System%20Settings');
  expect(init?.method).toBe('GET');
});
it('AC-ROP-017 refuses missing and higher precision without guessing', async () => {
  await expect(readCapturePrecision(client('{"data":{}}', 15))).resolves.toMatchObject({ ok: false, reason: 'source_precision_unknown' });
  await expect(readCapturePrecision(client('{"data":{"currency_precision":"3","number_format":"#,###.###"}}', 15))).resolves.toMatchObject({ ok: false, reason: 'source_precision_exceeds_mirror' });
});

describe('#2195 a blank Currency Precision takes the number format decimals, as Frappe does', () => {
  const read = (data: Record<string, unknown>) => readCapturePrecision(client(JSON.stringify({ data }), 15));
  it.each([
    [{ currency_precision: '', number_format: '#,###.##' }, 2],
    [{ currency_precision: null, number_format: '#,###.##' }, 2],
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
    for (const data of [{ currency_precision: '', number_format: '#.########' }, { currency_precision: '', number_format: 'constructor' }, { currency_precision: '' }]) {
      await expect(read(data)).resolves.toEqual({ ok: false, reason: 'source_precision_unknown' });
    }
  });
  it('a precision that is not a whole number stays unknown', async () => {
    for (const raw of ['2.5', -1, 'two', true]) {
      await expect(read({ currency_precision: raw, number_format: '#,###.##' })).resolves.toEqual({ ok: false, reason: 'source_precision_unknown' });
    }
  });
});

describe('#2195 #2349 unreadable System Settings is named with its cause, never a guessed scale', () => {
  const unreadable = (cause: string) => ({ ok: false, reason: 'source_settings_unreadable', cause });
  it.each([401, 403])('#2349 HTTP %i is source_settings_unreadable, cause refused', async (status) => {
    await expect(readCapturePrecision(client('{"exc_type":"PermissionError"}', 15, status))).resolves.toEqual(unreadable('refused'));
  });
  it('#2349 HTTP 404 is source_settings_unreadable, cause not_found', async () => {
    await expect(readCapturePrecision(client('{"exc_type":"DoesNotExistError"}', 15, 404))).resolves.toEqual(unreadable('not_found'));
  });
  it.each([400, 405, 409, 417])('#2349 HTTP %i is source_settings_unreadable, cause malformed_reply', async (status) => {
    await expect(readCapturePrecision(client('{"exc_type":"ValidationError"}', 15, status))).resolves.toEqual(unreadable('malformed_reply'));
  });
  it('#2349 an oversized 200 reply is source_settings_unreadable, cause malformed_reply', async () => {
    await expect(readCapturePrecision(client(`{"data":{"pad":"${'x'.repeat(ERP_RESPONSE_MAX_BYTES)}"}}`, 15))).resolves.toEqual(unreadable('malformed_reply'));
  });
  it('#2349 a network failure is source_settings_unreadable, cause unreachable', async () => {
    const c = client('{}', 15);
    c.fetchImpl.mockRejectedValue(new TypeError('network down'));
    await expect(readCapturePrecision(c)).resolves.toEqual(unreadable('unreachable'));
  });
  it('#2349 a timed-out read is source_settings_unreadable, cause unreachable', async () => {
    const c = client('{}', 15);
    c.fetchImpl.mockRejectedValue(new DOMException('ERPNext request exceeded its deadline', 'TimeoutError'));
    await expect(readCapturePrecision(c)).resolves.toEqual(unreadable('unreachable'));
  });
  it.each([500, 502, 503, 429])('#2349 HTTP %i is source_settings_unreadable, cause unreachable', async (status) => {
    await expect(readCapturePrecision(client('{"exc_type":"ValidationError"}', 15, status))).resolves.toEqual(unreadable('unreachable'));
  });
  it('#2349 a redirect is source_settings_unreadable, cause unreachable', async () => {
    await expect(readCapturePrecision(client('', 15, 302))).resolves.toEqual(unreadable('unreachable'));
  });
  it.each(['not json', '[]', '"text"', 'null', ''])('#2349 an invalid body %j is source_settings_unreadable, cause malformed_reply', async (body) => {
    await expect(readCapturePrecision(client(body, 15))).resolves.toEqual(unreadable('malformed_reply'));
  });
  /** A client with the default retry budget and an instant backoff, so the retry path runs as it does in production. */
  const retrying = (...replies: Array<() => Response | Promise<Response>>) => {
    const c = { ...client('{}', 15), maxRetries: undefined, sleep: vi.fn(async (_ms: number) => {}) };
    for (const reply of replies) c.fetchImpl.mockImplementationOnce(async () => reply());
    return c;
  };
  const reply = (body: string, status: number) => () => new Response(body, { status, headers: { 'content-type': 'application/json' } });
  it('#2349 a 503 followed by a 200 is retried and the read succeeds', async () => {
    const c = retrying(reply('{"exc_type":"secret detail"}', 503), reply('{"data":{"currency_precision":"2","number_format":"#,###.##"}}', 200));
    await expect(readCapturePrecision(c)).resolves.toEqual({ ok: true, scale: 2 });
    expect(c.fetchImpl).toHaveBeenCalledTimes(2);
    expect(c.sleep).toHaveBeenCalledTimes(1);
  });
  it('#2349 a network failure followed by a 200 is retried and the read succeeds', async () => {
    const c = retrying(() => { throw new TypeError('network down'); }, reply('{"data":{"currency_precision":"2","number_format":"#,###.##"}}', 200));
    await expect(readCapturePrecision(c)).resolves.toEqual({ ok: true, scale: 2 });
    expect(c.fetchImpl).toHaveBeenCalledTimes(2);
  });
  it('#2349 failures on every retry are source_settings_unreadable, cause unreachable', async () => {
    const failing = reply('{"exc_type":"secret detail"}', 503);
    const c = retrying(...Array.from({ length: ERP_DEFAULT_MAX_RETRIES + 1 }, () => failing));
    await expect(readCapturePrecision(c)).resolves.toEqual(unreadable('unreachable'));
    expect(c.fetchImpl).toHaveBeenCalledTimes(ERP_DEFAULT_MAX_RETRIES + 1);
    expect(c.sleep.mock.calls.map(([ms]) => ms)).toEqual([500, 1000, 1500]);
  });
  it('#2349 a failed read logs no ERP reply, host or error detail', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const failing = client('{}', 15);
      failing.fetchImpl.mockRejectedValue(new TypeError('error sending request for url (https://example.test/) secret detail'));
      await readCapturePrecision(failing);
      await readCapturePrecision(client('{"exc_type":"secret detail"}', 15, 503));
      await readCapturePrecision(client('{"exc_type":"secret detail"}', 15, 403));
      await readCapturePrecision(client('secret detail', 15));
      const retried = retrying(...Array.from({ length: ERP_DEFAULT_MAX_RETRIES + 1 }, () => () => { throw new TypeError('error sending request for url (https://example.test/) secret detail'); }));
      await readCapturePrecision(retried);
      expect(retried.fetchImpl).toHaveBeenCalledTimes(ERP_DEFAULT_MAX_RETRIES + 1);
      await readCapturePrecision(retrying(reply('{"exc_type":"secret detail"}', 503), reply('secret detail', 200)));
      const logged = JSON.stringify([...log.mock.calls, ...warn.mock.calls]);
      expect(logged).not.toMatch(/secret detail|example\.test|System%20Settings/);
    } finally { log.mockRestore(); warn.mockRestore(); }
  });
  it('#2349 the cause carries no ERP reply text', async () => {
    const reply = JSON.stringify({ exc_type: 'PermissionError', _server_messages: JSON.stringify([JSON.stringify({ message: 'secret detail' })]) });
    const result = await readCapturePrecision(client(reply, 15, 403));
    expect(JSON.stringify(result)).not.toMatch(/secret detail|PermissionError|example\.test/);
  });
});

describe('#2195 the precision rule follows the ERP major version', () => {
  // Real System Settings GET shapes: version 16 carries the use_number_format_from_currency Check; version 15 has no such field.
  const v16 = (data: Record<string, unknown>) => readCapturePrecision(client(JSON.stringify({ data: { float_precision: '', rounding_method: 'Banker\'s Rounding', use_number_format_from_currency: 0, ...data } }), 16));
  const v15 = (data: Record<string, unknown>) => readCapturePrecision(client(JSON.stringify({ data: { float_precision: '', rounding_method: 'Banker\'s Rounding', ...data } }), 15));
  it('version 16 explicit 0 with a 3-decimal format is scale 0', async () => {
    await expect(v16({ currency_precision: '0', number_format: '#,###.###' })).resolves.toEqual({ ok: true, scale: 0 });
  });
  it('version 16 explicit 0 with a 2-decimal format is scale 0', async () => {
    await expect(v16({ currency_precision: 0, number_format: '#,###.##' })).resolves.toEqual({ ok: true, scale: 0 });
  });
  it('version 15 explicit 0 behaves as blank: the number format decimals', async () => {
    await expect(v15({ currency_precision: '0', number_format: '#,###.##' })).resolves.toEqual({ ok: true, scale: 2 });
    await expect(v15({ currency_precision: 0, number_format: '#,###.##' })).resolves.toEqual({ ok: true, scale: 2 });
    await expect(v15({ currency_precision: '0', number_format: '#.###,##' })).resolves.toEqual({ ok: true, scale: 2 });
    await expect(v15({ currency_precision: 0, number_format: '#,###' })).resolves.toEqual({ ok: true, scale: 0 });
    await expect(v15({ currency_precision: 0, number_format: null })).resolves.toEqual({ ok: false, reason: 'source_precision_unknown' });
  });
  it('version 16 explicit 0 wins over the switch: scale 0, not per-currency', async () => {
    await expect(v16({ currency_precision: 0, number_format: '#,###.##', use_number_format_from_currency: 1 })).resolves.toEqual({ ok: true, scale: 0 });
  });
  it('version 16 blank with "use number format from currency" on is source_precision_per_currency', async () => {
    await expect(v16({ currency_precision: '', number_format: '#,###.##', use_number_format_from_currency: 1 })).resolves.toEqual({ ok: false, reason: 'source_precision_per_currency' });
  });
  it('version 16 blank with the switch off takes the format decimals', async () => {
    await expect(v16({ currency_precision: '', number_format: '#,###' })).resolves.toEqual({ ok: true, scale: 0 });
    await expect(v16({ currency_precision: '', number_format: '#,###.##' })).resolves.toEqual({ ok: true, scale: 2 });
  });
  it('version 15 without the switch field takes the format decimals', async () => {
    await expect(v15({ currency_precision: '', number_format: '#.###' })).resolves.toEqual({ ok: true, scale: 0 });
  });
  it('an explicit positive precision wins on both versions, even with the switch on', async () => {
    await expect(v16({ currency_precision: '2', number_format: '#,###', use_number_format_from_currency: 1 })).resolves.toEqual({ ok: true, scale: 2 });
    await expect(v15({ currency_precision: 1, number_format: '#,###.##' })).resolves.toEqual({ ok: true, scale: 1 });
  });
  it('version 16 blank with an unreadable switch value stays unknown', async () => {
    await expect(v16({ currency_precision: '', number_format: '#,###.##', use_number_format_from_currency: 'yes' })).resolves.toEqual({ ok: false, reason: 'source_precision_unknown' });
  });
  it.each([null, undefined, Number.NaN, 14])('#2349 version %s is source_settings_unreadable, cause version_unknown', async (major) => {
    const c = { ...client('{"data":{"currency_precision":"2","number_format":"#,###.##"}}', 15), versionMajor: major as number | null };
    await expect(readCapturePrecision(c)).resolves.toEqual({ ok: false, reason: 'source_settings_unreadable', cause: 'version_unknown' });
  });
});

it('AC-ROP-017 caches precision per company and document kind for a run and rereads for apply', async () => {
  const { createCapturePrecisionReader } = await import('./captureEvidence');
  const c = client('{"data":{"currency_precision":"2","float_precision":"3","number_format":"#,###.##"}}', 15);
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
