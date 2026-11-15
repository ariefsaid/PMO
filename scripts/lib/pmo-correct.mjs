/**
 * pmo-correct — `pmo correct project|contract-line|budget-line`: fix a value the loader wrote (#1858).
 * Spec: docs/specs/cli-loader-corrections.spec.md · runbook docs/runbooks/pmo-cli.md §11.
 *
 * One record per call, found by the loader's own key, changed by the app's own plain table update
 * (same column grants, row security and triggers). resolve* only READS; the single write is the last step.
 * The database stays the authority: its refusal is rethrown untouched. Node 22 standard library only.
 */
import { encodeBudgetImportIdentity } from './budget-import-identity.mjs';
import {
  AMOUNT_RULE, BUDGET_CATEGORIES, CLASSIFICATION_FIELDS, CONTRACT_LINE_BASES, CONTRACT_LINE_TEXT_LIMITS, QUANTITY_RULE, classifyBudgetLine, eq,
  isAmount, isDate, isQuantity, isText, params,
} from './pmo-load.mjs';

export class CorrectionError extends Error {
  /** exit 2 = stopped before any write; exit 1 = the server or the write refused. */
  constructor(message, { exit = 2, code, details } = {}) {
    super(message);
    this.exit = exit;
    this.code = code;
    this.details = details;
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NUMBER = /^\d+(\.\d+)?$/;
/** Text is trimmed as the app trims it; `max` is a loader limit, absent where the database is the only authority. */
const text = (max = Infinity) => (raw) => {
  const value = typeof raw === 'string' ? raw.trim() : '';
  if (value === '') return { problem: 'must not be blank (clearing a value is done in the app)' };
  if (value.length > max) return { problem: `must be at most ${max} characters` };
  return { value };
};
/** The values the database's CHECK constraints accept (projects_award_type_check, projects_bidding_entity_check). */
const oneOf = (allowed) => (raw) => (allowed.includes(raw) ? { value: raw } : { problem: `must be one of: ${allowed.join(', ')}` });
const date = (raw) => (isDate(raw) ? { value: raw } : { problem: 'must be a real date (YYYY-MM-DD)' });
const amount = (raw) => (NUMBER.test(String(raw)) && isAmount(Number(raw)) ? { value: Number(raw) } : { problem: AMOUNT_RULE });
const quantity = (raw) => (NUMBER.test(String(raw)) && isQuantity(Number(raw)) ? { value: Number(raw) } : { problem: QUANTITY_RULE });
const uuid = (raw) => (UUID.test(String(raw)) ? { value: String(raw).toLowerCase() } : { problem: 'must be a person id (UUID); list them with `pmo get profiles`' });
const basis = (raw) => (CONTRACT_LINE_BASES.includes(raw) ? { value: raw } : { problem: `must be one of: ${CONTRACT_LINE_BASES.join(', ')}` });

/** What each command may change: field → { column, parse }. Anything else is refused, naming the app. */
export const CORRECTABLE = Object.freeze({
  project: Object.freeze({
    table: 'projects', screen: 'Project header → Edit',
    fields: Object.freeze({
      name: { parse: text() }, short_name: { parse: text() }, start_date: { parse: date }, end_date: { parse: date },
      project_manager_id: { parse: uuid },
      ...Object.fromEntries(CLASSIFICATION_FIELDS.map((f) => [f, { parse: text() }])),
      award_type: { parse: oneOf(['tender', 'direct']) }, bidding_entity: { parse: oneOf(['alone', 'consortium']) },
    }),
  }),
  'contract-line': Object.freeze({
    table: 'boq_items', screen: 'Project → Contract & billing',
    fields: Object.freeze({
      description: { parse: text(CONTRACT_LINE_TEXT_LIMITS.description) }, unit: { parse: text(CONTRACT_LINE_TEXT_LIMITS.unit) }, quantity: { parse: quantity }, rate: { parse: amount },
      basis: { column: 'earning_basis', parse: basis },
    }),
  }),
  'budget-line': Object.freeze({
    table: 'budget_line_items', screen: 'Project → Budget (a Draft line)',
    fields: Object.freeze({ budgeted_amount: { parse: amount }, description: { parse: text(CONTRACT_LINE_TEXT_LIMITS.description) } }),
  }),
});

/** Tables `pmo correct` PATCHes that the API-client guard's Admin tier must allow (projects is already in its write tables). */
export const CORRECT_ADMIN_PATCH_TABLES = Object.freeze(
  Object.values(CORRECTABLE).map((spec) => spec.table).filter((table) => table !== 'projects').sort(),
);

/** The exact Prefer header migration 0899's API-client guard requires for a command-line PATCH on those tables: one row, refused otherwise. */
const ONE_ROW = { prefer: 'return=representation,handling=strict,max-affected=1' };

/** Where the app changes a field the CLI will not (the first matching entry names it). */
const POINTERS = {
  contract_value: 'a contract value moves only in the app, where its approval rules apply',
  tax_treatment: 'tax is set with the contract value in the app', tax_amount: 'tax is set with the contract value in the app',
  status: 'move a project through its stages in the app (`pmo stage-date` corrects a stage date)',
  stage: 'move a project through its stages in the app (`pmo stage-date` corrects a stage date)',
  code: 'a project code is its identity; change it in the app', client: 'change the client in the app', client_id: 'change the client in the app',
  end_client: 'change the end customer in the app', end_client_id: 'change the end customer in the app',
  currency: 'a project keeps its currency; change it in the app',
  archived_at: 'archive and restore records in the app',
};

/** Repeatable `field=value` flags → { field: 'value' }. Usage errors (exit 2). */
export function parseSets(list) {
  if (!Array.isArray(list) || list.length === 0) throw new CorrectionError('give at least one --set <field>=<value>');
  const sets = {};
  for (const item of list) {
    const at = String(item).indexOf('=');
    if (at <= 0) throw new CorrectionError(`--set takes field=value: got '${item}'`);
    const field = item.slice(0, at);
    const value = item.slice(at + 1);
    if (Object.hasOwn(sets, field)) throw new CorrectionError(`--set ${field} appears twice`);
    if (value === '') throw new CorrectionError(`--set ${field}= is empty: the CLI does not clear a value; clear it in the app`);
    sets[field] = value;
  }
  return sets;
}

/** { problems, values }: values is { field: { column, value } } for every field that parsed. Offline. */
export function validateSets(kind, sets) {
  const spec = CORRECTABLE[kind];
  const problems = [];
  const values = {};
  for (const [field, raw] of Object.entries(sets)) {
    const def = Object.hasOwn(spec.fields, field) ? spec.fields[field] : null;
    if (!def) {
      problems.push(`"${field}" is not correctable here: ${POINTERS[field] ?? `change it in the app (${spec.screen})`}; correctable: ${Object.keys(spec.fields).join(', ')}`);
      continue;
    }
    const r = def.parse(raw);
    if (r.problem) problems.push(`"${field}" ${r.problem}`);
    else values[field] = { column: def.column ?? field, value: r.value };
  }
  return { problems, values };
}

const refuse = (message, details) => new CorrectionError(message, { details });
const one = (rows, none, many) => {
  if (rows.length === 0) throw refuse(none);
  if (rows.length > 1) throw refuse(many);
  return rows[0];
};

const PROJECT_COLUMNS = 'id,code,name,short_name,client_id,start_date,end_date,project_manager_id,service_line,sector,location,award_type,bidding_entity';

/** The project by the loader's key: its code, else its name and client's legal name. */
async function resolveProject(api, target) {
  if (isText(target.code)) {
    const rows = await api.get('projects', params({ select: PROJECT_COLUMNS, code: eq(target.code) }));
    return one(rows, `No project has the code "${target.code}"`, `More than one project has the code "${target.code}" — resolve it in the app`);
  }
  if (!isText(target.name) || !isText(target.client)) throw refuse('name the project: --code <code>, or --name <name> --client <legal name>');
  const companies = await api.get('companies', params({ select: 'id,name,type,archived_at', name: eq(target.client) }));
  const clients = companies.length > 1 ? companies.filter((c) => c.type === 'Client') : companies;
  // An archived client is fine: a correction creates nothing (the loader refuses it because it would attach a new project).
  const client = one(clients, `"${target.client}" is not a company in PMO`, `More than one company is named "${target.client}" — resolve it in the app`);
  const rows = await api.get('projects', params({ select: PROJECT_COLUMNS, name: eq(target.name), client_id: eq(client.id) }));
  return one(rows, `No project named "${target.name}" exists for "${target.client}"`, `More than one project is named "${target.name}" for "${target.client}" — use --code`);
}

async function resolveContractLine(api, project, target) {
  if (!isText(target.key)) throw refuse('name the contract line: --line-key <the load file\'s line key>');
  const rows = await api.get('boq_items', params({
    select: 'id,project_id,import_key,description,unit,quantity,rate,earning_basis', project_id: eq(project.id), import_key: eq(target.key),
  }));
  return one(rows, `No contract line has the key "${target.key}" on this project`, `More than one contract line has the key "${target.key}" — resolve it in the app`);
}

/** The load row, checked by the loader's own rules. Offline. */
function checkBudgetRow(row) {
  const problems = [];
  if (row === null || typeof row !== 'object' || Array.isArray(row)) return ['--line must be one budget row as in the load file: {"category":…,"budgeted_amount":…}'];
  if (!BUDGET_CATEGORIES.includes(row.category)) problems.push(`--line "category" must be one of: ${BUDGET_CATEGORIES.join(', ')}`);
  if (!isAmount(row.budgeted_amount)) problems.push('--line "budgeted_amount" must be the amount as loaded (a non-negative amount with at most 2 decimals)');
  for (const k of ['description', 'fiscal_year', 'reference']) {
    if (row[k] !== undefined && row[k] !== null && typeof row[k] !== 'string') problems.push(`--line "${k}" must be text`);
  }
  return problems;
}

/** The budget line the load row created: matched on its import key, in any of the project's versions. */
async function resolveBudgetLine(api, project, row, clientName) {
  const category = classifyBudgetLine(row.category, row.description).category;
  const identity = encodeBudgetImportIdentity({
    // `project` is the loader's file key: the code, else name | client legal name (used by the pre-v2 "fp:" key).
    projectUuid: project.id, project: project.code ?? `${project.name} | ${clientName}`, category, rawCategory: row.category,
    description: String(row.description ?? ''), fiscalYear: String(row.fiscal_year ?? ''), amountText: String(row.budgeted_amount),
    amount: row.budgeted_amount, reference: String(row.reference ?? ''),
  });
  const versions = await api.get('budget_versions', params({ select: 'id,status,version,budget_mode', project_id: eq(project.id), order: 'version.desc' }));
  if (versions.length === 0) throw refuse('The project has no budget version');
  const select = 'id,budget_version_id,category,description,fiscal_year,budgeted_amount,import_key,import_origin';
  const hits = new Map();
  for (const v of versions) {
    for (const [key, origin] of [[identity.v2Key, 2], [identity.legacyKey, null]]) {
      const rows = await api.get('budget_line_items', params({ select, budget_version_id: eq(v.id), import_key: eq(key) }));
      for (const r of rows) if ((r.import_origin ?? null) === origin) hits.set(r.id, { line: r, version: v });
    }
  }
  const { line, version } = one([...hits.values()], 'No budget line matches this row as it was loaded', 'More than one budget line matches this row — inspect the Draft in Project → Budget');
  if (version.status !== 'Draft') throw refuse('line-items can only change while the owning version is Draft — the budget for this line is not a Draft; correct it in Project → Budget');
  if (version.budget_mode === 'whole_project') throw refuse('The Draft budget is in whole-project mode — the CLI corrects per-year lines only; edit it in the app');
  return line;
}

const same = (a, b) => (typeof b === 'number' ? Number(a) === b : (a ?? null) === b);

/**
 * Correct one record. target: { code | name+client, key (contract-line), line (budget-line row) }.
 * Returns { kind, dry_run, applied, id, table, fields: [{ field, before, after, status }], next? }.
 */
export async function correct(kind, target, sets, api, { dryRun }) {
  const spec = CORRECTABLE[kind];
  if (!spec) throw new CorrectionError(`unknown correction '${kind}': use project, contract-line or budget-line`);
  const { problems, values } = validateSets(kind, sets);
  if (kind === 'budget-line') problems.push(...checkBudgetRow(target.line));
  if (problems.length > 0) throw new CorrectionError(`${problems.length} problem(s); nothing was sent.`, { details: problems });

  const project = await resolveProject(api, target);
  let record = project;
  if (kind === 'contract-line') record = await resolveContractLine(api, project, target);
  if (kind === 'budget-line') record = await resolveBudgetLine(api, project, target.line, target.client);

  const fields = Object.entries(values).map(([field, { column, value }]) => ({
    field, before: record[column] ?? null, after: value, status: same(record[column], value) ? 'unchanged' : 'changed',
  }));

  if (kind === 'contract-line') {
    const merged = (f, column) => values[f]?.value ?? record[column];
    if (merged('basis', 'earning_basis') === 'lump_sum' && Number(merged('quantity', 'quantity')) !== 1) {
      throw new CorrectionError('1 problem(s); nothing was sent.', { details: ['a lump-sum line must have quantity 1'] });
    }
  }

  const changed = fields.filter((f) => f.status === 'changed');
  const result = { kind, dry_run: Boolean(dryRun), applied: false, id: record.id, table: spec.table, fields };
  if (changed.length === 0) return result;
  if (dryRun) return { ...result, next: 'Preview only: nothing was written. Re-run without --dry-run to apply.' };

  const body = Object.fromEntries(changed.map((f) => [values[f.field].column, f.after]));
  // The guard admits a command-line PATCH on its tables (boq_items, budget_line_items) only with the one-row request
  // in the same header; `projects` is an ordinary write table and passes no header of its own.
  const rows = await api.patch(spec.table, params({ id: eq(record.id) }), body,
    CORRECT_ADMIN_PATCH_TABLES.includes(spec.table) ? ONE_ROW : undefined);
  // #541: a row-security denial is a 0-row update with no error — never report that as success.
  if (!rows?.length) throw new CorrectionError('No row was updated — it no longer exists, or you are not allowed to change it (the database decides).', { exit: 1, code: 'no_rows' });
  return { ...result, applied: true };
}
