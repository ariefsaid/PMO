import { callMethod, erpnextRequest } from './client.ts';
import type { ErpClientDeps } from './client.ts';
import { AppError } from '../../appError.ts';

export interface StatementFiscalYear { name: string; start: string; end: string }
export interface StatementMetadata {
  currency: 'IDR';
  defaultFinanceBook: string | null;
  calendar: StatementFiscalYear[];
  precision: number;
  floatPrecision: number;
  roundingMethod: "Banker's Rounding" | "Banker's Rounding (legacy)" | 'Commercial Rounding';
  zeroCutoff: string;
  ignoreOpeningCheck: boolean;
  ignoreAccountClosingBalance: boolean;
}

function objectData(body: unknown, label: string): Record<string, unknown> {
  const data = (body as { data?: unknown } | null)?.data;
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new AppError(`Malformed ${label} metadata`, 'commit-rejected');
  return data as Record<string, unknown>;
}
function text(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim() === '') throw new AppError(`Missing ${label} metadata`, 'commit-rejected');
  return value;
}
function integer(value: unknown, label: string): number {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 9) throw new AppError(`Invalid ${label} metadata`, 'commit-rejected');
  return parsed;
}
function bool(value: unknown, label: string): boolean {
  if (value === true || value === 1 || value === '1') return true;
  if (value === false || value === 0 || value === '0') return false;
  throw new AppError(`Invalid ${label} metadata`, 'commit-rejected');
}
function date(value: unknown, label: string): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) throw new AppError(`Invalid ${label} metadata`, 'commit-rejected');
  return value;
}

async function getResource(client: ErpClientDeps, doctype: string, name: string, fields: string[]): Promise<Record<string, unknown>> {
  const path = `/api/resource/${encodeURIComponent(doctype)}/${encodeURIComponent(name)}?fields=${encodeURIComponent(JSON.stringify(fields))}`;
  return objectData(await erpnextRequest(client, { method: 'GET', path }), doctype);
}

/** Reads and validates the ERP-owned company/calendar/report settings required by statement source. */
export async function fetchStatementMetadata(client: ErpClientDeps, opts: { company: string }): Promise<StatementMetadata> {
  const company = await getResource(client, 'Company', opts.company, ['name', 'default_currency', 'default_finance_book']);
  const currency = text(company.default_currency, 'Company currency');
  if (currency !== 'IDR') throw new AppError('Financial statements require IDR company currency', 'config-rejected');
  const fiscalPath = `/api/resource/Fiscal%20Year?filters=${encodeURIComponent(JSON.stringify([['disabled', '=', 0]]))}&fields=${encodeURIComponent(JSON.stringify(['name', 'year_start_date', 'year_end_date']))}&limit_page_length=500&order_by=${encodeURIComponent('year_start_date asc, name asc')}`;
  const fiscalBody = await erpnextRequest(client, { method: 'GET', path: fiscalPath });
  const fiscalRows = (fiscalBody as { data?: unknown } | null)?.data;
  if (!Array.isArray(fiscalRows) || fiscalRows.length === 0) throw new AppError('Missing applicable Fiscal Year metadata', 'commit-rejected');
  const calendar = fiscalRows.map((raw) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new AppError('Malformed Fiscal Year metadata', 'commit-rejected');
    const row = raw as Record<string, unknown>;
    const start = date(row.year_start_date, 'Fiscal Year start'); const end = date(row.year_end_date, 'Fiscal Year end');
    if (start > end) throw new AppError('Invalid Fiscal Year date range', 'commit-rejected');
    return { name: text(row.name, 'Fiscal Year name'), start, end };
  });
  for (let i = 1; i < calendar.length; i += 1) if (calendar[i - 1].end >= calendar[i].start) throw new AppError('Overlapping Fiscal Year calendar', 'commit-rejected');
  const [accounts, system, currencyDoc] = await Promise.all([
    getResource(client, 'Accounts Settings', 'Accounts Settings', ['ignore_is_opening_check', 'ignore_account_closing_balance']),
    getResource(client, 'System Settings', 'System Settings', ['currency_precision', 'float_precision', 'rounding_method']),
    getResource(client, 'Currency', currency, ['name', 'smallest_currency_fraction_value']),
  ]);
  // Frappe v16's System Settings defaults: currency_precision=2, float_precision=3,
  // rounding_method=Banker's Rounding. Blank ERPNext fields mean these defaults, not bad metadata.
  // Source: https://github.com/frappe/frappe/blob/version-16/frappe/core/doctype/system_settings/system_settings.json
  const precision = system.currency_precision == null || system.currency_precision === '' ? 2 : integer(system.currency_precision, 'currency precision');
  const floatPrecision = system.float_precision == null || system.float_precision === '' ? 3 : integer(system.float_precision, 'float precision');
  const roundingMethod = system.rounding_method == null || system.rounding_method === '' ? "Banker's Rounding" : text(system.rounding_method, 'rounding method');
  if (!['Banker\'s Rounding', "Banker's Rounding (legacy)", 'Commercial Rounding'].includes(roundingMethod)) throw new AppError('Unsupported rounding method', 'config-rejected');
  const fractionValue = currencyDoc.smallest_currency_fraction_value;
  if (typeof fractionValue !== 'number' && typeof fractionValue !== 'string') throw new AppError('Missing currency precision/cutoff metadata', 'commit-rejected');
  const fractionUnits = Number(fractionValue);
  if (!Number.isFinite(fractionUnits) || fractionUnits <= 0) throw new AppError('Invalid currency precision/cutoff metadata', 'commit-rejected');
  const cutoff = 0.5 / fractionUnits;
  return {
    currency: 'IDR', defaultFinanceBook: typeof company.default_finance_book === 'string' && company.default_finance_book ? company.default_finance_book : null,
    calendar, precision, floatPrecision, roundingMethod: roundingMethod as StatementMetadata['roundingMethod'],
    zeroCutoff: cutoff.toFixed(Math.max(precision + 1, 1)),
    ignoreOpeningCheck: bool(accounts.ignore_is_opening_check, 'ignore opening check'),
    ignoreAccountClosingBalance: bool(accounts.ignore_account_closing_balance, 'ignore account closing balance'),
  };
}

