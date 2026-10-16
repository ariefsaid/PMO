#!/usr/bin/env node
/**
 * bv16-rehearsal.mjs — the AC-BV16-008 real-dispatch rehearsal harness (#1033, plan tasks 41–44).
 *
 * Drives the SHIPPED local `adapter-dispatch` over real HTTP against a Director-prepared local binding that
 * points at the nominated ERPNext v16 rehearsal copy. The harness itself never writes a Budget: it only
 * creates one run-owned ERP Project, reads Budgets back, and at cleanup cancels the Budgets on that run-owned
 * Project. Configuration arrives ONLY on an inherited file descriptor (FD3) as JSON — never argv/env — and no
 * credential, coordinate, account label or document name is ever printed.
 *
 * Run (Director only, plan task 46):
 *   scripts/with-erpnext-lock.sh scripts/with-db-lock.sh \
 *     scripts/serve-functions.sh -- node scripts/bv16-rehearsal.mjs --config-fd 3 [--retain-run]
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';

const REQUIRED = [
  'localApi', 'localServiceKey', 'localAnonKey', 'firstActorJwt', 'secondActorJwt',
  'rehearsalOrigin', 'rehearsalSite', 'erpAuthorization', 'company', 'salaryAccount',
  'cogsAccount', 'fiscalYear', 'startDate', 'endDate',
];
const ACTIONS = [
  'action_if_annual_budget_exceeded', 'action_if_accumulated_monthly_budget_exceeded',
  'action_if_annual_budget_exceeded_on_mr', 'action_if_accumulated_monthly_budget_exceeded_on_mr',
  'action_if_annual_budget_exceeded_on_po', 'action_if_accumulated_monthly_budget_exceeded_on_po',
];
const APPLICABLE_ON_FIELDS = {
  material_request: 'applicable_on_material_request',
  purchase_order: 'applicable_on_purchase_order',
  booking_actual_expenses: 'applicable_on_booking_actual_expenses',
};
/** The ERP list projection: only fields that exist on a v16 Budget (never `fiscal_year`). */
export const BUDGET_LIST_FIELDS = Object.freeze(['name', 'modified', 'docstatus', 'amended_from', 'from_fiscal_year', 'to_fiscal_year', 'account', 'project']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SALARY_CATEGORY = 'Labor';
const COGS_CATEGORY = 'Materials';
const PASS_LINE = 'AC-BV16-008 real-dispatch activation and single-account revision: PASS';

/** Every message carried by a HarnessError is a static, credential-free string safe to print. */
export class HarnessError extends Error {}
function fail(message) { throw new HarnessError(message); }
function configError() { return fail('Invalid rehearsal configuration'); }

function isLoopback(hostname) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  return host === '::1' || /^127(?:\.\d{1,3}){3}$/.test(host);
}
function cleanOrigin(value, protocol) {
  try {
    const url = new URL(value);
    if (url.protocol !== protocol || url.username || url.password || url.pathname !== '/' || url.search || url.hash) configError();
    if (url.hostname.split('.')[0].toLowerCase() === 'frontend') configError();
    return url.origin;
  } catch { return configError(); }
}

