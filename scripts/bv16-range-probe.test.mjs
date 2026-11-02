import test from 'node:test';
import assert from 'node:assert/strict';
import { runRangeProbe } from './bv16-rehearsal.mjs';

const config = () => ({
  localApi: 'http://127.0.0.1:54321',
  localServiceKey: 'local-service-key',
  localAnonKey: 'local-anon-key',
  firstActorJwt: 'first-actor-jwt',
  secondActorJwt: 'second-actor-jwt',
  rehearsalOrigin: 'https://v16-rehearsal.example.test',
  rehearsalSite: 'isolated-v16-copy',
  erpAuthorization: 'token local-fixture:local-fixture-secret',
  company: 'Example Co',
  salaryAccount: 'Salary - EX',
  cogsAccount: 'COGS - EX',
  fiscalYear: '2026',
  startDate: '2026-01-01',
  endDate: '2026-12-31',
  rangeFiscalYears: ['FY-A', 'FY-B', 'FY-C'],
});

const FISCAL_YEARS = [
  { name: 'FY-A', year_start_date: '2026-01-01', year_end_date: '2026-12-31' },
  { name: 'FY-B', year_start_date: '2027-01-01', year_end_date: '2027-12-31' },
  { name: 'FY-C', year_start_date: '2028-01-01', year_end_date: '2028-12-31' },
];

function response(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function createBench({ wrongReadback = false, versionMajor = 16 } = {}) {
  const calls = [];
  const projects = new Set();
  const budgets = new Map();
  let sequence = 0;
  const years = new Map(FISCAL_YEARS.map((row) => [row.name, row]));

  const fetch = async (input, init = {}) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const path = decodeURIComponent(url.pathname);
    const method = String(init.method ?? 'GET').toUpperCase();
    const body = init.body ? JSON.parse(init.body) : {};
    calls.push({ url, method, body, redirect: init.redirect });

    if (path === '/api/resource/Project' && method === 'POST') {
      const name = `PROJ-${++sequence}`;
      projects.add(name);
      return response({ data: { name } });
    }
    if (path === '/api/method/frappe.utils.change_log.get_versions' && method === 'GET') {
      return response({ message: { frappe: `${versionMajor}.0.0`, erpnext: `${versionMajor}.33.0` } });
    }
    if (path === '/api/resource/Fiscal Year' && method === 'GET') {
      return response({ data: FISCAL_YEARS });
    }
    if (path === '/api/resource/Budget' && method === 'GET') {
      const filters = JSON.parse(url.searchParams.get('filters') ?? '[]');
      const project = filters[0]?.[2];
      return response({ data: [...budgets.values()].filter((row) => row.project === project).map(({ name, project: owner, docstatus }) => ({ name, project: owner, docstatus })) });
    }
    if (path === '/api/resource/Budget' && method === 'POST') {
      if (!projects.has(body.project)) return response({ exc_type: 'InvalidProject' }, 417);
      const start = years.get(body.from_fiscal_year)?.year_start_date;
      const end = years.get(body.to_fiscal_year)?.year_end_date;
      const overlap = [...budgets.values()].some((existing) => existing.docstatus < 2
        && existing.company === body.company
        && existing.project === body.project
        && existing.account === body.account
        && years.get(existing.from_fiscal_year).year_start_date <= end
        && years.get(existing.to_fiscal_year).year_end_date >= start);
      if (overlap) return response({ exc_type: 'erpnext.accounts.doctype.budget.budget.DuplicateBudgetError' }, 417);
      const name = `BUD-${++sequence}`;
      const selectedYears = FISCAL_YEARS.filter((year) => year.name >= body.from_fiscal_year && year.name <= body.to_fiscal_year);
      const doc = {
        ...body,
        name,
        docstatus: 0,
        budget_start_date: start,
        budget_end_date: end,
        // The v16 new-document allocation path regenerates rows; the rehearsal must write manual
        // annual rows onto the draft before submit to test zero-year retention.
        budget_distribution: selectedYears.map((year) => ({
          start_date: year.year_start_date,
          end_date: year.year_end_date,
          amount: Number(body.budget_amount) / selectedYears.length,
          percent: 100 / selectedYears.length,
        })),
      };
      budgets.set(name, doc);
      return response({ data: { name } });
    }
    if (path.startsWith('/api/resource/Budget/')) {
      const name = path.slice('/api/resource/Budget/'.length);
      const doc = budgets.get(name);
      if (!doc) return response({ exc_type: 'DoesNotExistError' }, 404);
      if (method === 'GET') {
        const result = structuredClone(doc);
        result.budget_distribution = result.budget_distribution.map((row) => ({ ...row, amount: String(row.amount), percent: String(row.percent) }));
        if (wrongReadback && doc.docstatus === 1 && name === 'BUD-2' && result.budget_distribution?.[1]) result.budget_distribution[1].amount = '1';
        return response({ data: result });
      }
      if (method === 'PUT' && body.docstatus === 2) {
        doc.docstatus = 2;
        return response({ data: doc });
      }
      if (method === 'PUT' && Array.isArray(body.budget_distribution)) {
        doc.budget_distribution = body.budget_distribution;
        doc.budget_distribution_total = body.budget_distribution.reduce((sum, row) => sum + Number(row.amount), 0);
        return response({ data: doc });
      }
      if (method === 'PUT' && typeof body.budget_amount === 'number') {
        doc.budget_amount = body.budget_amount;
        doc.budget_distribution = doc.budget_distribution.map((row) => ({ ...row, amount: Number(((row.percent / 100) * body.budget_amount).toFixed(3)) }));
        doc.budget_distribution_total = doc.budget_distribution.reduce((sum, row) => sum + row.amount, 0);
        return response({ data: doc });
      }
      if (method === 'DELETE' && doc.docstatus === 0) {
        budgets.delete(name);
        return response({ data: { name } });
      }
    }
    if (path === '/api/method/frappe.client.submit' && method === 'POST') {
      const doc = budgets.get(body.doc?.name);
      if (!doc || body.doc?.doctype !== 'Budget' || doc.docstatus !== 0) return response({ exc_type: 'InvalidSubmit' }, 417);
      doc.docstatus = 1;
      return response({ message: doc });
    }
    return response({ exc_type: 'NotFound' }, 404);
  };

  return { calls, budgets, fetch };
}

