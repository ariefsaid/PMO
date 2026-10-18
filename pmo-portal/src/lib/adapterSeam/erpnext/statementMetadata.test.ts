import { describe, expect, it, vi } from 'vitest';
import { fetchStatementMetadata, fetchStatementPublicationMetadata, statementRequestFetch } from './statementMetadata.ts';

const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const client = (fetchImpl: typeof fetch) => ({ fetchImpl, apiKey: 'k', apiSecret: 's', baseUrl: 'https://erp.example.test', maxRetries: 0 });

describe('statement metadata', () => {
  it('AC-005: captures IDR, book, applicable fiscal calendar, precision and report settings', async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      const path = new URL(String(url)).pathname;
      if (path.endsWith('/Company/Synthetic%20Co')) return response({ data: { name: 'Synthetic Co', default_currency: 'IDR', default_finance_book: 'Accrual' } });
      if (path.endsWith('/Fiscal%20Year')) return response({ data: [{ name: 'FY-X', year_start_date: '2025-04-01', year_end_date: '2026-03-31' }] });
      if (path.endsWith('/Accounts%20Settings')) return response({ data: { allow_stale: 0, show_unclosed_fy_pl: 1, ignore_is_opening_check: 0, ignore_account_closing_balance: 0 } });
      if (path.endsWith('/System%20Settings')) return response({ data: { currency_precision: 3, float_precision: 3, rounding_method: "Banker's Rounding", currency: 'IDR' } });
      if (path.endsWith('/Currency/IDR')) return response({ data: { name: 'IDR', smallest_currency_fraction_value: 1000 } });
      throw new Error(`unexpected path ${path}`);
    }) as typeof fetch;
    await expect(fetchStatementMetadata(client(fetchImpl), { company: 'Synthetic Co' })).resolves.toMatchObject({
      currency: 'IDR', defaultFinanceBook: 'Accrual', precision: 3, floatPrecision: 3,
      roundingMethod: "Banker's Rounding", zeroCutoff: '0.0005',
      calendar: [{ name: 'FY-X', start: '2025-04-01', end: '2026-03-31' }],
    });
  });

  it('AC-005: uses documented Frappe defaults when optional System Settings are blank', async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      const path = new URL(String(url)).pathname;
      if (path.endsWith('/Company/Synthetic%20Co')) return response({ data: { name: 'Synthetic Co', default_currency: 'IDR', default_finance_book: null } });
      if (path.endsWith('/Fiscal%20Year')) return response({ data: [{ name: 'FY-X', year_start_date: '2025-04-01', year_end_date: '2026-03-31' }] });
      if (path.endsWith('/Accounts%20Settings')) return response({ data: { ignore_is_opening_check: 0, ignore_account_closing_balance: 0 } });
      if (path.endsWith('/System%20Settings')) return response({ data: { currency_precision: '', float_precision: null, rounding_method: '' } });
      if (path.endsWith('/Currency/IDR')) return response({ data: { smallest_currency_fraction_value: 100 } });
      throw new Error(`unexpected path ${path}`);
    }) as typeof fetch;
    await expect(fetchStatementMetadata(client(fetchImpl), { company: 'Synthetic Co' })).resolves.toMatchObject({ precision: 2, floatPrecision: 3, roundingMethod: "Banker's Rounding" });
  });

  it('AC-005: rejects unsupported currency and malformed or missing required metadata', async () => {
    const fetchImpl = vi.fn(async () => response({ data: { name: 'Synthetic Co', default_currency: 'USD' } })) as typeof fetch;
    await expect(fetchStatementMetadata(client(fetchImpl), { company: 'Synthetic Co' })).rejects.toThrow(/IDR/i);
  });
});

// These are synthetic native-shaped transport fixtures, not live metadata captures or financial goldens.

const STRICT_PROFILE = { erpVersion: '16.33.0', frappeVersion: '16.31.0' } as const;
type SyntheticYear = { name: string; doc: Record<string, unknown> };
type StrictFixture = {
  languageCode: string;
  company: Record<string, unknown>;
  companyRows?: unknown[];
  accounts: Record<string, unknown>;
  system: Record<string, unknown>;
  defaults: Record<string, unknown>;
  currency: Record<string, unknown>;
  language: Record<string, unknown>;
  financeBooks: unknown[];
  years: SyntheticYear[];
  fiscalPage?: (offset: number) => unknown;
  deniedPath?: string;
  rawResponsePath?: string;
  rawResponseBody?: unknown;
};