export function validateConfig(input) {
  if (!input || typeof input !== 'object' || REQUIRED.some((key) => typeof input[key] !== 'string' || input[key].trim() === '')) configError();
  let local;
  try { local = new URL(input.localApi); } catch { return configError(); }
  if (local.protocol !== 'http:' || !isLoopback(local.hostname) || local.username || local.password || local.pathname !== '/' || local.search || local.hash) configError();
  const rehearsalOrigin = cleanOrigin(input.rehearsalOrigin, 'https:');
  if (input.rehearsalSite.trim().toLowerCase() === 'frontend' || input.firstActorJwt === input.secondActorJwt) configError();
  if (input.salaryAccount === input.cogsAccount || !/^\d{4}$/.test(input.fiscalYear)) configError();
  for (const date of [input.startDate, input.endDate]) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`)) || new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date) configError();
  }
  if (input.startDate > input.endDate || Number(input.startDate.slice(0, 4)) > Number(input.fiscalYear) || Number(input.endDate.slice(0, 4)) < Number(input.fiscalYear)) configError();
  const localApi = local.origin;
  return Object.freeze({ ...input, localApi, rehearsalOrigin });
}

/**
 * The ONLY network path the harness has. Allow-lists the loopback PMO API and the nominated rehearsal
 * origin, never follows redirects, and on the rehearsal origin permits exactly: reads of Budget/Project,
 * creating a Project, and cancelling (`{"docstatus":2}`) a Budget whose name the cleanup put on the
 * `cancellableBudgets` allow-list. Local PATCH/DELETE must be `eq.`-scoped (no unfiltered/wildcard writes).
 */
export function createRoutedFetch(config, fetchImpl = globalThis.fetch, policy = {}) {
  const checked = validateConfig(config);
  const cancellable = policy.cancellableBudgets ?? new Set();
  return async (input, init = {}) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const origin = url.origin;
    if (origin !== checked.localApi && origin !== checked.rehearsalOrigin) fail('Request outside the rehearsal allowlist');
    const method = String(init.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
    if (origin === checked.rehearsalOrigin && !['GET', 'HEAD'].includes(method)) {
      const path = decodeURIComponent(url.pathname);
      const budgetName = path.startsWith('/api/resource/Budget/') ? path.slice('/api/resource/Budget/'.length) : null;
      const projectCreate = method === 'POST' && path === '/api/resource/Project';
      const allowedCancel = method === 'PUT' && budgetName !== null && cancellable.has(budgetName) && init.body === '{"docstatus":2}';
      if (!projectCreate && !allowedCancel) {
        fail(/\/api\/resource\/Budget(?:\/|$)/i.test(path) ? 'Budget writes are forbidden from the harness' : 'This ERP write is forbidden from the harness');
      }
    }
    if (origin === checked.localApi && ['PATCH', 'DELETE'].includes(method)) {
      const values = [...url.searchParams.values()];
      if (values.length === 0 || values.some((v) => !v.startsWith('eq.') || v.includes('*') || v.length <= 3)) fail('Refusing an unscoped local write');
    }
    return fetchImpl(url, { ...init, redirect: 'manual' });
  };
}

// ── identity (restated from budgetAccountIdentity.ts / budgetPushKey.ts so the oracle PREDICTS what the
//    server derives instead of reading it back; a test binds this restatement to the shipped module) ──
export function fiscalYearToken(fiscalYear) {
  return Buffer.from(fiscalYear, 'utf8').toString('hex').replace(/[a-f]/g, (ch) => 'TZ.+-:'['abcdef'.indexOf(ch)]);
}
export function budgetAccountIdentity(versionId, fiscalYear, account) {
  const token = fiscalYearToken(fiscalYear);
  return `${versionId}:a:${token.length}:${token}:${Buffer.from(account, 'utf8').toString('hex')}`;
}
const TIMESTAMPTZ_RE = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}:\d{2}(?:\.\d+)?)(Z|[+-]\d{2}(?::?\d{2})?)?$/i;
export function timestamptzEpochMs(value) {
  const match = TIMESTAMPTZ_RE.exec(String(value ?? '').trim());
  if (!match) return Number.NaN;
  const [, date, time, zone] = match;
  let normalized = zone ?? 'Z';
  if (normalized.length === 3) normalized = `${normalized}:00`;
  else if (normalized.length === 5) normalized = `${normalized.slice(0, 3)}:${normalized.slice(3)}`;
  return Date.parse(`${date}T${time}${normalized}`);
}
export function budgetAccountPushKey(identity, activatedAt) {
  return `bud16:${identity}:${timestamptzEpochMs(activatedAt)}`;
}

// ── oracles ─────────────────────────────────────────────────────────────────────────────────────────
function expectedApplicable(bindingConfig) {
  const configured = bindingConfig?.budget_applicable_on;
  if (!configured || typeof configured !== 'object') return {};
  return Object.fromEntries(Object.entries(APPLICABLE_ON_FIELDS).filter(([key]) => key in configured).map(([key, field]) => [field, configured[key] ? 1 : 0]));
}

function assertBudgetShape(row, account, amount, config, expect = {}) {
  if (row.account !== account || Number(row.budget_amount) !== amount || row.from_fiscal_year !== config.fiscalYear || row.to_fiscal_year !== config.fiscalYear) fail('Budget account, amount, or fiscal-year oracle failed');
  if (Object.hasOwn(row, 'fiscal_year')) fail('ERP Budget response unexpectedly contains fiscal_year');
  if (row.docstatus !== 1) fail('Budget must be submitted');
  if (row.distribution_frequency !== 'Monthly' || Number(row.distribute_equally) !== 1) fail('Budget distribution oracle failed');
  if (ACTIONS.some((field) => row[field] !== 'Warn')) fail('Budget overspend controls must all be Warn');
  // Only the applicable_on_* toggles the binding configures are sent (FR-BUD-131); ERP defaults the rest.
  for (const [field, value] of Object.entries(expect.applicable ?? {})) {
    if (Number(row[field]) !== value) fail('Budget applicability controls oracle failed');
  }
  if (expect.erpProject !== undefined && (row.project !== expect.erpProject || row.company !== config.company || row.budget_against !== 'Project')) fail('Budget is outside the run-owned Project scope');
}

export function assertBaselineBudgets(rows, configInput, expect = {}) {
  const config = validateConfig(configInput);
  if (!Array.isArray(rows) || rows.length !== 2) fail('Expected exactly two baseline Budgets');
  const salary = rows.filter((row) => row.account === config.salaryAccount);
  const cogs = rows.filter((row) => row.account === config.cogsAccount);
  if (salary.length !== 1 || cogs.length !== 1) fail('Expected one Budget per configured account');
  assertBudgetShape(salary[0], config.salaryAccount, 50000, config, expect);
  assertBudgetShape(cogs[0], config.cogsAccount, 25000, config, expect);
  return rows.length;
}

export function assertRevisionBudgets(revision, configInput, expect = {}) {
  const config = validateConfig(configInput);
  const { before, after, replay } = revision ?? {};
  if (!Array.isArray(before) || !Array.isArray(after) || !Array.isArray(replay)) fail('Invalid revision oracle');
  assertBaselineBudgets(before, config, expect);
  if (after.filter((row) => row.account === config.cogsAccount && row.docstatus === 1).length !== 1) fail('COGS must remain unchanged');
  if (after.length !== 3) fail('Revision must leave exactly three run-owned Budget documents');
  if (replay.length !== after.length) fail('Replay changed the Budget document set');
  const oldSalary = after.filter((row) => row.name === before.find((b) => b.account === config.salaryAccount)?.name);
  const newSalary = after.filter((row) => row.account === config.salaryAccount && row.docstatus === 1);
  const cogsAfter = after.filter((row) => row.account === config.cogsAccount && row.docstatus === 1);
  if (oldSalary.length !== 1 || oldSalary[0].docstatus !== 2 || newSalary.length !== 1 || newSalary[0].amended_from !== oldSalary[0].name || Number(newSalary[0].budget_amount) !== 60000) fail('Salary amendment oracle failed');
  if (cogsAfter.length !== 1 || cogsAfter[0].name !== before.find((b) => b.account === config.cogsAccount).name || cogsAfter[0].modified !== before.find((b) => b.account === config.cogsAccount).modified || Number(cogsAfter[0].budget_amount) !== 25000) fail('COGS must remain unchanged');
  assertBudgetShape(newSalary[0], config.salaryAccount, 60000, config, expect);
  assertBudgetShape(cogsAfter[0], config.cogsAccount, 25000, config, expect);
  const comparable = (rows) => rows.map(({ name, docstatus, modified }) => `${name}|${docstatus}|${modified ?? ''}`).sort();
  if (JSON.stringify(comparable(replay)) !== JSON.stringify(comparable(after))) fail('Replay changed the Budget document set');
  return after.length;
}

/**
 * The local-DB witness: both account units of `version` are pushed under the account identity + the
 * activation-epoch `bud16:` key, the mirror carries the version's own activation witness, and points at
 * the submitted ERP document for that account.
 */
export function assertLocalWitnesses({ version, mirrors, outbox, erpNames }, configInput) {
  const config = validateConfig(configInput);
  const epoch = timestamptzEpochMs(version?.activated_at);
  if (!version?.activated_at || !Number.isFinite(epoch)) fail('Activation witness missing on the version');
  if (!Array.isArray(mirrors) || mirrors.length !== 2) fail('Expected exactly two account mirror witness rows');
  for (const account of [config.salaryAccount, config.cogsAccount]) {
    const rows = mirrors.filter((row) => row.erp_account === account);
    if (rows.length !== 1) fail('Expected one mirror witness row per account');
    const [row] = rows;
    if (row.push_state !== 'pushed' || row.budget_intent !== 'ensure' || row.fiscal_year !== config.fiscalYear) fail('Account mirror witness is not pushed');
    if (timestamptzEpochMs(row.activated_at_witness) !== epoch) fail('Account mirror activation witness differs from the version');
    if (row.erp_budget_name !== erpNames?.[account]) fail('Account mirror witness points at the wrong ERP document');
    const identity = budgetAccountIdentity(version.id, config.fiscalYear, account);
    const key = budgetAccountPushKey(identity, version.activated_at);
    const commands = (outbox?.[identity] ?? []).filter((cmd) => cmd.idempotency_key === key);
    if (commands.length !== 1 || !['committed', 'confirmed'].includes(commands[0].state)) fail('Outbox witness for the account unit is missing or not landed');
  }
  return mirrors.length;
}

export function cleanupPlan({ runToken, localRows, projectName, budgetNames }) {
  if (typeof runToken !== 'string' || !runToken || !Array.isArray(localRows) || !Array.isArray(budgetNames) || !projectName) fail('Invalid cleanup ownership manifest');
  if (localRows.some((row) => !row || !row.table || !row.id || row.id === '*' || row.id.includes('*')) || budgetNames.some((name) => typeof name !== 'string' || !name || name.includes('*'))) fail('Wildcard cleanup target is forbidden');
  if (new Set(budgetNames).size !== budgetNames.length) fail('Duplicate ERP cleanup target');
  return Object.freeze({ runToken, localRows: localRows.map((row) => ({ ...row })), projectName, erpBudgetNames: [...budgetNames] });
}

export function sanitizeEvidence(evidence = {}) {
  const safe = {};
  if (evidence.counts && typeof evidence.counts === 'object') safe.counts = structuredClone(evidence.counts);
  if (Array.isArray(evidence.amounts) && evidence.amounts.every((n) => Number.isFinite(n))) safe.amounts = [...evidence.amounts];
  if (typeof evidence.runToken === 'string' && /^[a-zA-Z0-9_-]{1,80}$/.test(evidence.runToken)) safe.runToken = evidence.runToken;
  return safe;
}

/** Bounded polling (60 attempts, 1s apart) — never an arbitrary sleep. */
export async function pollUntil(check, { attempts = 60, intervalMs = 1000, sleep } = {}) {
  for (let i = 0; i < attempts; i += 1) {
    const value = await check();
    if (value !== undefined && value !== null && value !== false) return value;
    if (i < attempts - 1) await sleep(intervalMs);
  }
  return fail('Polling timed out waiting for the dispatch to land');
}

// ── transport helpers ───────────────────────────────────────────────────────────────────────────────
async function jsonRequest(fetcher, url, init = {}) {
  const response = await fetcher(url, init);
  if (response.status >= 300 && response.status < 400) fail('Redirect refused by rehearsal harness');
  const body = await response.text();
  if (!response.ok) fail(`Rehearsal request failed with HTTP ${response.status}`);
  if (!body) return null;
  try { return JSON.parse(body); } catch { return fail('Rehearsal endpoint returned invalid JSON'); }
}
const qs = (params) => new URLSearchParams(params).toString();
const quoteIn = (values) => `in.(${values.map((v) => `"${String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`).join(',')})`;

function clients(config, fetcher) {
  const local = (path, { key, jwt, method = 'GET', body, prefer } = {}) => jsonRequest(fetcher, `${config.localApi}${path}`, {
    method,
    headers: { apikey: key, Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json', ...(prefer ? { Prefer: prefer } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const service = (path, opts = {}) => local(path, { ...opts, key: config.localServiceKey, jwt: config.localServiceKey });
  const actor = (jwt) => (path, opts = {}) => local(path, { ...opts, key: config.localAnonKey, jwt });
  const erp = (path, { method = 'GET', body } = {}) => jsonRequest(fetcher, `${config.rehearsalOrigin}${path}`, {
    method,
    headers: { Authorization: config.erpAuthorization, Accept: 'application/json', 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }),
  });
  return { service, actor1: actor(config.firstActorJwt), actor2: actor(config.secondActorJwt), erp };
}

function writePrivate(dir, name, value) {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const path = resolve(dir, name);
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
  return path;
}

// ── the run ─────────────────────────────────────────────────────────────────────────────────────────
export async function runRehearsal(configInput, deps = {}) {
  const config = validateConfig(configInput); // refuses before any request
  const {
    fetchImpl = globalThis.fetch,
    sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
    evidenceDir = resolve(tmpdir(), 'pmo-bv16-rehearsal'),
    stdout = (s) => process.stdout.write(s),
    stderr = (s) => process.stderr.write(s),
    retainRun = false,
    newId = randomUUID,
  } = deps;
  const cancellableBudgets = new Set();
  const fetcher = createRoutedFetch(config, fetchImpl, { cancellableBudgets });
  const { service, actor1, actor2, erp } = clients(config, fetcher);
  const runToken = newId().replaceAll('-', '');
  const s = { orgId: null, erpProject: null, projectId: null, versionIds: [], bindingConfig: undefined, bindingMutated: false, priorMap: null, mapMutated: false };
  const report = { counts: {}, amounts: [], runToken };
  let stage = 'resolve-actors';
  let exitCode = 1;

  const listBudgets = async () => {
    const rows = (await erp(`/api/resource/Budget?${qs({ filters: JSON.stringify([['project', '=', s.erpProject]]), fields: JSON.stringify(BUDGET_LIST_FIELDS), limit_page_length: '100' })}`))?.data;
    if (!Array.isArray(rows) || rows.some((row) => row.project !== s.erpProject || typeof row.name !== 'string')) fail('ERP Budget list escaped the run-owned Project');
    return rows;
  };
  const readBudgets = async () => {
    const docs = [];
    // Sequential on purpose: the rehearsal copy shares a VM; the harness adds no parallel ERP traffic.
    for (const row of await listBudgets()) docs.push((await erp(`/api/resource/Budget/${encodeURIComponent(row.name)}`))?.data);
    return docs;
  };
  const readVersion = async (id) => {
    const rows = await service(`/rest/v1/budget_versions?${qs({ id: `eq.${id}`, select: 'id,version,status,activated_at' })}`);
    if (!Array.isArray(rows) || rows.length !== 1) fail('Run-owned budget version not found');
    return rows[0];
  };
  const readMirrors = async (id) => service(`/rest/v1/budget_version_account_erp_mirror?${qs({ org_id: `eq.${s.orgId}`, budget_version_id: `eq.${id}`, select: 'erp_account,fiscal_year,push_state,budget_intent,activated_at_witness,erp_budget_name' })}`);
  const readOutbox = async (identity) => service(`/rest/v1/external_command_outbox?${qs({ org_id: `eq.${s.orgId}`, domain: 'eq.budget', pmo_record_id: `eq.${identity}`, select: 'state,idempotency_key' })}`);
  const activateAndDispatch = async (versionId) => {
    await actor2('/rest/v1/rpc/activate_budget_version', { method: 'POST', body: { version_id: versionId } });
    await actor2('/functions/v1/adapter-dispatch', { method: 'POST', body: { domain: 'budget', operation: 'create', record: { id: versionId, erp_doc_kind: 'budget' } } });
  };
  const dispatchOnly = (versionId) => actor2('/functions/v1/adapter-dispatch', { method: 'POST', body: { domain: 'budget', operation: 'create', record: { id: versionId, erp_doc_kind: 'budget' } } });
  const waitForUnits = (versionId) => pollUntil(async () => {
    const rows = await readMirrors(versionId);
    if (!Array.isArray(rows) || rows.length === 0 || rows.some((r) => ['pending', 'pushing'].includes(r.push_state))) return undefined;
    return rows.length >= 2 || rows.some((r) => ['failed', 'held'].includes(r.push_state)) ? rows : undefined;
  }, { sleep });
  const witness = async (versionId, docs) => {
    const version = await readVersion(versionId);
    const outbox = {};
    for (const account of [config.salaryAccount, config.cogsAccount]) {
      const identity = budgetAccountIdentity(versionId, config.fiscalYear, account);
      outbox[identity] = await readOutbox(identity);
    }
    const erpNames = Object.fromEntries(docs.filter((d) => d.docstatus === 1).map((d) => [d.account, d.name]));
    assertLocalWitnesses({ version, mirrors: await readMirrors(versionId), outbox, erpNames }, config);
  };

  try {
    // 1. Actors: two distinct people of one org (actor1 drafts/clones, actor2 activates — OD-BUDGET-6).
    const ids = [];
    for (const who of [actor1, actor2]) {
      const user = await who('/auth/v1/user');
      if (!user || typeof user.id !== 'string') fail('Actor session did not resolve');
      ids.push(user.id);
    }
    if (ids[0] === ids[1]) fail('The two actors must be different people');
    const orgs = [];
    for (const id of ids) {
      const rows = await service(`/rest/v1/profiles?${qs({ id: `eq.${id}`, select: 'org_id' })}`);
      if (!Array.isArray(rows) || rows.length !== 1 || !rows[0].org_id) fail('Actor profile not found');
      orgs.push(rows[0].org_id);
    }
    if (orgs[0] !== orgs[1]) fail('The two actors must belong to one org');
    s.orgId = orgs[0];

    // 2. The Director-prepared local-only binding must already be the nominated v16 rehearsal binding.
    stage = 'verify-binding';
    const bindingFilter = qs({ org_id: `eq.${s.orgId}`, external_tier: 'eq.erpnext' });
    const bindings = await service(`/rest/v1/external_org_bindings?${bindingFilter}&select=site_url,version_major,activated_at,config`);
    const binding = Array.isArray(bindings) && bindings.length === 1 ? bindings[0] : null;
    let siteOrigin = null;
    try { siteOrigin = new URL(binding?.site_url).origin; } catch { /* refused below */ }
    if (!binding || siteOrigin !== config.rehearsalOrigin || binding.version_major !== 16 || !binding.activated_at || binding.config?.company !== config.company) {
      fail('The local binding is not the nominated active v16 rehearsal binding');
    }
    const expect = { applicable: expectedApplicable(binding.config) };

    // 3. Snapshot the org-global map rows this run will displace (by category AND by account).
    stage = 'snapshot-map';
    const mapCols = 'org_id,category,erp_account,is_push_target';
    const byCategory = await service(`/rest/v1/budget_category_account_map?${qs({ org_id: `eq.${s.orgId}`, category: quoteIn([SALARY_CATEGORY, COGS_CATEGORY]), select: mapCols })}`);
    const byAccount = await service(`/rest/v1/budget_category_account_map?${qs({ org_id: `eq.${s.orgId}`, erp_account: quoteIn([config.salaryAccount, config.cogsAccount]), select: mapCols })}`);
    const seen = new Set();
    s.priorMap = [...(byCategory ?? []), ...(byAccount ?? [])].filter((row) => {
      const key = `${row.category}\u0000${row.erp_account}`;
      return seen.has(key) ? false : (seen.add(key), true);
    });

    // 4. Run-owned ERP Project (the only ERP write the harness makes besides cleanup cancels).
    stage = 'setup-erp-project';
    const created = await erp('/api/resource/Project', { method: 'POST', body: { project_name: `PMO-BV16-${runToken}`, company: config.company } });
    if (typeof created?.data?.name !== 'string' || !created.data.name) fail('ERP Project setup did not return a name');
    s.erpProject = created.data.name;

    // 5. Run-owned local PMO project inside the nominated fiscal year.
    stage = 'setup-local-project';
    const projectId = newId();
    await service('/rest/v1/projects', { method: 'POST', prefer: 'return=minimal', body: { id: projectId, org_id: s.orgId, name: `BV16-REHEARSAL-${runToken}`, status: 'Ongoing Project', start_date: config.startDate, end_date: config.endDate } });
    s.projectId = projectId;

    // 6. Add ONLY this run's project-map entry to the binding.
    stage = 'setup-binding-map';
    s.bindingConfig = structuredClone(binding.config);
    s.bindingMutated = true;
    const patched = await service(`/rest/v1/external_org_bindings?${bindingFilter}`, { method: 'PATCH', prefer: 'return=representation', body: { config: { ...binding.config, project_map: { ...(binding.config.project_map ?? {}), [projectId]: s.erpProject } } } });
    if (!Array.isArray(patched) || patched.length !== 1) fail('Binding project-map update did not land');

    // 7. Two map entries: Labor → Salary, Materials → COGS.
    stage = 'setup-category-map';
    s.mapMutated = true;
    for (const row of s.priorMap) {
      await service(`/rest/v1/budget_category_account_map?${qs({ org_id: `eq.${s.orgId}`, category: `eq.${row.category}`, erp_account: `eq.${row.erp_account}` })}`, { method: 'DELETE', prefer: 'return=minimal' });
    }
    await service('/rest/v1/budget_category_account_map', { method: 'POST', prefer: 'return=minimal', body: [
      { org_id: s.orgId, category: SALARY_CATEGORY, erp_account: config.salaryAccount, is_push_target: true },
      { org_id: s.orgId, category: COGS_CATEGORY, erp_account: config.cogsAccount, is_push_target: true },
    ] });

    // 8. actor1 drafts version 1 (Salary 50,000 / COGS 25,000, phased to the nominated year).
    stage = 'setup-draft-version';
    const v1 = newId();
    await actor1('/rest/v1/budget_versions', { method: 'POST', prefer: 'return=minimal', body: { id: v1, project_id: projectId, version: 1, name: `BV16 rehearsal ${runToken}`, status: 'Draft' } });
    s.versionIds.push(v1);
    await actor1('/rest/v1/budget_line_items', { method: 'POST', prefer: 'return=minimal', body: [
      { budget_version_id: v1, category: SALARY_CATEGORY, budgeted_amount: '50000.00', fiscal_year: config.fiscalYear },
      { budget_version_id: v1, category: COGS_CATEGORY, budgeted_amount: '25000.00', fiscal_year: config.fiscalYear },
    ] });

    // 9. actor2 activates; the shipped handler is driven over real HTTP.
    stage = 'baseline-dispatch';
    await activateAndDispatch(v1);
    await waitForUnits(v1);
    stage = 'baseline-oracle';
    const before = await readBudgets();
    assertBaselineBudgets(before, config, { ...expect, erpProject: s.erpProject });
    await witness(v1, before);

    // 10. Revision: actor1 clones + edits only Salary → 60,000; actor2 activates; same real handler.
    stage = 'revision-setup';
    const v2 = await actor1('/rest/v1/rpc/clone_budget_version', { method: 'POST', body: { version_id: v1 } });
    if (typeof v2 !== 'string' || !UUID.test(v2)) fail('Clone did not return a version id');
    s.versionIds.push(v2);
    const salaryLines = await actor1(`/rest/v1/budget_line_items?${qs({ budget_version_id: `eq.${v2}`, category: `eq.${SALARY_CATEGORY}`, select: 'id' })}`);
    if (!Array.isArray(salaryLines) || salaryLines.length !== 1) fail('Expected exactly one Salary line on the clone');
    const edited = await actor1(`/rest/v1/budget_line_items?${qs({ id: `eq.${salaryLines[0].id}` })}`, { method: 'PATCH', prefer: 'return=representation', body: { budgeted_amount: '60000.00' } });
    if (!Array.isArray(edited) || edited.length !== 1) fail('Salary edit did not land');
    stage = 'revision-dispatch';
    await activateAndDispatch(v2);
    await waitForUnits(v2);
    const after = await readBudgets();

    // 11. Replay the identical dispatch: the document set must not change.
    stage = 'replay-dispatch';
    await dispatchOnly(v2);
    const replay = await readBudgets();
    stage = 'revision-oracle';
    assertRevisionBudgets({ before, after, replay }, config, { ...expect, erpProject: s.erpProject });
    await witness(v2, after);
    const v1Row = await readVersion(v1);
    if (!v1Row.activated_at) fail('Activation witness missing on the first version');
    const amountOf = (docs, account) => Number(docs.find((d) => d.docstatus === 1 && d.account === account).budget_amount);
    report.counts = {
      versions: s.versionIds.length,
      baselineSubmitted: before.filter((d) => d.docstatus === 1).length,
      revisionDocuments: after.length,
      revisionSubmitted: after.filter((d) => d.docstatus === 1).length,
      replayDocuments: replay.length,
    };
    report.amounts = [amountOf(before, config.salaryAccount), amountOf(before, config.cogsAccount), amountOf(after, config.salaryAccount), amountOf(after, config.cogsAccount)];
    stdout(`${PASS_LINE}\n${JSON.stringify(sanitizeEvidence(report))}\n`);
    exitCode = 0;
  } catch (error) {
    const message = error instanceof HarnessError ? error.message : 'unexpected error (details withheld)';
    stderr(`Budget v16 rehearsal FAILED at stage ${stage}: ${message}\n`);
  }

  const cleanupFailed = await cleanup();
  return { exitCode: cleanupFailed ? 2 : exitCode };

  async function cleanup() {
    const failedSteps = [];
    const step = async (name, fn) => { try { await fn(); } catch { failedSteps.push(name); } };
    const localRows = [
      ...(s.projectId ? [{ table: 'projects', id: s.projectId }] : []),
      ...s.versionIds.map((id) => ({ table: 'budget_versions', id })),
    ];
    let erpBudgetNames = [];

    // Private evidence first; local fixtures are only removed if it was saved.
    let evidenceSaved = false;
    await step('save-evidence', async () => {
      writePrivate(evidenceDir, `${runToken}.evidence.json`, { ...sanitizeEvidence(report), passed: exitCode === 0, stage, erpProject: s.erpProject, localRows });
      evidenceSaved = true;
    });

    // Org-global singletons are always restored, even in --retain-run.
    if (s.bindingMutated) {
      await step('restore-binding', async () => {
        await service(`/rest/v1/external_org_bindings?${qs({ org_id: `eq.${s.orgId}`, external_tier: 'eq.erpnext' })}`, { method: 'PATCH', prefer: 'return=minimal', body: { config: s.bindingConfig } });
      });
    }
    if (s.mapMutated) {
      await step('restore-category-map', async () => {
        const ours = [[SALARY_CATEGORY, config.salaryAccount], [COGS_CATEGORY, config.cogsAccount]];
        for (const [category, account] of [...ours, ...s.priorMap.map((r) => [r.category, r.erp_account])]) {
          await service(`/rest/v1/budget_category_account_map?${qs({ org_id: `eq.${s.orgId}`, category: `eq.${category}`, erp_account: `eq.${account}` })}`, { method: 'DELETE', prefer: 'return=minimal' });
        }
        if (s.priorMap.length > 0) await service('/rest/v1/budget_category_account_map', { method: 'POST', prefer: 'return=minimal', body: s.priorMap });
      });
    }

    if (retainRun) {
      if (s.erpProject) await step('list-erp-budgets', async () => { erpBudgetNames = (await listBudgets()).map((r) => r.name); });
      await step('write-manifest', async () => { writePrivate(evidenceDir, `${runToken}.cleanup.json`, { runToken, retained: true, failedSteps: [...failedSteps], erpProject: s.erpProject, erpBudgetNames, localRows }); });
      stderr(`Retained run token ${runToken}\n`);
      return failedSteps.length > 0;
    }

    // ERP: cancel only the submitted Budgets on this run's own Project, by name. Never delete anything.
    if (s.erpProject) {
      await step('cancel-erp-budgets', async () => {
        const rows = await listBudgets();
        if (rows.some((r) => r.docstatus === 0)) failedSteps.push('erp-draft-budgets-remain');
        const plan = cleanupPlan({ runToken, localRows, projectName: s.erpProject, budgetNames: rows.filter((r) => r.docstatus === 1).map((r) => r.name) });
        erpBudgetNames = plan.erpBudgetNames;
        let cancelFailed = false;
        for (const name of plan.erpBudgetNames) {
          cancellableBudgets.add(name);
          try { await erp(`/api/resource/Budget/${encodeURIComponent(name)}`, { method: 'PUT', body: '{"docstatus":2}' }); } catch { cancelFailed = true; }
        }
        if (cancelFailed) fail('cancel failed');
      });
    }

    // Local: run-owned rows only, each by exact id.
    if (evidenceSaved) {
      await step('delete-local-fixtures', async () => {
        for (const versionId of [...s.versionIds].reverse()) {
          const identities = [versionId, `${versionId}:${fiscalYearToken(config.fiscalYear)}`,
            budgetAccountIdentity(versionId, config.fiscalYear, config.salaryAccount), budgetAccountIdentity(versionId, config.fiscalYear, config.cogsAccount)];
          for (const table of ['external_command_outbox', 'external_refs', 'external_ref_lineage']) {
            for (const identity of identities) {
              await service(`/rest/v1/${table}?${qs({ org_id: `eq.${s.orgId}`, domain: 'eq.budget', pmo_record_id: `eq.${identity}` })}`, { method: 'DELETE', prefer: 'return=minimal' });
            }
          }
          await service(`/rest/v1/budget_line_items?${qs({ budget_version_id: `eq.${versionId}` })}`, { method: 'DELETE', prefer: 'return=minimal' });
          await service(`/rest/v1/budget_versions?${qs({ id: `eq.${versionId}` })}`, { method: 'DELETE', prefer: 'return=minimal' });
        }
        if (s.projectId) await service(`/rest/v1/projects?${qs({ id: `eq.${s.projectId}` })}`, { method: 'DELETE', prefer: 'return=minimal' });
      });
    } else if (localRows.length > 0) {
      failedSteps.push('local-fixtures-retained');
    }

    if (failedSteps.length === 0) return false;
    try { writePrivate(evidenceDir, `${runToken}.cleanup.json`, { runToken, retained: false, failedSteps, erpProject: s.erpProject, erpBudgetNames, localRows }); } catch { /* reported below */ }
    stderr(`Budget v16 rehearsal cleanup incomplete; Director action required for run token ${runToken}\n`);
    return true;
  }
}

function readConfigFromFd(fd) {
  const text = readFileSync(fd, { encoding: 'utf8' });
  try { return validateConfig(JSON.parse(text)); } catch { return configError(); }
}

export function parseArgs(argv) {
  let retainRun = false;
  let configFd;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--retain-run' && !retainRun) {
      retainRun = true;
    } else if (argv[i] === '--config-fd' && configFd === undefined && argv[i + 1] === '3') {
      configFd = 3;
      i += 1;
    } else {
      throw new Error('Invalid rehearsal CLI arguments');
    }
  }
  return { retainRun, configFd: configFd ?? 3 };
}

async function main() {
  let config;
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
    config = readConfigFromFd(args.configFd);
  } catch {
    process.stderr.write('Budget v16 rehearsal refused: invalid arguments or configuration; no request was made.\n');
    process.exitCode = 1;
    return;
  }
  try {
    const { exitCode } = await runRehearsal(config, { retainRun: args.retainRun });
    process.exitCode = exitCode;
  } catch {
    process.stderr.write('Budget v16 rehearsal did not complete; no pass evidence was emitted.\n');
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
