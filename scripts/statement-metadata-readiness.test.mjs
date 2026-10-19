import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const COMPANY = 'Synthetic Co';
const COMPANY_ROW = {
  name: COMPANY,
  default_currency: 'IDR',
  default_finance_book: null,
};

let readinessModule;
async function readiness() {
  readinessModule ??= await import('./lib/statementMetadataReadiness.mjs');
  return readinessModule;
}

test('metadata helper imports through its canonical URL without issuing a fetch', async () => {
  const previousFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = () => {
    fetchCalls += 1;
    throw new Error('module import must not fetch');
  };
  try {
    const module = await readiness();
    assert.equal(typeof module.buildStatementMetadataReadPlan, 'function');
    assert.equal(typeof module.runStatementMetadataReadiness, 'function');
    assert.equal(fetchCalls, 0);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

function requestUrl(path) {
  return new URL(path, 'https://example.test');
}

test('AC-001: Company read selects the actual publication fields', async () => {
  const { buildStatementMetadataReadPlan } = await readiness();
  const requests = buildStatementMetadataReadPlan(COMPANY);
  assert.equal(requests.length, 3);
  assert.deepEqual(requests.map(({ doctype, method }) => [doctype, method]), [
    ['Company', 'GET'],
    ['Accounts Settings', 'GET'],
    ['Currency', 'GET'],
  ]);

  const [companyRequest, settingsRequest, currencyRequest] = requests;
  const companyUrl = requestUrl(companyRequest.path);
  assert.equal(companyUrl.pathname, '/api/resource/Company/Synthetic%20Co');
  assert.deepEqual(JSON.parse(companyUrl.searchParams.get('fields')), [
    'name', 'default_currency', 'default_finance_book',
  ]);
  assert.deepEqual([...companyUrl.searchParams.keys()], ['fields']);

  const settingsUrl = requestUrl(settingsRequest.path);
  assert.equal(settingsUrl.pathname, '/api/resource/Accounts%20Settings/Accounts%20Settings');
  assert.deepEqual(JSON.parse(settingsUrl.searchParams.get('fields')), [
    'name', 'ignore_is_opening_check_for_reporting', 'ignore_account_closing_balance',
  ]);
  assert.deepEqual([...settingsUrl.searchParams.keys()], ['fields']);

  const currencyUrl = requestUrl(currencyRequest.path);
  assert.equal(currencyUrl.pathname, '/api/resource/Currency/IDR');
  assert.deepEqual(JSON.parse(currencyUrl.searchParams.get('fields')), [
    'name', 'fraction_units', 'number_format',
  ]);
  assert.deepEqual([...currencyUrl.searchParams.keys()], ['fields']);

  const unusualCompany = requestUrl(buildStatementMetadataReadPlan('A & B/Co')[0].path);
  assert.equal(unusualCompany.pathname, '/api/resource/Company/A%20%26%20B%2FCo');
  assert.deepEqual([...unusualCompany.searchParams.keys()], ['fields']);

  for (const invalid of ['', '  ', null, 1]) {
    assert.throws(
      () => buildStatementMetadataReadPlan(invalid),
      { name: 'TypeError', message: 'Statement metadata configuration invalid' },
    );
  }
});

test('AC-001: Company requires the matching complete document', async () => {
  const { classifyStatementMetadataRead } = await readiness();
  assert.deepEqual(
    classifyStatementMetadataRead('Company', { status: 200, body: { data: COMPANY_ROW } }, COMPANY),
    { doctype: 'Company', ok: true, reason: 'ok' },
  );

  for (const book of ['', 'Accrual']) {
    assert.deepEqual(
      classifyStatementMetadataRead('Company', {
        status: 200,
        body: { data: { ...COMPANY_ROW, default_finance_book: book } },
      }, COMPANY),
      { doctype: 'Company', ok: true, reason: 'ok' },
    );
  }

  const invalidResponses = [
    { status: 200, body: { data: [] } },
    { status: 200, body: { data: [COMPANY_ROW] } },
    { status: 200, body: { data: {} } },
    { status: 200, body: { data: null } },
    { status: 200, body: { data: { name: COMPANY } } },
    { status: 200, body: { data: { ...COMPANY_ROW, name: 'Other Co' } } },
    { status: 200, body: { data: { name: COMPANY, default_currency: 'IDR' } } },
    { status: 200, body: { data: { ...COMPANY_ROW, default_currency: 'USD' } } },
    { status: 200, body: { data: { name: COMPANY, default_currency: 'IDR' } } },
    { status: 200, body: { data: { ...COMPANY_ROW, default_finance_book: 0 } } },
    { status: 200, body: { data: { ...COMPANY_ROW, default_finance_book: '   ' } } },
  ];

  for (const response of invalidResponses) {
    assert.deepEqual(
      classifyStatementMetadataRead('Company', response, COMPANY),
      { doctype: 'Company', ok: false, reason: 'malformed' },
    );
  }

  const withExtraFields = classifyStatementMetadataRead('Company', {
    status: 200,
    body: {
      data: { ...COMPANY_ROW, unrelated: 'accepted row extra' },
      unrelated: 'accepted envelope extra',
    },
  }, COMPANY);
  assert.deepEqual(withExtraFields, { doctype: 'Company', ok: true, reason: 'ok' });
});

function settingsResponse(overrides = {}) {
  return {
    status: 200,
    body: {
      data: {
        name: 'Accounts Settings',
        ignore_is_opening_check_for_reporting: 0,
        ignore_account_closing_balance: '1',
        ...overrides,
      },
    },
  };
}

function currencyResponse(overrides = {}) {
  return {
    status: 200,
    body: {
      data: {
        name: 'IDR',
        fraction_units: 100,
        number_format: '',
        ...overrides,
      },
    },
  };
}

test('AC-002: reporting flags preserve zero and reject missing values', async () => {
  const { classifyStatementMetadataRead } = await readiness();
  assert.deepEqual(
    classifyStatementMetadataRead('Accounts Settings', settingsResponse(), COMPANY),
    { doctype: 'Accounts Settings', ok: true, reason: 'ok' },
  );

  for (const first of [0, 1, '0', '1']) {
    for (const second of [0, 1, '0', '1']) {
      assert.deepEqual(
        classifyStatementMetadataRead('Accounts Settings', settingsResponse({
          ignore_is_opening_check_for_reporting: first,
          ignore_account_closing_balance: second,
        }), COMPANY),
        { doctype: 'Accounts Settings', ok: true, reason: 'ok' },
      );
    }
  }

  for (const field of ['ignore_is_opening_check_for_reporting', 'ignore_account_closing_balance']) {
    for (const invalid of [undefined, null, '', true, false, 2]) {
      const row = {
        name: 'Accounts Settings',
        ignore_is_opening_check_for_reporting: 0,
        ignore_account_closing_balance: '1',
      };
      if (invalid === undefined) delete row[field];
      else row[field] = invalid;
      assert.deepEqual(
        classifyStatementMetadataRead('Accounts Settings', { status: 200, body: { data: row } }, COMPANY),
        { doctype: 'Accounts Settings', ok: false, reason: 'malformed' },
      );
    }
  }

  for (const response of [
    { status: 200, body: { data: { ...settingsResponse().body.data, name: 'Other Settings' } } },
    { status: 200, body: { data: [] } },
    { status: 200, body: { data: null } },
    { status: 200, body: {} },
  ]) {
    assert.deepEqual(
      classifyStatementMetadataRead('Accounts Settings', response, COMPANY),
      { doctype: 'Accounts Settings', ok: false, reason: 'malformed' },
    );
  }
});

test('AC-003: Currency validates presentation metadata branches', async () => {
  const { classifyStatementMetadataRead } = await readiness();
  assert.deepEqual(
    classifyStatementMetadataRead('Currency', currencyResponse(), COMPANY),
    { doctype: 'Currency', ok: true, reason: 'ok' },
  );

  const supportedFormats = [
    '#,###.##', '#.###,##', '# ###.##', '# ###,##', "#'###.##",
    '#, ###.##', '#,##,###.##', '#,###.###', '#.###', '#,###',
  ];
  for (const numberFormat of supportedFormats) {
    for (const fractionUnits of [null, '']) {
      assert.deepEqual(
        classifyStatementMetadataRead('Currency', currencyResponse({ fraction_units: fractionUnits, number_format: numberFormat }), COMPANY),
        { doctype: 'Currency', ok: true, reason: 'ok' },
      );
    }
    assert.deepEqual(
      classifyStatementMetadataRead('Currency', currencyResponse({ fraction_units: 3, number_format: numberFormat }), COMPANY),
      { doctype: 'Currency', ok: true, reason: 'ok' },
    );
  }

  for (const fractionUnits of [0, 1, 2, 5, 100, 1000, '100', 1_000_000_000]) {
    assert.deepEqual(
      classifyStatementMetadataRead('Currency', currencyResponse({ fraction_units: fractionUnits, number_format: '' }), COMPANY),
      { doctype: 'Currency', ok: true, reason: 'ok' },
    );
  }

  for (const fractionUnits of [null, '']) {
    for (const numberFormat of [null, '']) {
      assert.deepEqual(
        classifyStatementMetadataRead('Currency', currencyResponse({ fraction_units: fractionUnits, number_format: numberFormat }), COMPANY),
        { doctype: 'Currency', ok: false, reason: 'malformed' },
      );
    }
  }

  for (const overrides of [
    { fraction_units: undefined },
    { number_format: undefined },
    { number_format: 'unsupported' },
    { fraction_units: true },
    { fraction_units: false },
    { fraction_units: -1 },
    { fraction_units: 1.5 },
    { fraction_units: Number.MAX_SAFE_INTEGER + 1 },
    { fraction_units: '01' },
    { fraction_units: '1e2' },
    { fraction_units: ' 100' },
    { fraction_units: 3 },
    { fraction_units: 10_000_000_000 },
    { name: 'USD' },
  ]) {
    const row = { ...currencyResponse().body.data, ...overrides };
    if (Object.hasOwn(overrides, 'fraction_units') && overrides.fraction_units === undefined) delete row.fraction_units;
    if (Object.hasOwn(overrides, 'number_format') && overrides.number_format === undefined) delete row.number_format;
    assert.deepEqual(
      classifyStatementMetadataRead('Currency', { status: 200, body: { data: row } }, COMPANY),
      { doctype: 'Currency', ok: false, reason: 'malformed' },
    );
  }

  for (const [fractionUnits, numberFormat] of [
    [true, '#,###.##'],
    ['01', '#,###.##'],
    [3, ''],
  ]) {
    assert.deepEqual(
      classifyStatementMetadataRead(
        'Currency',
        { status: 200, body: { data: { ...currencyResponse().body.data, fraction_units: fractionUnits, number_format: numberFormat } } },
        COMPANY,
      ),
      { doctype: 'Currency', ok: false, reason: 'malformed' },
    );
  }
  assert.deepEqual(
    classifyStatementMetadataRead('Currency', currencyResponse({ fraction_units: 3, number_format: '#,###.##' }), COMPANY),
    { doctype: 'Currency', ok: true, reason: 'ok' },
  );

  const validExtraFields = classifyStatementMetadataRead('Currency', {
    status: 200,
    body: { data: { ...currencyResponse().body.data, unrelated: 'accepted extra' } },
  }, COMPANY);
  assert.deepEqual(validExtraFields, { doctype: 'Currency', ok: true, reason: 'ok' });
});

function validBody(doctype, company = COMPANY, extra = {}) {
  if (doctype === 'Company') {
    return { data: { name: company, default_currency: 'IDR', default_finance_book: null, ...extra } };
  }
  if (doctype === 'Accounts Settings') {
    return {
      data: {
        name: 'Accounts Settings',
        ignore_is_opening_check_for_reporting: 0,
        ignore_account_closing_balance: '1',
        ...extra,
      },
    };
  }
  return { data: { name: 'IDR', fraction_units: 100, number_format: '', ...extra } };
}

function baselineRead(doctype, company = COMPANY, extra = {}) {
  return { status: 200, body: validBody(doctype, company, extra) };
}

function planResponses(company = COMPANY, extras = {}) {
  return new Map([
    ['Company', baselineRead('Company', company, extras.Company)],
    ['Accounts Settings', baselineRead('Accounts Settings', company, extras['Accounts Settings'])],
    ['Currency', baselineRead('Currency', company, extras.Currency)],
  ]);
}

function doctypeFor(request) {
  return request.path.startsWith('/api/resource/Company/')
    ? 'Company'
    : request.path.startsWith('/api/resource/Accounts%20Settings/')
      ? 'Accounts Settings'
      : 'Currency';
}

test('AC-006: complete metadata uses exactly three serial GETs', async () => {
  const { buildStatementMetadataReadPlan, formatStatementMetadataReadiness, runStatementMetadataReadiness } = await readiness();
  for (const book of [null, '']) {
    const calls = [];
    let active = 0;
    let maxActive = 0;
    const responses = planResponses(COMPANY, {
      Company: { default_finance_book: book, privateValue: 'synthetic-extra-value' },
      'Accounts Settings': { unrelated: 'synthetic-extra-value' },
      Currency: { unrelated: 'synthetic-extra-value' },
    });

    const result = await runStatementMetadataReadiness({
      company: COMPANY,
      read: async (request) => {
        calls.push(request);
        active += 1;
        maxActive = Math.max(maxActive, active);
        await Promise.resolve();
        active -= 1;
        return responses.get(doctypeFor(request));
      },
    });

    assert.equal(maxActive, 1);
    assert.deepEqual(calls, buildStatementMetadataReadPlan(COMPANY));
    assert.equal(calls.every(({ method }) => method === 'GET'), true);
    assert.deepEqual(result, {
      ok: true,
      checked: 3,
      passed: 3,
      failed: 0,
      checks: ['Company', 'Accounts Settings', 'Currency'].map((doctype) => ({
        doctype,
        ok: true,
        reason: 'ok',
      })),
    });
    assert.equal(formatStatementMetadataReadiness(result), 'statement-metadata: checked=3 passed=3 failed=0');
  }
});

test('AC-004: each required doctype refuses authentication and permission failures', async () => {
  const { runStatementMetadataReadiness } = await readiness();
  for (const doctype of ['Company', 'Accounts Settings', 'Currency']) {
    for (const [status, reason] of [[401, 'authentication'], [403, 'permission']]) {
      const calls = [];
      const responses = planResponses();
      responses.set(doctype, { status, body: { detail: 'synthetic-private-detail' } });
      const result = await runStatementMetadataReadiness({
        company: COMPANY,
        read: async (request) => {
          calls.push(request);
          return responses.get(doctypeFor(request));
        },
      });

      assert.equal(calls.length, 3);
      assert.equal(result.ok, false);
      assert.equal(result.passed, 2);
      assert.equal(result.failed, 1);
      assert.deepEqual(result.checks.find((check) => check.doctype === doctype), {
        doctype, ok: false, reason,
      });
    }
  }

  const identityOnly = await runStatementMetadataReadiness({
    company: COMPANY,
    read: async (request) => doctypeFor(request) === 'Company'
      ? { status: 200, body: { data: { name: COMPANY } } }
      : baselineRead(doctypeFor(request)),
  });
  assert.deepEqual(identityOnly.checks[0], { doctype: 'Company', ok: false, reason: 'malformed' });
});

test('AC-005: unsuccessful and malformed dependencies fail without leaking errors', async () => {
  const { runStatementMetadataReadiness } = await readiness();
  for (const doctype of ['Company', 'Accounts Settings', 'Currency']) {
    const cases = [
      [{ status: 404, body: null }, 'unavailable'],
      [{ status: 500, body: null }, 'unavailable'],
      [{ status: 200, body: null }, 'malformed'],
      [{ status: 200, body: 'not parsed JSON' }, 'malformed'],
      [new Error('synthetic-private-detail'), 'transport'],
      [{ status: 0, body: null }, 'transport'],
      [{ status: '200', body: null }, 'malformed'],
    ];
    for (const [failure, reason] of cases) {
      const calls = [];
      const result = await runStatementMetadataReadiness({
        company: COMPANY,
        read: async (request) => {
          calls.push(request);
          if (doctypeFor(request) !== doctype) return baselineRead(doctypeFor(request));
          if (failure instanceof Error) throw failure;
          return failure;
        },
      });

      assert.equal(calls.length, 3);
      assert.deepEqual(result.checks.find((check) => check.doctype === doctype), {
        doctype, ok: false, reason,
      });
    }
  }
});

test('AC-007: summary contains only fixed labels counts and setup action', async () => {
  const { formatStatementMetadataReadiness, runStatementMetadataReadiness } = await readiness();
  const result = await runStatementMetadataReadiness({
    company: COMPANY,
    read: async (request) => {
      const doctype = doctypeFor(request);
      if (doctype === 'Company') return { status: 403, body: { privateValue: 'synthetic-private-detail' } };
      if (doctype === 'Accounts Settings') throw new Error('synthetic-private-detail');
      return baselineRead(doctype, COMPANY, { privateValue: 'synthetic-private-detail' });
    },
  });

  const summary = formatStatementMetadataReadiness(result);
  assert.equal(summary,
    "statement-metadata: checked=3 passed=1 failed=2 problems=Company:permission,Accounts Settings:transport; Verify the existing integration user's read access and required metadata before enabling statements.");
  assert.equal(JSON.stringify(result).includes('synthetic-private-detail'), false);
  assert.equal(summary.includes('synthetic-private-detail'), false);
  assert.equal(summary.includes(COMPANY), false);
  assert.equal(summary.includes('https://'), false);

  const oneFailure = await runStatementMetadataReadiness({
    company: COMPANY,
    read: async (request) => doctypeFor(request) === 'Company'
      ? { status: 403, body: null }
      : baselineRead(doctypeFor(request)),
  });
  assert.equal(formatStatementMetadataReadiness(oneFailure),
    "statement-metadata: checked=3 passed=2 failed=1 problems=Company:permission; Verify the existing integration user's read access and required metadata before enabling statements.");

  let readCalls = 0;
  await assert.rejects(
    runStatementMetadataReadiness({ company: '  ', read: async () => { readCalls += 1; return null; } }),
    { name: 'TypeError', message: 'Statement metadata configuration invalid' },
  );
  assert.equal(readCalls, 0);

});

test('metadata helper rejects invalid request, doctype, and formatter contracts', async () => {
  const { classifyStatementMetadataRead, formatStatementMetadataReadiness, runStatementMetadataReadiness } = await readiness();
  assert.throws(
    () => classifyStatementMetadataRead('Unlisted Doctype', { status: 200, body: {} }, COMPANY),
    { name: 'TypeError', message: 'Statement metadata configuration invalid' },
  );
  for (const input of [null, {}, { company: COMPANY, read: {} }]) {
    await assert.rejects(
      runStatementMetadataReadiness(input),
      { name: 'TypeError', message: 'Statement metadata configuration invalid' },
    );
  }
  for (const invalid of [null, {}, { checks: [] }]) {
    assert.throws(
      () => formatStatementMetadataReadiness(invalid),
      { name: 'TypeError', message: 'Statement metadata configuration invalid' },
    );
  }

  const validChecks = [
    { doctype: 'Company', ok: true, reason: 'ok' },
    { doctype: 'Accounts Settings', ok: false, reason: 'permission' },
    { doctype: 'Currency', ok: true, reason: 'ok' },
  ];
  for (const checks of [
    [validChecks[1], validChecks[0], validChecks[2]],
    [validChecks[0], { ...validChecks[1], reason: 'private' }, validChecks[2]],
    [validChecks[0], { ...validChecks[1], ok: true }, validChecks[2]],
    [validChecks[0], null, validChecks[2]],
  ]) {
    assert.throws(
      () => formatStatementMetadataReadiness({ checks }),
      { name: 'TypeError', message: 'Statement metadata configuration invalid' },
    );
  }
});

function normalizedHeading(line) {
  const match = line.match(/^\s*#{1,6}\s+(.+?)\s*#*\s*$/);
  return match?.[1].replace(/\s+/g, ' ').replace(/[–—]/g, '-').trim().toLowerCase() ?? null;
}

function statementSetupSection(markdown) {
  const lines = markdown.split(/\r?\n/);
  const start = lines.findIndex((line) => normalizedHeading(line) === 'erpnext integration api-user setup - statement metadata');
  if (start < 0) return { text: '', without: markdown };

  const end = lines.findIndex((line, index) => index > start
    && normalizedHeading(line) === 'erpnext v15 dev bed (p2)');
  const stop = end < 0 ? lines.length : end;
  return {
    text: lines.slice(start + 1, stop).join('\n'),
    without: [...lines.slice(0, start), ...lines.slice(stop)].join('\n'),
  };
}

function assertStatementSetupRequirements(section) {
  const normalized = section.replace(/[`*]/g, '').replace(/\s+/g, ' ').toLowerCase();
  for (const required of [
    'integration api user',
    'company', 'accounts settings', 'currency', 'read',
    'default_currency', 'default_finance_book',
    'ignore_is_opening_check_for_reporting', 'ignore_account_closing_balance',
    'fraction_units', 'number_format',
    'before statements go live', 'rerun',
  ]) {
    assert.ok(normalized.includes(required), `setup section must include ${required}`);
  }
}

test('AC-008: API-user setup documents the three consumed metadata reads', async () => {
  const environments = await readFile(new URL('../docs/environments.md', import.meta.url), 'utf8');
  const section = statementSetupSection(environments);
  assertStatementSetupRequirements(section.text);

  // The setup subsection predates this test in the current checkout. Verify the test's
  // negative control by removing that exact section from a synthetic document value.
  assert.throws(
    () => assertStatementSetupRequirements(statementSetupSection(section.without).text),
    /setup section must include/,
  );
});