function year(name: string, start: string, end: string, companies: unknown[] = []): SyntheticYear {
  return { name, doc: { name, disabled: 0, year_start_date: start, year_end_date: end, companies } };
}

function strictHarness(overrides: Partial<StrictFixture> = {}) {
  const fixture: StrictFixture = {
    languageCode: 'en',
    company: { name: 'Synthetic Co', default_currency: 'IDR', default_finance_book: 'Accrual', extra_native_field: 'ignored' },
    accounts: { name: 'Accounts Settings', ignore_is_opening_check_for_reporting: 0, ignore_account_closing_balance: 0, extra_native_field: 1 },
    system: { language: 'en', currency_precision: '', float_precision: '', rounding_method: '', use_number_format_from_currency: 0, number_format: '' },
    defaults: { currency_precision: '', float_precision: '', rounding_method: '', number_format: '' },
    currency: { name: 'IDR', fraction_units: 100, number_format: '' },
    language: { name: 'en', enabled: 1, number_format: '' },
    financeBooks: [],
    years: [year('FY-2025', '2025-04-01', '2026-03-31')],
    ...overrides,
  };
  const calls: Array<{ request: Request; url: URL }> = [];
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(input, init);
    const url = new URL(request.url);
    calls.push({ request, url });
    if (fixture.deniedPath === url.pathname) return response({ exc_type: 'PermissionError' }, 403);
    if (fixture.rawResponsePath === url.pathname) return response(fixture.rawResponseBody);
    if (url.pathname === '/api/resource/System%20Settings/System%20Settings') return response({ data: fixture.system });
    if (url.pathname === `/api/resource/Language/${encodeURIComponent(fixture.languageCode)}`) return response({ data: fixture.language });
    if (url.pathname === '/api/resource/Company') return response({ data: fixture.companyRows ?? [fixture.company] });
    if (url.pathname === '/api/resource/Accounts%20Settings/Accounts%20Settings') return response({ data: fixture.accounts });
    if (url.pathname === '/api/resource/Currency/IDR') return response({ data: fixture.currency });
    if (url.pathname === '/api/resource/Finance%20Book') return response({ data: fixture.financeBooks });
    if (url.pathname === '/api/resource/Fiscal%20Year') {
      const offset = Number(url.searchParams.get('limit_start'));
      return response(fixture.fiscalPage ? fixture.fiscalPage(offset) : { data: fixture.years.slice(offset, offset + 500).map(({ name }) => ({ name })) });
    }
    if (url.pathname.startsWith('/api/resource/Fiscal%20Year/')) {
      const name = decodeURIComponent(url.pathname.slice('/api/resource/Fiscal%20Year/'.length));
      return response({ data: fixture.years.find((item) => item.name === name)?.doc });
    }
    if (url.pathname === '/api/method/frappe.core.doctype.system_settings.system_settings.load') {
      return response({ message: { defaults: fixture.defaults, timezones: ['ignored'] } });
    }
    throw new Error(`Unexpected synthetic request ${url.pathname}`);
  }) as typeof fetch;
  return { fixture, calls, client: { ...client(fetchImpl), maxRetries: 0 } };
}

function readStrict(harness: ReturnType<typeof strictHarness>, profile: unknown = STRICT_PROFILE) {
  return fetchStatementPublicationMetadata(harness.client, { company: 'Synthetic Co', profile } as never);
}

