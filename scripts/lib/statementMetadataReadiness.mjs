const INVALID_CONFIGURATION = 'Statement metadata configuration invalid';

const READ_PLAN_FIELDS = Object.freeze({
  Company: Object.freeze(['name', 'default_currency', 'default_finance_book']),
  'Accounts Settings': Object.freeze([
    'name',
    'ignore_is_opening_check_for_reporting',
    'ignore_account_closing_balance',
  ]),
  Currency: Object.freeze(['name', 'fraction_units', 'number_format']),
});

const REPORTING_FLAGS = new Set([0, 1, '0', '1']);
const CURRENCY_NUMBER_FORMATS = new Set([
  '#,###.##', '#.###,##', '# ###.##', '# ###,##', "#'###.##",
  '#, ###.##', '#,##,###.##', '#,###.###', '#.###', '#,###',
]);
const DOCTYPES = Object.freeze(['Company', 'Accounts Settings', 'Currency']);
const REASONS = new Set(['ok', 'authentication', 'permission', 'unavailable', 'malformed', 'transport']);
const FAILURE_SUFFIX = "; Verify the existing integration user's read access and required metadata before enabling statements.";

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function malformed(doctype) {
  return { doctype, ok: false, reason: 'malformed' };
}

function validCompanyDocument(body, company) {
  if (!isRecord(body) || !hasOwn(body, 'data') || !isRecord(body.data)) return false;

  const row = body.data;
  if (!hasOwn(row, 'name') || row.name !== company) return false;
  if (!hasOwn(row, 'default_currency') || row.default_currency !== 'IDR') return false;
  if (!hasOwn(row, 'default_finance_book')) return false;

  const book = row.default_finance_book;
  return book === null || book === '' || (typeof book === 'string' && book.trim() !== '');
}

function validAccountsSettingsDocument(body) {
  if (!isRecord(body) || !hasOwn(body, 'data') || !isRecord(body.data)) return false;

  const row = body.data;
  return hasOwn(row, 'name') && row.name === 'Accounts Settings'
    && hasOwn(row, 'ignore_is_opening_check_for_reporting')
    && REPORTING_FLAGS.has(row.ignore_is_opening_check_for_reporting)
    && hasOwn(row, 'ignore_account_closing_balance')
    && REPORTING_FLAGS.has(row.ignore_account_closing_balance);
}

function parseFractionUnits(value) {
  if (value === null || value === '') return { valid: true, resolved: false };

  let units;
  if (typeof value === 'number') {
    units = value;
  } else if (typeof value === 'string' && /^(?:0|[1-9]\d*)$/.test(value)) {
    units = Number(value);
  } else {
    return { valid: false, resolved: false };
  }

  if (!Number.isSafeInteger(units) || units < 0) return { valid: false, resolved: false };
  return { valid: true, resolved: true, units };
}

function fractionUnitsResolvePrecision(units) {
  if (units === 0 || units === 1) return true;

  let remainder = units;
  let twos = 0;
  let fives = 0;
  while (remainder % 2 === 0) {
    remainder /= 2;
    twos += 1;
  }
  while (remainder % 5 === 0) {
    remainder /= 5;
    fives += 1;
  }
  return remainder === 1 && Math.max(twos, fives) <= 9;
}

function validCurrencyDocument(body) {
  if (!isRecord(body) || !hasOwn(body, 'data') || !isRecord(body.data)) return false;

  const row = body.data;
  if (!hasOwn(row, 'name') || row.name !== 'IDR') return false;
  if (!hasOwn(row, 'fraction_units') || !hasOwn(row, 'number_format')) return false;

  const fraction = parseFractionUnits(row.fraction_units);
  if (!fraction.valid) return false;

  const numberFormat = row.number_format;
  if (numberFormat === null || numberFormat === '') {
    return fraction.resolved && fractionUnitsResolvePrecision(fraction.units);
  }
  return typeof numberFormat === 'string' && CURRENCY_NUMBER_FORMATS.has(numberFormat);
}

/**
 * Build the three fixed ordinary document reads required by statement metadata.
 * @param {unknown} company
 * @returns {{doctype: 'Company'|'Accounts Settings'|'Currency', method: 'GET', path: string}[]}
 */
