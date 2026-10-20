import { describe, expect, it, vi } from 'vitest';
import { fetchStatementPublicationMetadata, statementRequestFetch } from './statementMetadata.ts';

const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const client = (fetchImpl: typeof fetch) => ({ fetchImpl, apiKey: 'k', apiSecret: 's', baseUrl: 'https://erp.example.test', maxRetries: 0 });

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
  deniedPaths?: string[];
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
  let activeRequests = 0;
  let maximumConcurrentRequests = 0;
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(input, init);
    const url = new URL(request.url);
    calls.push({ request, url });
    activeRequests += 1;
    maximumConcurrentRequests = Math.max(maximumConcurrentRequests, activeRequests);
    await Promise.resolve();
    try {
    if (fixture.deniedPath === url.pathname || fixture.deniedPaths?.includes(url.pathname)) return response({ exc_type: 'PermissionError' }, 403);
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
    } finally {
      activeRequests -= 1;
    }
  }) as typeof fetch;
  return { fixture, calls, client: { ...client(fetchImpl), maxRetries: 0 }, maxConcurrentRequests: () => maximumConcurrentRequests };
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

  it('resolves exact profile, readable Currency presentation, global book and applicable calendar', async () => {
    const h = strictHarness();
    const result = await readStrict(h);
    expect(result.metadata).toEqual({
      erpVersion: '16.33.0', frappeVersion: '16.31.0', currency: 'IDR', defaultFinanceBook: 'Accrual', hasFinanceBooks: false,
      calendar: [{ name: 'FY-2025', start: '2025-04-01', end: '2026-03-31' }], currencyPrecision: 2,
      roundingMethod: 'erpnext_report_output', fractionUnits: 100,
      ignoreOpeningCheck: false, ignoreAccountClosingBalance: false,
    });
    expect(result.context.requestLanguage).toBe('en');
    expect(result.context.currencyPrecisionBranch).toBe('currency_fraction_units');
    expect(result.context.raw.currency.fractionUnits).toBe(100);
    expect(result.context.raw).not.toHaveProperty('systemSettings');
    expect(result.context.raw).not.toHaveProperty('systemDefaults');
    expect(result.context.raw).not.toHaveProperty('language');
    expect(result.metadata).not.toHaveProperty('zeroCutoff');
    expect(result.context).not.toHaveProperty('fetchImpl');
    expect(result.context).not.toHaveProperty('nativeDocuments');
    expect(h.maxConcurrentRequests()).toBe(1);
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

  it('binds every GET to a deterministic request language without reading user or System Settings', async () => {
    const h = strictHarness();
    await readStrict(h);
    expect(h.calls[0].url.pathname).toBe('/api/resource/Company');
    expect(h.calls.some(({ url }) => url.pathname.startsWith('/api/resource/Language/'))).toBe(false);
    expect(h.calls.some(({ url }) => url.pathname.includes('System%20Settings'))).toBe(false);
    expect(h.calls.some(({ url }) => url.pathname === '/api/method/frappe.core.doctype.system_settings.system_settings.load')).toBe(false);
    expect(h.calls.some(({ url }) => /\/User(?:\/|$)/.test(url.pathname))).toBe(false);
    for (const { request, url } of h.calls) {
      expect(request.headers.get('accept-language')).toBe('en');
      expect(request.credentials).toBe('omit');
      expect(url.searchParams.has('_lang')).toBe(false);
    }
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
    ];
    for (const [label, overrides] of missingCases) await expect(readStrict(strictHarness(overrides))).rejects.toThrow(label.split(' ')[0]);
    const h = strictHarness({ company: { name: 'Synthetic Co', default_currency: 'IDR', default_finance_book: null }, currency: { name: 'IDR', fraction_units: 100, number_format: null } });
    const result = await readStrict(h);
    expect(result.metadata.defaultFinanceBook).toBeNull();
    expect(result.metadata.currencyPrecision).toBe(2);
  });

  it('rejects malformed successful envelopes rather than treating them as absent metadata', async () => {
    const company = strictHarness({ rawResponsePath: '/api/resource/Company', rawResponseBody: { data: null } });
    await expect(readStrict(company)).rejects.toThrow(/Company/i);
    const years = strictHarness({ rawResponsePath: '/api/resource/Fiscal%20Year', rawResponseBody: { data: {} } });
    await expect(readStrict(years)).rejects.toThrow(/Fiscal Year/i);
  });

  it('AC-006: does not depend on either System Settings endpoint when both return 403', async () => {
    const deniedPaths = [
      '/api/resource/System%20Settings/System%20Settings',
      '/api/method/frappe.core.doctype.system_settings.system_settings.load',
    ];
    const h = strictHarness({ deniedPaths });
    const result = await readStrict(h);
    expect(result.metadata.roundingMethod).toBe('erpnext_report_output');
    expect(h.calls.map(({ url }) => url.pathname).filter((path) => deniedPaths.includes(path))).toEqual([]);
    expect(h.calls.some(({ url }) => url.pathname.startsWith('/api/resource/Language/'))).toBe(false);
  });

  it('uses Currency number format for presentation precision and exact finite format mapping', async () => {
    const mapped: ReadonlyArray<readonly [string, number]> = [
      ['#,###.##', 2], ['#.###,##', 2], ['# ###.##', 2], ['# ###,##', 2], ["#'###.##", 2], ['#, ###.##', 2], ['#,##,###.##', 2], ['#,###.###', 3], ['#.###', 0], ['#,###', 0],
    ];
    for (const [format, precision] of mapped) {
      const h = strictHarness({ currency: { name: 'IDR', fraction_units: 100, number_format: format } });
      expect((await readStrict(h)).metadata.currencyPrecision, format).toBe(precision);
    }
    const mapOnly = strictHarness({ currency: { name: 'IDR', fraction_units: 100, number_format: '#.########' } });
    await expect(readStrict(mapOnly)).rejects.toThrow();
  });

  it('uses Currency fraction units when its number format is blank and rejects nonterminating precision', async () => {
    expect((await readStrict(strictHarness({ currency: { name: 'IDR', fraction_units: 1000, number_format: '' } }))).metadata.currencyPrecision).toBe(3);
    expect((await readStrict(strictHarness({ currency: { name: 'IDR', fraction_units: 25, number_format: '' } }))).metadata.currencyPrecision).toBe(2);
    await expect(readStrict(strictHarness({ currency: { name: 'IDR', fraction_units: 3, number_format: '' } }))).rejects.toThrow(/precision/i);
    await expect(readStrict(strictHarness({ currency: { name: 'IDR', fraction_units: null, number_format: '' } }))).rejects.toThrow(/precision/i);
  });

  it('does not claim accounting Float or rounding behavior in the display DTO', async () => {
    const metadata = (await readStrict(strictHarness())).metadata;
    expect(metadata).not.toHaveProperty('floatPrecision');
    expect(metadata).not.toHaveProperty('bsOpeningPrecision');
    expect(metadata.roundingMethod).toBe('erpnext_report_output');
  });

  it('uses a fixed worker language without reading user-specific ERP settings', async () => {
    const h = strictHarness({ languageCode: 'fr', system: { language: 'fr' } });
    const result = await readStrict(h);
    expect(result.context.requestLanguage).toBe('en');
    expect(h.calls.some(({ request }) => request.headers.get('accept-language') === 'fr')).toBe(false);
    expect(h.calls.some(({ url }) => url.pathname.startsWith('/api/resource/Language/'))).toBe(false);
  });

  it('rejects unsupported Currency formats and non-native Check values', async () => {
    const badCheck = strictHarness({ accounts: { name: 'Accounts Settings', ignore_is_opening_check_for_reporting: true, ignore_account_closing_balance: 0 } });
    await expect(readStrict(badCheck)).rejects.toThrow();
    const badCurrency = strictHarness({ currency: { name: 'IDR', fraction_units: 100, number_format: '#.########' } });
    await expect(readStrict(badCurrency)).rejects.toThrow();
    for (const fraction of [-1, 1.5, '2partial']) {
      const badFraction = strictHarness({ currency: { name: 'IDR', fraction_units: fraction, number_format: '' } });
      await expect(readStrict(badFraction)).rejects.toThrow(/fraction/i);
    }
  });

  it.each([[0, 0], [25, 25]])('preserves Currency fraction_units %s as %s', async (fraction, expected) => {
    const h = strictHarness({ currency: { name: 'IDR', fraction_units: fraction, number_format: '' } });
    expect((await readStrict(h)).metadata.fractionUnits).toBe(expected);
  });

  it('preserves a missing Currency fraction value when the number format supplies display precision', async () => {
    const h = strictHarness({ currency: { name: 'IDR', fraction_units: null, number_format: '#,###.##' } });
    const result = await readStrict(h);
    expect(result.metadata.currencyPrecision).toBe(2);
    expect(result.metadata.fractionUnits).toBeNull();
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