export type StatementRoundingMethod = "Banker's Rounding" | "Banker's Rounding (legacy)" | 'Commercial Rounding';
export interface StatementVersionProfile { erpVersion: string; frappeVersion: string }
export interface StatementPublicationMetadata {
  erpVersion: '16.33.0';
  frappeVersion: '16.31.0';
  currency: 'IDR';
  defaultFinanceBook: string | null;
  hasFinanceBooks: boolean;
  calendar: readonly StatementFiscalYear[];
  currencyPrecision: number;
  floatPrecision: number;
  bsOpeningPrecision: number;
  roundingMethod: StatementRoundingMethod;
  fractionUnits: number;
  ignoreOpeningCheck: boolean;
  ignoreAccountClosingBalance: boolean;
}

type RawStatementValue = string | number | null;
export interface StatementPublicationContext {
  requestLanguage: string;
  currencyPrecisionBranch: 'db_default' | 'number_format';
  floatPrecisionBranch: 'db_default' | 'fallback_3';
  bsOpeningPrecisionBranch: 'db_default' | 'fallback_2';
  numberFormatBranch: 'currency' | 'language' | 'db_default' | 'native_default';
  raw: {
    company: { name: string; currency: string; defaultFinanceBook: RawStatementValue };
    accountsSettings: { ignoreOpeningCheck: RawStatementValue; ignoreAccountClosingBalance: RawStatementValue };
    systemSettings: {
      language: string;
      currencyPrecision: RawStatementValue;
      floatPrecision: RawStatementValue;
      roundingMethod: RawStatementValue;
      useNumberFormatFromCurrency: RawStatementValue;
      numberFormat: RawStatementValue;
    };
    systemDefaults: { currencyPrecision: RawStatementValue; floatPrecision: RawStatementValue; roundingMethod: RawStatementValue; numberFormat: RawStatementValue };
    currency: { fractionUnits: RawStatementValue; numberFormat: RawStatementValue };
    language: { name: string; enabled: RawStatementValue; numberFormat: RawStatementValue };
  };
}