export function buildStatementMetadataReadPlan(company) {
  if (typeof company !== 'string' || company.trim() === '') {
    throw new TypeError(INVALID_CONFIGURATION);
  }

  const companyPath = `/api/resource/Company/${encodeURIComponent(company)}`;
  return [
    {
      doctype: 'Company',
      method: 'GET',
      path: `${companyPath}?fields=${encodeURIComponent(JSON.stringify(READ_PLAN_FIELDS.Company))}`,
    },
    {
      doctype: 'Accounts Settings',
      method: 'GET',
      path: `/api/resource/Accounts%20Settings/Accounts%20Settings?fields=${encodeURIComponent(JSON.stringify(READ_PLAN_FIELDS['Accounts Settings']))}`,
    },
    {
      doctype: 'Currency',
      method: 'GET',
      path: `/api/resource/Currency/IDR?fields=${encodeURIComponent(JSON.stringify(READ_PLAN_FIELDS.Currency))}`,
    },
  ];
}

/**
 * Classify one metadata document response without retaining any response data.
 * @param {'Company'|'Accounts Settings'|'Currency'} doctype
 * @param {{status: number, body: unknown}} response
 * @param {string} company
 * @returns {{doctype: 'Company'|'Accounts Settings'|'Currency', ok: boolean, reason: 'ok'|'authentication'|'permission'|'unavailable'|'malformed'|'transport'}}
 */
export function classifyStatementMetadataRead(doctype, response, company) {
  if (!Object.hasOwn(READ_PLAN_FIELDS, doctype)) {
    throw new TypeError(INVALID_CONFIGURATION);
  }

  if (!isRecord(response) || !Number.isInteger(response.status) || response.status < 0 || response.status > 599) {
    return malformed(doctype);
  }
  if (response.status === 0) return { doctype, ok: false, reason: 'transport' };
  if (response.status === 401) return { doctype, ok: false, reason: 'authentication' };
  if (response.status === 403) return { doctype, ok: false, reason: 'permission' };
  if (response.status < 200 || response.status >= 300) return { doctype, ok: false, reason: 'unavailable' };

  const valid = doctype === 'Company'
    ? validCompanyDocument(response.body, company)
    : doctype === 'Accounts Settings'
      ? validAccountsSettingsDocument(response.body)
      : validCurrencyDocument(response.body);
  return valid
    ? { doctype, ok: true, reason: 'ok' }
    : malformed(doctype);
}

/**
 * Run each fixed metadata read once, serially, through the supplied ordinary-read transport.
 * @param {{company: unknown, read: (request: {doctype: string, method: 'GET', path: string}) => Promise<{status: number, body: unknown}>}} input
 */
export async function runStatementMetadataReadiness(input) {
  if (!isRecord(input) || typeof input.read !== 'function') {
    throw new TypeError(INVALID_CONFIGURATION);
  }
  const requests = buildStatementMetadataReadPlan(input.company);
  const checks = [];

  for (const request of requests) {
    let check;
    try {
      const response = await input.read(request);
      check = classifyStatementMetadataRead(request.doctype, response, input.company);
    } catch {
      check = { doctype: request.doctype, ok: false, reason: 'transport' };
    }
    checks.push(check);
  }

  const checked = checks.length;
  const passed = checks.reduce((total, check) => total + Number(check.ok), 0);
  const failed = checked - passed;
  return { ok: failed === 0, checked, passed, failed, checks };
}

/**
 * Format the fixed result fields without exposing document values or transport errors.
 * @param {{ok: boolean, checked: number, passed: number, failed: number, checks: object[]}} result
 */
export function formatStatementMetadataReadiness(result) {
  if (!isRecord(result) || !Array.isArray(result.checks) || result.checks.length !== DOCTYPES.length) {
    throw new TypeError(INVALID_CONFIGURATION);
  }

  const checks = result.checks;
  if (checks.some((check, index) => !isRecord(check)
    || check.doctype !== DOCTYPES[index]
    || typeof check.ok !== 'boolean'
    || !REASONS.has(check.reason)
    || (check.ok !== (check.reason === 'ok')))) {
    throw new TypeError(INVALID_CONFIGURATION);
  }

  const checked = checks.length;
  const passed = checks.reduce((total, check) => total + Number(check.ok), 0);
  const failed = checked - passed;
  const prefix = `statement-metadata: checked=${checked} passed=${passed} failed=${failed}`;
  if (failed === 0) return prefix;

  const problems = checks
    .filter((check) => !check.ok)
    .map((check) => `${check.doctype}:${check.reason}`)
    .join(',');
  return `${prefix} problems=${problems}${FAILURE_SUFFIX}`;
}
