import { erpnextRequest } from './client.ts';
import type { ErpClientDeps } from './client.ts';
import { AppError } from '../../appError.ts';

export interface StatementFiscalYear { name: string; start: string; end: string }
export type StatementRoundingMethod = "Banker's Rounding" | "Banker's Rounding (legacy)" | 'Commercial Rounding' | 'erpnext_report_output';
export interface StatementVersionProfile { erpVersion: string; frappeVersion: string }
export interface StatementPublicationMetadata {
  erpVersion: '16.33.0';
  frappeVersion: '16.31.0';
  currency: 'IDR';
  defaultFinanceBook: string | null;
  hasFinanceBooks: boolean;
  calendar: readonly StatementFiscalYear[];
  currencyPrecision: number;
  roundingMethod: StatementRoundingMethod;
  fractionUnits: number | null;
  ignoreOpeningCheck: boolean;
  ignoreAccountClosingBalance: boolean;
}

type RawStatementValue = string | number | null;
export interface StatementPublicationContext {
  requestLanguage: string;
  currencyPrecisionBranch: 'currency_number_format' | 'currency_fraction_units';
  raw: {
    company: { name: string; currency: string; defaultFinanceBook: RawStatementValue };
    accountsSettings: { ignoreOpeningCheck: RawStatementValue; ignoreAccountClosingBalance: RawStatementValue };
    currency: { fractionUnits: RawStatementValue; numberFormat: RawStatementValue };
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
const STATEMENT_REQUEST_LANGUAGE = 'en';

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
function strictSelectFormat(value: unknown, label: string): string | null {
  if (value === null || value === '') return null;
  if (typeof value !== 'string' || !STATEMENT_NUMBER_FORMATS.has(value)) strictFailure(`Unsupported ${label} metadata`);
  return value;
}
function strictCurrencyFractionUnits(value: unknown): number | null {
  if (value === null || value === '') return null;
  const parsed = typeof value === 'number' ? value : typeof value === 'string' && /^(0|[1-9][0-9]*)$/.test(value) ? Number(value) : Number.NaN;
  if (!Number.isSafeInteger(parsed) || parsed < 0) strictFailure('Invalid Currency fraction units metadata');
  return parsed;
}
function currencyFractionPrecision(fractionUnits: number | null): number {
  if (fractionUnits === null) strictFailure('Missing Currency presentation precision');
  if (fractionUnits === 0 || fractionUnits === 1) return 0;
  let remaining = fractionUnits;
  let powersOfTwo = 0;
  let powersOfFive = 0;
  while (remaining % 2 === 0) { remaining /= 2; powersOfTwo += 1; }
  while (remaining % 5 === 0) { remaining /= 5; powersOfFive += 1; }
  const precision = Math.max(powersOfTwo, powersOfFive);
  if (remaining !== 1 || precision > 9) strictFailure('Could not resolve Currency precision from fraction units');
  return precision;
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
  const requestLanguage = STATEMENT_REQUEST_LANGUAGE;
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

  // This metadata pass shares the sweep's one-core ERP budget with native report requests.
  // Keep its HTTP calls serial so the report producer never fans out ERP work.
  const accountsRaw = await strictGetResource(scopedClient, 'Accounts Settings', 'Accounts Settings', [
    'name', 'ignore_is_opening_check_for_reporting', 'ignore_account_closing_balance',
  ]);
  const currencyRaw = await strictGetResource(scopedClient, 'Currency', 'IDR', [
    'name', 'fraction_units', 'number_format',
  ]);
  const financeBookBody = await erpnextRequest(scopedClient, {
    method: 'GET',
    path: `/api/resource/Finance%20Book?fields=${encodeURIComponent(JSON.stringify(['name']))}&limit_page_length=1`,
  });
  const calendar = await readFiscalCalendar(scopedClient, requestedCompany);
  if (accountsRaw.name !== 'Accounts Settings') strictFailure('Accounts Settings identity mismatch');
  const openingRaw = requiredRaw(accountsRaw, 'ignore_is_opening_check_for_reporting', 'Accounts Settings.ignore_is_opening_check_for_reporting');
  const closingRaw = requiredRaw(accountsRaw, 'ignore_account_closing_balance', 'Accounts Settings.ignore_account_closing_balance');
  const ignoreOpeningCheck = strictCheck(openingRaw, 'ignore opening check');
  const ignoreAccountClosingBalance = strictCheck(closingRaw, 'ignore account closing balance');
  if (currencyRaw.name !== 'IDR') strictFailure('Currency identity mismatch');
  const fractionUnitsRaw = requiredRaw(currencyRaw, 'fraction_units', 'Currency.fraction_units');
  const fractionUnits = strictCurrencyFractionUnits(fractionUnitsRaw);
  const currencyNumberFormatRaw = requiredRaw(currencyRaw, 'number_format', 'Currency.number_format');
  const currencyNumberFormat = strictSelectFormat(currencyNumberFormatRaw, 'Currency number format');
  const currencyPrecisionBranch: StatementPublicationContext['currencyPrecisionBranch'] = currencyNumberFormat
    ? 'currency_number_format'
    : 'currency_fraction_units';
  const currencyPrecision = currencyNumberFormat
    ? STATEMENT_FORMAT_PRECISION[currencyNumberFormat]
    : currencyFractionPrecision(fractionUnits);
  if (!Number.isInteger(currencyPrecision) || currencyPrecision < 0 || currencyPrecision > 9) strictFailure('Could not resolve Currency presentation precision');
  const roundingMethod: StatementRoundingMethod = 'erpnext_report_output';

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
    calendar, currencyPrecision, roundingMethod, fractionUnits,
    ignoreOpeningCheck, ignoreAccountClosingBalance,
  };
  const context: StatementPublicationContext = {
    requestLanguage, currencyPrecisionBranch,
    raw: {
      company: { name: requestedCompany, currency: companyCurrency, defaultFinanceBook: rawScalar(bookRaw, 'Company default Finance Book') },
      accountsSettings: { ignoreOpeningCheck: rawScalar(openingRaw, 'ignore opening check'), ignoreAccountClosingBalance: rawScalar(closingRaw, 'ignore account closing balance') },
      currency: { fractionUnits: rawScalar(fractionUnitsRaw, 'Currency fraction units'), numberFormat: rawScalar(currencyNumberFormatRaw, 'Currency number format') },
    },
  };
  return { metadata, context };
}