const STRICT_ERP_VERSION = '16.33.0';
const STRICT_FRAPPE_VERSION = '16.31.0';
const STATEMENT_LANGUAGE_RE = /^[A-Za-z]{1,8}(?:[-_][A-Za-z0-9]{1,8})*$/;
const STATEMENT_PAGE_SIZE = 500;
const STATEMENT_MAX_PAGES = 20;
const STATEMENT_NUMBER_FORMATS = new Set([
  '#,###.##', '#.###,##', '# ###.##', '# ###,##', "#'###.##", '#, ###.##', '#,##,###.##', '#,###.###', '#.###', '#,###',
]);
const STATEMENT_FORMAT_PRECISION: Readonly<Record<string, number>> = {
  '#,###.##': 2, '#.###,##': 2, '# ###.##': 2, '# ###,##': 2, "#'###.##": 2,
  '#, ###.##': 2, '#,##,###.##': 2, '#,###.###': 3, '#.###': 0, '#,###': 0,
};
const STATEMENT_ROUNDING_METHODS = new Set<StatementRoundingMethod>([
  "Banker's Rounding", "Banker's Rounding (legacy)", 'Commercial Rounding',
]);

type StrictRecord = Record<string, unknown>;
function strictFailure(message: string, code: 'commit-rejected' | 'config-rejected' = 'commit-rejected'): never {
  throw new AppError(message, code);
}
function isStrictRecord(value: unknown): value is StrictRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function hasOwn(value: StrictRecord, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}
function requiredRaw(record: StrictRecord, key: string, label: string): unknown {
  if (!hasOwn(record, key)) strictFailure(`Missing ${label} metadata`);
  return record[key];
}
function strictText(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim() === '') strictFailure(`Invalid ${label} metadata`);
  return value;
}
function safeLanguageCode(value: unknown): string {
  const language = strictText(value, 'request language');
  if (language.length > 64 || !STATEMENT_LANGUAGE_RE.test(language)) strictFailure('Invalid request language metadata');
  return language;
}
function rawScalar(value: unknown, label: string): RawStatementValue {
  if (value === null) return null;
  if (typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  strictFailure(`Invalid ${label} metadata`);
}
function strictCheck(value: unknown, label: string): boolean {
  if (value === 1 || value === '1') return true;
  if (value === 0 || value === '0') return false;
  strictFailure(`Invalid ${label} metadata`);
}
function strictSelectInteger(value: unknown, label: string, allowed: ReadonlySet<number>): number | null {
  if (value === null || value === '') return null;
  let parsed: number;
  if (typeof value === 'number') parsed = value;
  else if (typeof value === 'string' && /^(0|[1-9][0-9]*)$/.test(value)) parsed = Number(value);
  else strictFailure(`Invalid ${label} metadata`);
  if (!Number.isSafeInteger(parsed) || !allowed.has(parsed)) strictFailure(`Unsupported ${label} metadata`);
  return parsed;
}
function strictSelectFormat(value: unknown, label: string): string | null {
  if (value === null || value === '') return null;
  if (typeof value !== 'string' || !STATEMENT_NUMBER_FORMATS.has(value)) strictFailure(`Unsupported ${label} metadata`);
  return value;
}
function strictRounding(value: unknown): StatementRoundingMethod | null {
  if (value === null || value === '') return null;
  if (typeof value !== 'string' || !STATEMENT_ROUNDING_METHODS.has(value as StatementRoundingMethod)) strictFailure('Unsupported rounding method');
  return value as StatementRoundingMethod;
}
function compareSelectObservation(single: unknown, defaults: unknown, label: string): void {
  const normalizedSingle = single === null || single === '' ? null : single;
  const normalizedDefault = defaults === null || defaults === '' ? null : defaults;
  if (!Object.is(normalizedSingle, normalizedDefault)) strictFailure(`System Settings ${label} differs from its DB default`);
}
function strictObjectEnvelope(body: unknown, label: string): StrictRecord {
  if (!isStrictRecord(body) || !hasOwn(body, 'data') || !isStrictRecord(body.data)) strictFailure(`Malformed ${label} metadata envelope`);
  return body.data;
}
function strictListEnvelope(body: unknown, label: string): unknown[] {
  if (!isStrictRecord(body) || !hasOwn(body, 'data') || !Array.isArray(body.data)) strictFailure(`Malformed ${label} metadata envelope`);
  return body.data;
}
async function strictGetCompanyCollection(client: ErpClientDeps, name: string): Promise<StrictRecord> {
  const fields = ['name', 'default_currency', 'default_finance_book'];
  const filters = [['name', '=', name]];
  const path = `/api/resource/Company?filters=${encodeURIComponent(JSON.stringify(filters))}&fields=${encodeURIComponent(JSON.stringify(fields))}&limit_page_length=2`;
  const rows = strictListEnvelope(await erpnextRequest(client, { method: 'GET', path }), 'Company');
  if (rows.length !== 1 || !isStrictRecord(rows[0])) strictFailure('Expected exactly one Company metadata row');
  if (rows[0].name !== name) strictFailure('Company identity mismatch');
  return projectStrictFields(rows[0], fields, 'Company');
}
function projectStrictFields(record: StrictRecord, fields: readonly string[], label: string): StrictRecord {
  const projected: StrictRecord = {};
  for (const field of fields) projected[field] = requiredRaw(record, field, `${label}.${field}`);
  return projected;
}
async function strictGetResource(
  client: ErpClientDeps, doctype: string, name: string, fields: readonly string[],
): Promise<StrictRecord> {
  const path = `/api/resource/${encodeURIComponent(doctype)}/${encodeURIComponent(name)}?fields=${encodeURIComponent(JSON.stringify(fields))}`;
  return projectStrictFields(strictObjectEnvelope(await erpnextRequest(client, { method: 'GET', path }), doctype), fields, doctype);
}
function strictDate(value: unknown, label: string): string {
  if (typeof value !== 'string') strictFailure(`Invalid ${label} metadata`);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) strictFailure(`Invalid ${label} metadata`);
  const year = Number(match[1]); const month = Number(match[2]); const day = Number(match[3]);
  if (year < 1 || month < 1 || month > 12) strictFailure(`Invalid ${label} metadata`);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (day < 1 || day > days[month - 1]) strictFailure(`Invalid ${label} metadata`);
  return value;
}
function validateRequestBase(baseUrl: string): URL {
  let base: URL;
  try { base = new URL(baseUrl); } catch { return strictFailure('Invalid statement request base URL', 'config-rejected'); }
  if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password) strictFailure('Invalid statement request base URL', 'config-rejected');
  return base;
}
function hasCookieHeader(headers: Headers): boolean {
  return headers.has('cookie');
}