describe('strict statement publication metadata (synthetic fixtures)', () => {
  it('refuses an omitted profile before any metadata request', async () => {
    const h = strictHarness();
    await expect(fetchStatementPublicationMetadata(h.client, { company: 'Synthetic Co' } as never)).rejects.toThrow();
    expect(h.calls).toHaveLength(0);
  });

  it.each([
    ['unproven ERP version', { erpVersion: '16.33.1', frappeVersion: '16.31.0' }],
    ['unproven Frappe version', { erpVersion: '16.33.0', frappeVersion: '16.31.1' }],
    ['major-only profile', { erpVersion: '16', frappeVersion: '16' }],
    ['null profile', null],
  ])('refuses %s before any metadata request', async (_label, profile) => {
    const h = strictHarness();
    await expect(readStrict(h, profile)).rejects.toThrow();
    expect(h.calls).toHaveLength(0);
  });

  it('resolves exact profile, settings, effective branches, global book and applicable calendar', async () => {
    const h = strictHarness();
    const result = await readStrict(h);
    expect(result.metadata).toEqual({
      erpVersion: '16.33.0', frappeVersion: '16.31.0', currency: 'IDR', defaultFinanceBook: 'Accrual', hasFinanceBooks: false,
      calendar: [{ name: 'FY-2025', start: '2025-04-01', end: '2026-03-31' }], currencyPrecision: 2, floatPrecision: 3,
      bsOpeningPrecision: 2, roundingMethod: "Banker's Rounding (legacy)", fractionUnits: 100,
      ignoreOpeningCheck: false, ignoreAccountClosingBalance: false,
    });
    expect(result.context.requestLanguage).toBe('en');
    expect(result.context.currencyPrecisionBranch).toBe('number_format');
    expect(result.context.numberFormatBranch).toBe('native_default');
    expect(result.context.raw.systemSettings.currencyPrecision).toBe('');
    expect(result.context.raw.systemDefaults.currencyPrecision).toBe('');
    expect(result.metadata).not.toHaveProperty('zeroCutoff');
    expect(result.context).not.toHaveProperty('fetchImpl');
    expect(result.context).not.toHaveProperty('nativeDocuments');
  });

  it('reads exactly one Company row through a bounded exact-name projection and preserves selected null', async () => {
    const h = strictHarness({ company: { name: 'Synthetic Co', default_currency: 'IDR', default_finance_book: null } });
    const result = await readStrict(h);
    const companyCall = h.calls.find(({ url }) => url.pathname === '/api/resource/Company');
    expect(companyCall).toBeDefined();
    expect(companyCall?.request.method).toBe('GET');
    expect(JSON.parse(companyCall?.url.searchParams.get('filters') ?? 'null')).toEqual([['name', '=', 'Synthetic Co']]);
    expect(JSON.parse(companyCall?.url.searchParams.get('fields') ?? 'null')).toEqual(['name', 'default_currency', 'default_finance_book']);
    expect(companyCall?.url.searchParams.get('limit_page_length')).toBe('2');
    expect(result.metadata.defaultFinanceBook).toBeNull();
  });

  it('normalizes a present blank Company default book the same as selected null', async () => {
    const h = strictHarness({ company: { name: 'Synthetic Co', default_currency: 'IDR', default_finance_book: '' } });
    expect((await readStrict(h)).metadata.defaultFinanceBook).toBeNull();
  });

  it.each([
    ['zero Company rows', []],
    ['multiple Company rows', [
      { name: 'Synthetic Co', default_currency: 'IDR', default_finance_book: null },
      { name: 'Synthetic Co', default_currency: 'IDR', default_finance_book: null },
    ]],
    ['wrong Company identity', [{ name: 'Other Co', default_currency: 'IDR', default_finance_book: null }]],
  ])('rejects %s from the Company collection', async (_label, companyRows) => {
    await expect(readStrict(strictHarness({ companyRows }))).rejects.toThrow();
  });

  it('binds every post-bootstrap GET to the exact enabled request language without a self-User read', async () => {
    const h = strictHarness();
    await readStrict(h);
    expect(h.calls[0].url.pathname).toBe('/api/resource/System%20Settings/System%20Settings');
    expect(h.calls[1].url.pathname).toBe('/api/resource/Language/en');
    expect(h.calls.some(({ url }) => /\/User(?:\/|$)/.test(url.pathname))).toBe(false);
    for (const { request, url } of h.calls.slice(2)) {
      expect(request.headers.get('accept-language')).toBe('en');
      expect(request.credentials).toBe('omit');
      expect(url.searchParams.has('_lang')).toBe(false);
    }
  });

  it.each([
    ['disabled', { name: 'en', enabled: 0, number_format: '' }],
    ['mismatched identity', { name: 'fr', enabled: 1, number_format: '' }],
    ['missing format', { name: 'en', enabled: 1 }],
  ])('rejects %s request language rather than falling back', async (_label, language) => {
    const h = strictHarness({ language });
    await expect(readStrict(h)).rejects.toThrow();
    expect(h.calls.some(({ url }) => url.pathname === '/api/resource/Language/en')).toBe(true);
    expect(h.calls.some(({ url }) => /\/User(?:\/|$)/.test(url.pathname))).toBe(false);
  });

  it('rejects Cookie headers from both Request and init inputs', async () => {
    const fetchImpl = vi.fn(async () => response({})) as typeof fetch;
    const wrapped = statementRequestFetch(fetchImpl, 'https://erp.example.test', 'en');
    await expect(wrapped('https://erp.example.test/api/resource/Company', { headers: { Cookie: 'session=x' } })).rejects.toThrow();
    await expect(wrapped(new Request('https://erp.example.test/api/resource/Company', { headers: { Cookie: 'session=x' } }))).rejects.toThrow();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('rejects _lang query overrides', async () => {
    const fetchImpl = vi.fn(async () => response({})) as typeof fetch;
    const wrapped = statementRequestFetch(fetchImpl, 'https://erp.example.test', 'en');
    await expect(wrapped('https://erp.example.test/api/resource/Company?_lang=fr')).rejects.toThrow();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('rejects URL credentials, cross-origin and non-GET requests without leaking fetch errors', async () => {
    const fetchImpl = vi.fn(async () => response({})) as typeof fetch;
    const wrapped = statementRequestFetch(fetchImpl, 'https://erp.example.test', 'en');
    await expect(wrapped('https://user:pass@erp.example.test/api/resource/Company')).rejects.toThrow();
    await expect(wrapped('https://other.example.test/api/resource/Company')).rejects.toThrow();
    await expect(wrapped('https://erp.example.test/api/resource/Company', { method: 'POST' })).rejects.toThrow();
    expect(fetchImpl).not.toHaveBeenCalled();
    const failedFetch = vi.fn(async () => { throw new Error('authorization=must-not-leak'); }) as typeof fetch;
    const safeWrapper = statementRequestFetch(failedFetch, 'https://erp.example.test', 'en');
    await expect(safeWrapper('https://erp.example.test/api/resource/Company')).rejects.toMatchObject({ message: 'ERPNext statement request failed to reach the server', code: 'external-unreachable' });
  });

  it('keeps invalid Request options classified as safe configuration rejection without fetching', async () => {
    const fetchImpl = vi.fn(async () => response({})) as typeof fetch;
    const wrapped = statementRequestFetch(fetchImpl, 'https://erp.example.test', 'en');
    await expect(wrapped('https://erp.example.test/api/resource/Company', { method: 'GET', body: 'not-allowed' })).rejects.toMatchObject({ message: 'Invalid statement request options', code: 'config-rejected' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('classifies a real network rejection as safe connectivity failure without exposing its raw message', async () => {
    const rawSecretMessage = 'SECRET_SENTINEL socket reset https://private-url.invalid token API_KEY_SENTINEL:API_SECRET_SENTINEL';
    const fetchImpl = vi.fn(async () => { throw new Error(rawSecretMessage); }) as typeof fetch;
    const wrapped = statementRequestFetch(fetchImpl, 'https://erp.example.test', 'en');
    let caught: unknown;
    try {
      await wrapped('https://erp.example.test/api/resource/Company');
    } catch (error) {
      caught = error;
    }
    expect(caught).toMatchObject({ message: 'ERPNext statement request failed to reach the server', code: 'external-unreachable' });
    const exposed = JSON.stringify(caught, Object.getOwnPropertyNames(caught as object));
    expect(exposed).not.toContain('SECRET_SENTINEL');
    expect(exposed).not.toContain('API_KEY_SENTINEL');
    expect(exposed).not.toContain('API_SECRET_SENTINEL');
    expect(exposed).not.toContain('https://private-url.invalid');
    expect(caught).not.toHaveProperty('cause');
    expect(caught).not.toHaveProperty('details');
  });

  it('classifies the request deadline abort safely and keeps raw transport secrets out of errors and logs', async () => {
    const rawSecretMessage = 'SECRET_SENTINEL deadline socket detail https://private-url.invalid token API_KEY_SENTINEL:API_SECRET_SENTINEL';
    const h = strictHarness();
    const originalFetch = h.client.fetchImpl;
    const deadlineClient = {
      ...h.client,
      apiKey: 'API_KEY_SENTINEL',
      apiSecret: 'API_SECRET_SENTINEL',
      timeoutMs: 10,
      maxRetries: 0,
      fetchImpl: vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const request = input instanceof Request ? input : new Request(input, init);
        if (new URL(request.url).pathname === '/api/resource/Company') {
          return new Promise<Response>((_resolve, reject) => {
            const fail = () => reject(new Error(rawSecretMessage));
            if (request.signal.aborted) fail();
            else request.signal.addEventListener('abort', fail, { once: true });
          });
        }
        return originalFetch(input, init);
      }) as typeof fetch,
    };
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    let caught: unknown;
    let logged: string;
    try {
      await fetchStatementPublicationMetadata(deadlineClient, { company: 'Synthetic Co', profile: STRICT_PROFILE });
    } catch (error) {
      caught = error;
    } finally {
      logged = errorLog.mock.calls.flat().join(' ');
      errorLog.mockRestore();
    }
    expect(caught).toMatchObject({ message: 'ERPNext statement request failed to reach the server', code: 'external-unreachable' });
    const exposed = JSON.stringify(caught, Object.getOwnPropertyNames(caught as object));
    expect(logged).toContain('[erpnext-client] fetch failed');
    for (const value of ['SECRET_SENTINEL', 'API_KEY_SENTINEL', 'API_SECRET_SENTINEL', 'https://erp.example.test', 'https://private-url.invalid']) {
      expect(exposed).not.toContain(value);
      expect(logged).not.toContain(value);
    }
    expect(exposed).not.toContain('deadline socket detail');
    expect(logged).not.toContain('deadline socket detail');
    expect(caught).not.toHaveProperty('cause');
    expect(caught).not.toHaveProperty('details');
  });

  it('normalizes Request inputs, preserves transport options and headers, and explicitly omits credentials', async () => {
    let firstRequest = true;
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(input, init);
      expect(request.credentials).toBe('omit');
      if (firstRequest) {
        firstRequest = false;
        expect(request.headers.get('authorization')).toBe('token synthetic');
        expect(request.headers.get('x-trace')).toBe('kept');
        expect(request.headers.get('accept-language')).toBe('en-US');
        expect(request.redirect).toBe('manual');
        expect(request.signal.aborted).toBe(false);
        controller.abort();
        expect(request.signal.aborted).toBe(true);
      }
      return response({ ok: true });
    }) as typeof fetch;
    const wrapped = statementRequestFetch(fetchImpl, 'https://erp.example.test', 'en-US');
    const controller = new AbortController();
    const request = new Request('https://erp.example.test/api/resource/Company', {
      method: 'GET', headers: { Authorization: 'token synthetic' }, signal: controller.signal, redirect: 'manual',
    });
    await wrapped(request, { headers: { 'X-Trace': 'kept' } });
    await wrapped(new URL('https://erp.example.test/api/resource/Language/en'));
    await wrapped('/api/resource/Language/en');
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it('distinguishes missing raw values from allowed blank and null values', async () => {
    const missingCases: Array<[string, Partial<StrictFixture>]> = [
      ['Company default book', { company: { name: 'Synthetic Co', default_currency: 'IDR' } }],
      ['Currency fraction units', { currency: { name: 'IDR', number_format: '' } }],
      ['Accounts opening setting', { accounts: { name: 'Accounts Settings', ignore_account_closing_balance: 0 } }],
      ['System language', { system: { currency_precision: '', float_precision: '', rounding_method: '', use_number_format_from_currency: 0, number_format: '' } }],
      ['DB default field', { defaults: { currency_precision: '', float_precision: '', rounding_method: '' } }],
    ];
    for (const [label, overrides] of missingCases) await expect(readStrict(strictHarness(overrides))).rejects.toThrow(label.split(' ')[0]);
    const h = strictHarness({ company: { name: 'Synthetic Co', default_currency: 'IDR', default_finance_book: null }, currency: { name: 'IDR', fraction_units: null, number_format: null } });
    const result = await readStrict(h);
    expect(result.metadata.defaultFinanceBook).toBeNull();
    expect(result.metadata.fractionUnits).toBe(100);
  });

  it('rejects malformed successful envelopes rather than treating them as absent metadata', async () => {
    const company = strictHarness({ rawResponsePath: '/api/resource/Company', rawResponseBody: { data: null } });
    await expect(readStrict(company)).rejects.toThrow(/Company/i);
    const years = strictHarness({ rawResponsePath: '/api/resource/Fiscal%20Year', rawResponseBody: { data: {} } });
    await expect(readStrict(years)).rejects.toThrow(/Fiscal Year/i);
    const defaults = strictHarness({ rawResponsePath: '/api/method/frappe.core.doctype.system_settings.system_settings.load', rawResponseBody: { message: {} } });
    await expect(readStrict(defaults)).rejects.toThrow(/default/i);
  });

  it('retains present null Select observations while normalizing only null/blank equality', async () => {
    const h = strictHarness({
      system: { language: 'en', currency_precision: null, float_precision: null, rounding_method: null, use_number_format_from_currency: 0, number_format: null },
      defaults: { currency_precision: '', float_precision: null, rounding_method: '', number_format: '' },
      language: { name: 'en', enabled: 1, number_format: null },
      currency: { name: 'IDR', fraction_units: null, number_format: null },
    });
    const result = await readStrict(h);
    expect(result.metadata).toMatchObject({ currencyPrecision: 2, floatPrecision: 3, bsOpeningPrecision: 2, roundingMethod: "Banker's Rounding (legacy)", fractionUnits: 100 });
    expect(result.context.raw.systemSettings.currencyPrecision).toBeNull();
    expect(result.context.raw.systemDefaults.currencyPrecision).toBe('');
  });

  it('rejects Single/default disagreement and denied System Settings load', async () => {
    const mismatch = strictHarness({ system: { language: 'en', currency_precision: '3', float_precision: '', rounding_method: '', use_number_format_from_currency: 0, number_format: '' } });
    await expect(readStrict(mismatch)).rejects.toThrow(/default/i);
    const denied = strictHarness({ deniedPath: '/api/method/frappe.core.doctype.system_settings.system_settings.load' });
    await expect(readStrict(denied)).rejects.toThrow();
  });

  it('uses configured positive currency precision and exact finite format mapping', async () => {
    const configured = strictHarness({ system: { language: 'en', currency_precision: '9', float_precision: '', rounding_method: '', use_number_format_from_currency: 0, number_format: '' }, defaults: { currency_precision: '9', float_precision: '', rounding_method: '', number_format: '' } });
    expect((await readStrict(configured)).metadata.currencyPrecision).toBe(9);
    const mapped: ReadonlyArray<readonly [string, number]> = [
      ['#,###.##', 2], ['#.###,##', 2], ['# ###.##', 2], ['# ###,##', 2], ["#'###.##", 2], ['#, ###.##', 2], ['#,##,###.##', 2], ['#,###.###', 3], ['#.###', 0], ['#,###', 0],
    ];
    for (const [format, precision] of mapped) {
      const h = strictHarness({ language: { name: 'en', enabled: 1, number_format: format } });
      expect((await readStrict(h)).metadata.currencyPrecision, format).toBe(precision);
    }
    const mapOnly = strictHarness({ language: { name: 'en', enabled: 1, number_format: '#.########' } });
    await expect(readStrict(mapOnly)).rejects.toThrow();
  });

  it('preserves blank/zero format fallthrough and the enabled nonblank Currency override branch', async () => {
    const zero = strictHarness({ system: { language: 'en', currency_precision: 0, float_precision: '', rounding_method: '', use_number_format_from_currency: 0, number_format: '' }, defaults: { currency_precision: 0, float_precision: '', rounding_method: '', number_format: '' }, language: { name: 'en', enabled: 1, number_format: '#.###' } });
    expect((await readStrict(zero)).metadata.currencyPrecision).toBe(0);
    const dbFormat = strictHarness({ system: { language: 'en', currency_precision: '', float_precision: '', rounding_method: '', use_number_format_from_currency: 0, number_format: '#,###.###' }, defaults: { currency_precision: '', float_precision: '', rounding_method: '', number_format: '#,###.###' } });
    expect((await readStrict(dbFormat)).metadata.currencyPrecision).toBe(3);
    const enabled = strictHarness({ system: { language: 'en', currency_precision: '', float_precision: '', rounding_method: '', use_number_format_from_currency: 1, number_format: '#,###.##' }, defaults: { currency_precision: '', float_precision: '', rounding_method: '', number_format: '#,###.##' }, currency: { name: 'IDR', fraction_units: 100, number_format: '#,###.###' } });
    const currencyBranch = await readStrict(enabled);
    expect(currencyBranch.metadata.currencyPrecision).toBe(3);
    expect(currencyBranch.context.numberFormatBranch).toBe('currency');
    const enabledBlank = strictHarness({ system: { language: 'en', currency_precision: '', float_precision: '', rounding_method: '', use_number_format_from_currency: 1, number_format: '#,###.##' }, defaults: { currency_precision: '', float_precision: '', rounding_method: '', number_format: '#,###.##' }, currency: { name: 'IDR', fraction_units: 100, number_format: '' } });
    expect((await readStrict(enabledBlank)).metadata.currencyPrecision).toBe(2);
    const disabled = strictHarness({ system: { language: 'en', currency_precision: '', float_precision: '', rounding_method: '', use_number_format_from_currency: 0, number_format: '#,###.##' }, defaults: { currency_precision: '', float_precision: '', rounding_method: '', number_format: '#,###.##' }, currency: { name: 'IDR', fraction_units: 100, number_format: '#,###.###' } });
    expect((await readStrict(disabled)).metadata.currencyPrecision).toBe(2);
  });

  it('keeps general Float fallback 3 separate from Balance Sheet opening fallback 2', async () => {
    const zero = strictHarness({ system: { language: 'en', currency_precision: '', float_precision: 0, rounding_method: '', use_number_format_from_currency: 0, number_format: '' }, defaults: { currency_precision: '', float_precision: 0, rounding_method: '', number_format: '' } });
    expect((await readStrict(zero)).metadata).toMatchObject({ floatPrecision: 3, bsOpeningPrecision: 2 });
    const configured = strictHarness({ system: { language: 'en', currency_precision: '', float_precision: '8', rounding_method: '', use_number_format_from_currency: 0, number_format: '' }, defaults: { currency_precision: '', float_precision: '8', rounding_method: '', number_format: '' } });
    expect((await readStrict(configured)).metadata).toMatchObject({ floatPrecision: 8, bsOpeningPrecision: 8 });
  });

  it.each(["Banker's Rounding", "Banker's Rounding (legacy)", 'Commercial Rounding'])('accepts exact rounding mode %s', async (roundingMethod) => {
    const h = strictHarness({ system: { language: 'en', currency_precision: '', float_precision: '', rounding_method: roundingMethod, use_number_format_from_currency: 0, number_format: '' }, defaults: { currency_precision: '', float_precision: '', rounding_method: roundingMethod, number_format: '' } });
    expect((await readStrict(h)).metadata.roundingMethod).toBe(roundingMethod);
  });

  it('rejects unsafe request language codes before selecting a Language document', async () => {
    const h = strictHarness({ system: { language: 'en,fr;q=0.8', currency_precision: '', float_precision: '', rounding_method: '', use_number_format_from_currency: 0, number_format: '' } });
    await expect(readStrict(h)).rejects.toThrow();
    expect(h.calls.some(({ url }) => url.pathname.startsWith('/api/resource/Language/'))).toBe(false);
  });

  it('rejects malformed numbers, unknown formats/modes and non-native Check values', async () => {
    const badSystem = strictHarness({ system: { language: 'en', currency_precision: '2partial', float_precision: '', rounding_method: 'Modern', use_number_format_from_currency: 0, number_format: '' }, defaults: { currency_precision: '2partial', float_precision: '', rounding_method: 'Modern', number_format: '' } });
    await expect(readStrict(badSystem)).rejects.toThrow();
    const badCheck = strictHarness({ accounts: { name: 'Accounts Settings', ignore_is_opening_check_for_reporting: true, ignore_account_closing_balance: 0 } });
    await expect(readStrict(badCheck)).rejects.toThrow();
    const badCurrency = strictHarness({ currency: { name: 'IDR', fraction_units: 100, number_format: '#.########' } });
    await expect(readStrict(badCurrency)).rejects.toThrow();
    for (const fraction of [-1, 1.5, '2partial']) {
      const badFraction = strictHarness({ currency: { name: 'IDR', fraction_units: fraction, number_format: '' } });
      await expect(readStrict(badFraction)).rejects.toThrow(/fraction/i);
    }
  });

  it.each([[null, 100], [0, 0], [25, 25]])('preserves Currency fraction_units %s as %s', async (fraction, expected) => {
    const h = strictHarness({ currency: { name: 'IDR', fraction_units: fraction, number_format: '' } });
    expect((await readStrict(h)).metadata.fractionUnits).toBe(expected);
  });

  it('global Finance Book existence is independent, and denied reads never become false', async () => {
    const empty = strictHarness();
    expect((await readStrict(empty)).metadata.hasFinanceBooks).toBe(false);
    expect(empty.calls.find(({ url }) => url.pathname === '/api/resource/Finance%20Book')?.url.searchParams.has('filters')).toBe(false);
    const populated = strictHarness({ financeBooks: [{ name: 'Global Book', extra_native_field: 'ignored' }] });
    expect((await readStrict(populated)).metadata.hasFinanceBooks).toBe(true);
    const denied = strictHarness({ deniedPath: '/api/resource/Finance%20Book' });
    await expect(readStrict(denied)).rejects.toThrow();
    const malformed = strictHarness({ financeBooks: [{ extra_native_field: true }] });
    await expect(readStrict(malformed)).rejects.toThrow(/Finance Book/i);
  });

  it('requires exact Company identity, IDR and a present nullable default book', async () => {
    await expect(readStrict(strictHarness({ company: { name: 'Other Co', default_currency: 'IDR', default_finance_book: null } }))).rejects.toThrow();
    await expect(readStrict(strictHarness({ company: { name: 'Synthetic Co', default_currency: 'USD', default_finance_book: null } }))).rejects.toThrow(/IDR/i);
    await expect(readStrict(strictHarness({ company: { name: 'Synthetic Co', default_currency: 'IDR' } }))).rejects.toThrow(/Company.default_finance_book/i);
    await expect(readStrict(strictHarness({ company: { name: 'Synthetic Co', default_currency: 'IDR', default_finance_book: 4 } }))).rejects.toThrow();
  });

  it('selects global and matching-company Fiscal Years, excludes foreign-only children and ignores native extras', async () => {
    const h = strictHarness({ years: [
      year('FY-global', '2024-01-01', '2024-12-31'),
      year('FY-foreign', '2025-01-01', '2025-12-31', [{ company: 'Other Co', native_extra: 'ignored' }]),
      year('FY-own', '2026-01-01', '2026-12-31', [{ company: 'Synthetic Co', parent: 'FY-own', parenttype: 'Fiscal Year', parentfield: 'companies', extra_native_field: true }]),
    ] });
    expect((await readStrict(h)).metadata.calendar.map(({ name }) => name)).toEqual(['FY-global', 'FY-own']);
    const listUrl = h.calls.find(({ url }) => url.pathname === '/api/resource/Fiscal%20Year')?.url;
    expect(listUrl?.searchParams.get('limit_page_length')).toBe('500');
    expect(listUrl?.searchParams.get('order_by')).toBe('name asc');
  });

  it('rejects duplicate Fiscal Year identities, impossible dates, overlaps and malformed children', async () => {
    await expect(readStrict(strictHarness({ years: [year('FY-1', '2025-01-01', '2025-12-31'), year('FY-1', '2026-01-01', '2026-12-31')] }))).rejects.toThrow();
    await expect(readStrict(strictHarness({ years: [] }))).rejects.toThrow(/applicable/i);
    await expect(readStrict(strictHarness({ fiscalPage: () => ({ data: [{}] }) }))).rejects.toThrow(/Fiscal Year\.name/i);
    await expect(readStrict(strictHarness({ years: [{ name: 'FY-disabled', doc: { ...year('FY-disabled', '2025-01-01', '2025-12-31').doc, disabled: 1 } }] }))).rejects.toThrow(/changed while reading/i);
    await expect(readStrict(strictHarness({ years: [year('FY-bad-date', '2025-02-30', '2025-12-31')] }))).rejects.toThrow();
    await expect(readStrict(strictHarness({ years: [year('FY-1', '2025-01-01', '2025-08-31'), year('FY-2', '2025-08-31', '2026-02-01')] }))).rejects.toThrow(/overlap/i);
    await expect(readStrict(strictHarness({ years: [year('FY-child', '2025-01-01', '2025-12-31', [{ company: '' }])] }))).rejects.toThrow();
    await expect(readStrict(strictHarness({ years: [year('FY-child', '2025-01-01', '2025-12-31', [{ company: 'Synthetic Co', parent: 'wrong' }])] }))).rejects.toThrow();
    await expect(readStrict(strictHarness({ years: [year('FY-foreign', '2025-01-01', '2025-12-31', [{ company: 'Other Co' }])] }))).rejects.toThrow(/applicable/i);
  });

  it('paginates a full page through an explicit empty EOF page and rejects a malformed later page', async () => {
    const rows = Array.from({ length: 500 }, (_, index) => year(`FY-${index}`, '2025-01-01', '2025-12-31', index === 0 ? [] : [{ company: 'Other Co' }]));
    const complete = strictHarness({ years: rows });
    const result = await readStrict(complete);
    expect(result.metadata.calendar).toHaveLength(1);
    const fiscalPages = complete.calls.filter(({ url }) => url.pathname === '/api/resource/Fiscal%20Year');
    expect(fiscalPages.map(({ url }) => url.searchParams.get('limit_start'))).toEqual(['0', '500']);
    expect(fiscalPages.map(({ url }) => url.searchParams.get('order_by'))).toEqual(['name asc', 'name asc']);
    const malformed = strictHarness({ fiscalPage: (offset) => offset === 0 ? { data: Array.from({ length: 500 }, (_, index) => ({ name: `FY-${index}` })) } : { data: null } });
    await expect(readStrict(malformed)).rejects.toThrow();
  });

  it('treats a full twentieth Fiscal Year page as incomplete within the finite budget', async () => {
    const h = strictHarness({ fiscalPage: (offset) => ({ data: Array.from({ length: 500 }, (_, index) => ({ name: `FY-${offset + index}` })) }) });
    await expect(readStrict(h)).rejects.toThrow(/pagination|budget|complete/i);
    expect(h.calls.filter(({ url }) => url.pathname === '/api/resource/Fiscal%20Year')).toHaveLength(20);
  });
});