test('budget-whole-project Slice 1 real-route rehearsal reads back yearly rows, probes overlap both ways, then cancels run-owned documents', async () => {
  const bench = createBench();
  const stdout = [];
  const stderr = [];
  const result = await runRangeProbe(config(), {
    explicitOptIn: true,
    fetchImpl: bench.fetch,
    stdout: (value) => stdout.push(value),
    stderr: (value) => stderr.push(value),
    newId: () => '11111111-1111-4111-8111-111111111111',
  });

  assert.equal(result.exitCode, 0, stderr.join(''));
  assert.match(stdout.join(''), /^ERPNext v16 range probe: PASS\n\{.*\}\n$/);
  const evidence = JSON.parse(stdout.join('').split('\n')[1]);
  assert.deepEqual(evidence, { rangeYears: 3, yearlyRows: 3, zeroYearRetained: true, percentRecalculation: true, overlapRejections: 2, cancelledBudgets: 2 });
  assert.ok([...bench.budgets.values()].every((doc) => doc.docstatus === 2));
  assert.equal(bench.budgets.get('BUD-2').budget_amount, 400);
  assert.deepEqual(bench.budgets.get('BUD-2').budget_distribution.map((row) => row.amount), [100, 0, 300]);
  assert.equal(bench.calls.filter((call) => call.url.pathname === '/api/method/frappe.client.submit').length, 2);
  assert.ok(bench.calls.every((call) => call.url.origin === config().rehearsalOrigin && call.redirect === 'manual'));
  assert.doesNotMatch(stdout.join('') + stderr.join(''), /local-service-key|local-fixture-secret|v16-rehearsal\.example\.test|Salary|COGS|BUD-|PROJ-/);
});

test('budget-whole-project Slice 1 real-route rehearsal cancels submitted probe documents after a read-back failure', async () => {
  const bench = createBench({ wrongReadback: true });
  const stdout = [];
  const stderr = [];
  const result = await runRangeProbe(config(), {
    explicitOptIn: true,
    fetchImpl: bench.fetch,
    stdout: (value) => stdout.push(value),
    stderr: (value) => stderr.push(value),
    newId: () => '11111111-1111-4111-8111-111111111111',
  });

  assert.equal(result.exitCode, 1);
  assert.equal(stdout.join(''), '');
  assert.match(stderr.join(''), /read-back/i);
  assert.ok([...bench.budgets.values()].every((doc) => doc.docstatus === 2));
});

test('budget-whole-project Slice 1 refuses the range rehearsal before creating a project unless the ERP version is 16', async () => {
  const bench = createBench({ versionMajor: 15 });
  const stdout = [];
  const stderr = [];
  const result = await runRangeProbe(config(), {
    explicitOptIn: true,
    fetchImpl: bench.fetch,
    stdout: (value) => stdout.push(value),
    stderr: (value) => stderr.push(value),
    newId: () => '11111111-1111-4111-8111-111111111111',
  });

  assert.equal(result.exitCode, 1);
  assert.equal(stdout.join(''), '');
  assert.match(stderr.join(''), /verify-version/i);
  assert.equal(bench.calls.filter((call) => call.method === 'POST' && decodeURIComponent(call.url.pathname) === '/api/resource/Project').length, 0);
  assert.equal(bench.budgets.size, 0);
});