/** A statement-only transport binding. It never discovers trust from the first request and does not mutate deps or global fetch. */
export function statementRequestFetch(fetchImpl: typeof fetch, baseUrl: string, language: string): typeof fetch {
  const base = validateRequestBase(baseUrl);
  const selectedLanguage = safeLanguageCode(language);
  const wrapped = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    let secured: Request;
    try {
      const originalUrl = input instanceof Request ? input.url : String(input);
      let target: URL;
      try { target = new URL(originalUrl, base); } catch { return strictFailure('Invalid statement request URL', 'config-rejected'); }
      if (target.username || target.password || target.origin !== base.origin) strictFailure('Statement request URL is outside its configured origin', 'config-rejected');
      if (target.searchParams.has('_lang')) strictFailure('Statement request language override is not allowed', 'config-rejected');
      const requestHeaders = input instanceof Request ? new Headers(input.headers) : new Headers();
      const initHeaders = new Headers(init?.headers);
      if (hasCookieHeader(requestHeaders) || hasCookieHeader(initHeaders)) strictFailure('Cookie headers are not allowed on statement requests', 'config-rejected');
      initHeaders.forEach((value, key) => requestHeaders.set(key, value));
      const normalized = new Request(input instanceof Request ? input : target.href, { ...init, headers: requestHeaders });
      if (normalized.method.toUpperCase() !== 'GET') strictFailure('Only GET is allowed on statement requests', 'config-rejected');
      if (hasCookieHeader(normalized.headers)) strictFailure('Cookie headers are not allowed on statement requests', 'config-rejected');
      const headers = new Headers(normalized.headers);
      headers.set('Accept-Language', selectedLanguage);
      secured = new Request(normalized, { headers, credentials: 'omit' });
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError('Invalid statement request options', 'config-rejected');
    }
    try {
      return await fetchImpl(secured);
    } catch {
      throw new AppError('ERPNext statement request failed to reach the server', 'external-unreachable');
    }
  }) as typeof fetch;
  return wrapped;
}

function validateVersionProfile(profile: StatementVersionProfile | undefined): void {
  if (!isStrictRecord(profile) || !hasOwn(profile, 'erpVersion') || !hasOwn(profile, 'frappeVersion') || profile.erpVersion !== STRICT_ERP_VERSION || profile.frappeVersion !== STRICT_FRAPPE_VERSION) {
    strictFailure('Statement publication requires the exact verified ERPNext and Frappe version profile', 'config-rejected');
  }
}

async function readFiscalCalendar(client: ErpClientDeps, company: string): Promise<StatementFiscalYear[]> {
  const names: string[] = [];
  const seen = new Set<string>();
  let completed = false;
  for (let page = 0; page < STATEMENT_MAX_PAGES; page += 1) {
    const offset = page * STATEMENT_PAGE_SIZE;
    const filters = [['disabled', '=', 0]];
    const fields = ['name'];
    const path = `/api/resource/Fiscal%20Year?filters=${encodeURIComponent(JSON.stringify(filters))}&fields=${encodeURIComponent(JSON.stringify(fields))}&limit_page_length=${STATEMENT_PAGE_SIZE}&limit_start=${offset}&order_by=${encodeURIComponent('name asc')}`;
    const rows = strictListEnvelope(await erpnextRequest(client, { method: 'GET', path }), 'Fiscal Year');
    if (rows.length > STATEMENT_PAGE_SIZE) strictFailure('Malformed Fiscal Year pagination page');
    for (const raw of rows) {
      if (!isStrictRecord(raw)) strictFailure('Malformed Fiscal Year collection row');
      const name = strictText(requiredRaw(raw, 'name', 'Fiscal Year.name'), 'Fiscal Year name');
      if (seen.has(name)) strictFailure('Duplicate Fiscal Year collection identity');
      seen.add(name);
      names.push(name);
    }
    if (rows.length < STATEMENT_PAGE_SIZE) { completed = true; break; }
  }
  if (!completed) strictFailure('Fiscal Year pagination exceeded its complete-page budget');

  const applicable: StatementFiscalYear[] = [];
  for (const name of names) {
    const doc = await strictGetResource(client, 'Fiscal Year', name, ['name', 'disabled', 'year_start_date', 'year_end_date', 'companies']);
    if (doc.name !== name) strictFailure('Fiscal Year parent identity mismatch');
    if (strictCheck(doc.disabled, `Fiscal Year ${name} disabled`)) strictFailure('Fiscal Year changed while reading metadata');
    const start = strictDate(doc.year_start_date, 'Fiscal Year start');
    const end = strictDate(doc.year_end_date, 'Fiscal Year end');
    if (start > end) strictFailure('Invalid Fiscal Year date range');
    if (!Array.isArray(doc.companies)) strictFailure('Malformed Fiscal Year company children');
    const childCompanies = new Set<string>();
    for (const child of doc.companies) {
      if (!isStrictRecord(child)) strictFailure('Malformed Fiscal Year company child');
      const childCompany = strictText(requiredRaw(child, 'company', 'Fiscal Year company link'), 'Fiscal Year company link');
      if (childCompanies.has(childCompany)) strictFailure('Duplicate Fiscal Year company child');
      childCompanies.add(childCompany);
      if (hasOwn(child, 'doctype') && child.doctype !== 'Fiscal Year Company') strictFailure('Fiscal Year child doctype mismatch');
      if (hasOwn(child, 'parent') && child.parent !== name) strictFailure('Fiscal Year child parent mismatch');
      if (hasOwn(child, 'parenttype') && child.parenttype !== 'Fiscal Year') strictFailure('Fiscal Year child type mismatch');
      if (hasOwn(child, 'parentfield') && child.parentfield !== 'companies') strictFailure('Fiscal Year child field mismatch');
    }
    if (childCompanies.size === 0 || childCompanies.has(company)) applicable.push({ name, start, end });
  }
  if (applicable.length === 0) strictFailure('Missing applicable Fiscal Year metadata');
  applicable.sort((left, right) => left.start < right.start ? -1 : left.start > right.start ? 1 : left.end < right.end ? -1 : left.end > right.end ? 1 : left.name < right.name ? -1 : left.name > right.name ? 1 : 0);
  for (let index = 1; index < applicable.length; index += 1) {
    if (applicable[index - 1].end >= applicable[index].start) strictFailure('Overlapping Fiscal Year calendar');
  }
  return applicable;
}

/** Strict, opt-in metadata/context reader for statement publication. It has no publication side effects. */
export async function fetchStatementPublicationMetadata(
  client: ErpClientDeps,
  opts: { company: string; profile: StatementVersionProfile },
): Promise<{ metadata: StatementPublicationMetadata; context: StatementPublicationContext }> {
  validateVersionProfile(opts?.profile);
  const requestedCompany = strictText(opts?.company, 'requested Company');
  const settingsFields = ['language', 'currency_precision', 'float_precision', 'rounding_method', 'use_number_format_from_currency', 'number_format'];
  const systemRaw = await strictGetResource(client, 'System Settings', 'System Settings', settingsFields);
  const requestLanguage = safeLanguageCode(systemRaw.language);
  const languageRaw = await strictGetResource(client, 'Language', requestLanguage, ['name', 'enabled', 'number_format']);
  if (languageRaw.name !== requestLanguage) strictFailure('Request Language identity mismatch');
  const languageEnabledRaw = requiredRaw(languageRaw, 'enabled', 'Language.enabled');
  if (!strictCheck(languageEnabledRaw, 'Language enabled')) strictFailure('Selected request Language is disabled', 'config-rejected');
  const languageFormatRaw = requiredRaw(languageRaw, 'number_format', 'Language.number_format');
  const languageFormat = strictSelectFormat(languageFormatRaw, 'Language number format');
  const scopedClient: ErpClientDeps = {
    ...client,
    fetchImpl: statementRequestFetch(client.fetchImpl, client.baseUrl, requestLanguage),
  };

  const companyRaw = await strictGetCompanyCollection(scopedClient, requestedCompany);
  if (companyRaw.name !== requestedCompany) strictFailure('Company identity mismatch');
  const companyCurrency = strictText(companyRaw.default_currency, 'Company currency');
  if (companyCurrency !== 'IDR') strictFailure('Statement publication requires IDR Company currency', 'config-rejected');
  const bookRaw = requiredRaw(companyRaw, 'default_finance_book', 'Company.default_finance_book');
  let defaultFinanceBook: string | null;
  if (bookRaw === null || bookRaw === '') defaultFinanceBook = null;
  else defaultFinanceBook = strictText(bookRaw, 'Company default Finance Book');

  const [accountsRaw, settingsLoadBody, currencyRaw, financeBookBody, calendar] = await Promise.all([
    strictGetResource(scopedClient, 'Accounts Settings', 'Accounts Settings', ['name', 'ignore_is_opening_check_for_reporting', 'ignore_account_closing_balance']),
    callMethod(scopedClient, 'frappe.core.doctype.system_settings.system_settings.load'),
    strictGetResource(scopedClient, 'Currency', 'IDR', ['name', 'fraction_units', 'number_format']),
    erpnextRequest(scopedClient, { method: 'GET', path: `/api/resource/Finance%20Book?fields=${encodeURIComponent(JSON.stringify(['name']))}&limit_page_length=1` }),
    readFiscalCalendar(scopedClient, requestedCompany),
  ]);
  if (accountsRaw.name !== 'Accounts Settings') strictFailure('Accounts Settings identity mismatch');
  const openingRaw = requiredRaw(accountsRaw, 'ignore_is_opening_check_for_reporting', 'Accounts Settings.ignore_is_opening_check_for_reporting');
  const closingRaw = requiredRaw(accountsRaw, 'ignore_account_closing_balance', 'Accounts Settings.ignore_account_closing_balance');
  const ignoreOpeningCheck = strictCheck(openingRaw, 'ignore opening check');
  const ignoreAccountClosingBalance = strictCheck(closingRaw, 'ignore account closing balance');

  if (!isStrictRecord(settingsLoadBody) || !isStrictRecord(settingsLoadBody.message) || !isStrictRecord(settingsLoadBody.message.defaults)) strictFailure('Malformed System Settings DB-default envelope');
  const defaultsRaw = projectStrictFields(settingsLoadBody.message.defaults, ['currency_precision', 'float_precision', 'rounding_method', 'number_format'], 'System Settings DB default');
  const singleCurrencyPrecisionRaw = requiredRaw(systemRaw, 'currency_precision', 'System Settings.currency_precision');
  const singleFloatPrecisionRaw = requiredRaw(systemRaw, 'float_precision', 'System Settings.float_precision');
  const singleRoundingRaw = requiredRaw(systemRaw, 'rounding_method', 'System Settings.rounding_method');
  const singleFormatRaw = requiredRaw(systemRaw, 'number_format', 'System Settings.number_format');
  const useCurrencyFormatRaw = requiredRaw(systemRaw, 'use_number_format_from_currency', 'System Settings.use_number_format_from_currency');
  const defaultCurrencyPrecisionRaw = defaultsRaw.currency_precision;
  const defaultFloatPrecisionRaw = defaultsRaw.float_precision;
  const defaultRoundingRaw = defaultsRaw.rounding_method;
  const defaultFormatRaw = defaultsRaw.number_format;
  compareSelectObservation(singleCurrencyPrecisionRaw, defaultCurrencyPrecisionRaw, 'currency_precision');
  compareSelectObservation(singleFloatPrecisionRaw, defaultFloatPrecisionRaw, 'float_precision');
  compareSelectObservation(singleRoundingRaw, defaultRoundingRaw, 'rounding_method');
  compareSelectObservation(singleFormatRaw, defaultFormatRaw, 'number_format');

  const currencyPrecisionRaw = strictSelectInteger(singleCurrencyPrecisionRaw, 'currency precision', new Set([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]));
  const floatPrecisionRaw = strictSelectInteger(singleFloatPrecisionRaw, 'float precision', new Set([0, 2, 3, 4, 5, 6, 7, 8, 9]));
  strictSelectInteger(defaultCurrencyPrecisionRaw, 'DB currency precision', new Set([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]));
  strictSelectInteger(defaultFloatPrecisionRaw, 'DB float precision', new Set([0, 2, 3, 4, 5, 6, 7, 8, 9]));
  const roundingSingle = strictRounding(singleRoundingRaw);
  strictRounding(defaultRoundingRaw);
  strictSelectFormat(singleFormatRaw, 'System Settings number format');
  const dbDefaultNumberFormat = strictSelectFormat(defaultFormatRaw, 'DB-default number format');
  const useCurrencyFormat = strictCheck(useCurrencyFormatRaw, 'use number format from Currency');
  const selectedCurrencyFormatRaw = requiredRaw(currencyRaw, 'number_format', 'Currency.number_format');
  const selectedCurrencyFormat = strictSelectFormat(selectedCurrencyFormatRaw, 'Currency number format');
  if (currencyRaw.name !== 'IDR') strictFailure('Currency identity mismatch');
  const fractionUnitsRaw = requiredRaw(currencyRaw, 'fraction_units', 'Currency.fraction_units');
  let fractionUnits: number;
  if (fractionUnitsRaw === null) fractionUnits = 100;
  else {
    const parsed = typeof fractionUnitsRaw === 'number' ? fractionUnitsRaw : typeof fractionUnitsRaw === 'string' && /^(0|[1-9][0-9]*)$/.test(fractionUnitsRaw) ? Number(fractionUnitsRaw) : Number.NaN;
    if (!Number.isSafeInteger(parsed) || parsed < 0) strictFailure('Invalid Currency fraction units metadata');
    fractionUnits = parsed;
  }

  const currencyPrecisionBranch = currencyPrecisionRaw !== null && currencyPrecisionRaw > 0 ? 'db_default' : 'number_format';
  let selectedNumberFormat: string;
  let numberFormatBranch: StatementPublicationContext['numberFormatBranch'];
  if (useCurrencyFormat && selectedCurrencyFormat) {
    selectedNumberFormat = selectedCurrencyFormat;
    numberFormatBranch = 'currency';
  } else if (languageFormat) {
    selectedNumberFormat = languageFormat;
    numberFormatBranch = 'language';
  } else if (dbDefaultNumberFormat) {
    selectedNumberFormat = dbDefaultNumberFormat;
    numberFormatBranch = 'db_default';
  } else {
    selectedNumberFormat = '#,###.##';
    numberFormatBranch = 'native_default';
  }
  const currencyPrecision = currencyPrecisionBranch === 'db_default'
    ? currencyPrecisionRaw as number
    : STATEMENT_FORMAT_PRECISION[selectedNumberFormat];
  if (!Number.isInteger(currencyPrecision)) strictFailure('Could not resolve Currency precision from native number format');
  const floatPrecisionBranch = floatPrecisionRaw === null || floatPrecisionRaw === 0 ? 'fallback_3' : 'db_default';
  const bsOpeningPrecisionBranch = floatPrecisionRaw === null || floatPrecisionRaw === 0 ? 'fallback_2' : 'db_default';
  const floatPrecision = floatPrecisionBranch === 'fallback_3' ? 3 : floatPrecisionRaw as number;
  const bsOpeningPrecision = bsOpeningPrecisionBranch === 'fallback_2' ? 2 : floatPrecisionRaw as number;
  const roundingMethod: StatementRoundingMethod = roundingSingle ?? "Banker's Rounding (legacy)";

  const financeBookRows = strictListEnvelope(financeBookBody, 'Finance Book');
  if (financeBookRows.length > 1) strictFailure('Malformed Finance Book existence response');
  let hasFinanceBooks = false;
  if (financeBookRows.length === 1) {
    const row = financeBookRows[0];
    if (!isStrictRecord(row)) strictFailure('Malformed Finance Book row');
    strictText(requiredRaw(row, 'name', 'Finance Book.name'), 'Finance Book name');
    hasFinanceBooks = true;
  }

  const metadata: StatementPublicationMetadata = {
    erpVersion: STRICT_ERP_VERSION, frappeVersion: STRICT_FRAPPE_VERSION, currency: 'IDR', defaultFinanceBook, hasFinanceBooks,
    calendar, currencyPrecision, floatPrecision, bsOpeningPrecision, roundingMethod, fractionUnits,
    ignoreOpeningCheck, ignoreAccountClosingBalance,
  };
  const context: StatementPublicationContext = {
    requestLanguage, currencyPrecisionBranch, floatPrecisionBranch, bsOpeningPrecisionBranch, numberFormatBranch,
    raw: {
      company: { name: requestedCompany, currency: companyCurrency, defaultFinanceBook: rawScalar(bookRaw, 'Company default Finance Book') },
      accountsSettings: { ignoreOpeningCheck: rawScalar(openingRaw, 'ignore opening check'), ignoreAccountClosingBalance: rawScalar(closingRaw, 'ignore account closing balance') },
      systemSettings: {
        language: requestLanguage, currencyPrecision: rawScalar(singleCurrencyPrecisionRaw, 'System Settings currency precision'),
        floatPrecision: rawScalar(singleFloatPrecisionRaw, 'System Settings float precision'), roundingMethod: rawScalar(singleRoundingRaw, 'System Settings rounding method'),
        useNumberFormatFromCurrency: rawScalar(useCurrencyFormatRaw, 'System Settings currency format flag'), numberFormat: rawScalar(singleFormatRaw, 'System Settings number format'),
      },
      systemDefaults: {
        currencyPrecision: rawScalar(defaultCurrencyPrecisionRaw, 'DB currency precision'), floatPrecision: rawScalar(defaultFloatPrecisionRaw, 'DB float precision'),
        roundingMethod: rawScalar(defaultRoundingRaw, 'DB rounding method'), numberFormat: rawScalar(defaultFormatRaw, 'DB number format'),
      },
      currency: { fractionUnits: rawScalar(fractionUnitsRaw, 'Currency fraction units'), numberFormat: rawScalar(selectedCurrencyFormatRaw, 'Currency number format') },
      language: { name: requestLanguage, enabled: rawScalar(languageEnabledRaw, 'Language enabled'), numberFormat: rawScalar(languageFormatRaw, 'Language number format') },
    },
  };
  return { metadata, context };
}
