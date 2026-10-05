/**
 * pmo-load — `pmo load`: one client's starting data, through the app's own write paths (#796).
 * Spec: docs/specs/client-starting-data-cli.spec.md · ADR-0074 · runbook docs/runbooks/pmo-cli.md §4.
 *
 * Order: companies → projects (create as Leads → contract value → stage walk) → draft budgets.
 * resolveLoad() only READS and returns problems or a plan; applyLoad() writes the plan in order (or,
 * with dryRun, only lists it) and stops at the first refusal. Every entity is matched before it is
 * written, so re-running the same file resumes and never duplicates.
 *
 * Writes use the owner's own token: RLS-governed inserts for companies, projects and budget rows, and
 * the security-definer RPCs set_project_contract_value / transition_project for money and stage. Never:
 * budget activation, work orders, deletes, or status / activated_at / actual_amount on a budget row.
 *
 * Node 22 standard library only.
 */

/** Target stage → the transitions from 'Leads' that reach it (AC-CSD-014 proves each step is legal). */
export const LOAD_STAGE_PATHS = Object.freeze({
  Leads: Object.freeze([]),
  'PQ Submitted': Object.freeze(['PQ Submitted']),
  'Quotation Submitted': Object.freeze(['PQ Submitted', 'Quotation Submitted']),
  'Tender Submitted': Object.freeze(['PQ Submitted', 'Quotation Submitted', 'Tender Submitted']),
  Negotiation: Object.freeze(['PQ Submitted', 'Quotation Submitted', 'Tender Submitted', 'Negotiation']),
  'Won, Pending KoM': Object.freeze(['PQ Submitted', 'Quotation Submitted', 'Won, Pending KoM']),
  'Ongoing Project': Object.freeze(['PQ Submitted', 'Quotation Submitted', 'Won, Pending KoM', 'Ongoing Project']),
  'On Hold': Object.freeze(['PQ Submitted', 'Quotation Submitted', 'Won, Pending KoM', 'On Hold']),
  'Close Out': Object.freeze(['PQ Submitted', 'Quotation Submitted', 'Won, Pending KoM', 'Close Out']),
});

/** Stages reached by winning: loading one needs a contract value and the win artifacts. */
export const WON_STAGES = Object.freeze(['Won, Pending KoM', 'Ongoing Project', 'On Hold', 'Close Out']);

/** public.budget_category — budgetLoadParity.test.ts proves it equals the generated enum (AC-CSD-011). */
export const BUDGET_CATEGORIES = Object.freeze([
  'Labor', 'Materials', 'Subcontractors', 'Equipment', 'Permits & Fees', 'Overheads', 'Contingency', 'Special expenses',
]);

/** The name the app's budget import gives a version it creates (budgetDescriptor.ts). */
export const IMPORT_VERSION_NAME = 'Imported';

// TODO(#770): add service_line, sector, location, award_type, bidding_entity here once the classification
// columns land on dev — until then the load file refuses them as unknown fields.
const OPTIONAL_PROJECT_FIELDS = Object.freeze(['start_date', 'end_date', 'project_manager_id']);
const PROJECT_FIELDS = new Set([
  'code', 'name', 'client', 'end_client', 'stage', 'contract_value', 'tax_treatment', 'tax_amount', 'tax_rate',
  'tax_base_numerator', 'tax_base_denominator', 'tax_template', 'customer_contract_ref', 'contract_date', 'budget',
  ...OPTIONAL_PROJECT_FIELDS,
]);
const LINE_FIELDS = new Set(['category', 'description', 'budgeted_amount', 'fiscal_year', 'reference']);
const COMPANY_FIELDS = new Set(['name', 'short_name']);
const PROJECT_SELECT = 'id,code,name,client_id,status,contract_value,pmo_project_number';
/** PostgREST answers at most max_rows (1000) rows: a read that fills it cannot prove a key is absent. */
const READ_CAP = 1000;

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isText = (v) => typeof v === 'string' && v.trim() !== '';
const isOptionalText = (v) => v === undefined || v === null || typeof v === 'string';
const isDate = (v) =>
  typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`))
  && new Date(`${v}T00:00:00Z`).toISOString().startsWith(v);
/** numeric(14,2): finite, non-negative, below 1e12, at most two decimals. */
const isAmount = (v) =>
  typeof v === 'number' && Number.isFinite(v) && v >= 0 && v < 1e12 && Math.abs(Math.round(v * 100) - v * 100) < 1e-6;
const eq = (v) => `eq.${v}`;
const params = (o) => new URLSearchParams(o);

/** A project row's match key: the organisation's own code, else its name and client. */
export function projectKey(p) {
  return isText(p?.code) ? p.code : `${p?.name} | ${p?.client}`;
}

/** The app's budget-import key, verbatim (pmo-portal/src/lib/import/budgetDescriptor.ts; AC-CSD-011). */
export function computeBudgetLineImportKey(cells) {
  if (cells.reference.trim()) return cells.reference.trim();
  const parts = [cells.project.trim(), cells.category.trim(), cells.description.trim(), cells.fiscalYear.trim(), cells.amount.trim()];
  return `fp:${parts.join('|')}`;
}

function lineKey(key, line) {
  return computeBudgetLineImportKey({
    project: key,
    category: String(line.category ?? ''),
    description: String(line.description ?? ''),
    fiscalYear: String(line.fiscal_year ?? ''),
    amount: String(line.budgeted_amount),
    reference: String(line.reference ?? ''),
  });
}

/** The transitions still to make from `current` to `target`; null when `current` is not on the way. */
export function remainingPath(target, current) {
  const walk = ['Leads', ...LOAD_STAGE_PATHS[target]];
  const at = walk.indexOf(current);
  return at === -1 ? null : walk.slice(at + 1);
}

/** Every problem in the file, row by row; [] when it is loadable. Offline — sends nothing (AC-CSD-002). */
export function validateLoadFile(doc) {
  if (!isObject(doc)) return ['The load file must be a JSON object with a "companies" list and/or a "projects" list'];
  const problems = [];
  for (const k of Object.keys(doc)) if (k !== 'companies' && k !== 'projects') problems.push(`unknown section "${k}"`);
  const companies = doc.companies ?? [];
  const projects = doc.projects ?? [];
  if (!Array.isArray(companies)) problems.push('"companies" must be a list');
  if (!Array.isArray(projects)) problems.push('"projects" must be a list');
  if (problems.length > 0) return problems;

  const names = new Set();
  companies.forEach((c, i) => {
    const add = (m) => problems.push(`companies[${i}]: ${m}`);
    if (!isObject(c)) return add('must be an object');
    for (const k of Object.keys(c)) if (!COMPANY_FIELDS.has(k)) add(`unknown field "${k}"`);
    if (!isText(c.name)) add('"name" (the legal name) is required');
    else if (names.has(c.name)) add(`"${c.name}" appears twice`);
    else names.add(c.name);
    if (c.short_name !== undefined && !isText(c.short_name)) add('"short_name" must be text');
    return undefined;
  });

  const keys = new Set();
  projects.forEach((p, i) => {
    if (!isObject(p)) return problems.push(`projects[${i}]: must be an object`);
    const key = projectKey(p);
    const add = (m) => problems.push(`projects[${i}] (${key}): ${m}`);
    for (const k of Object.keys(p)) if (!PROJECT_FIELDS.has(k)) add(`unknown field "${k}"`);
    if (p.code !== undefined && !isText(p.code)) add('"code" must be text');
    if (!isText(p.name)) add('"name" is required');
    if (!isText(p.client)) add('"client" (the client company\'s legal name) is required');
    if (p.end_client !== undefined && !isText(p.end_client)) add('"end_client" must be a company\'s legal name');
    if (keys.has(key)) add('appears twice');
    else keys.add(key);
    if (!Object.hasOwn(LOAD_STAGE_PATHS, p.stage)) add(`"stage" must be one of: ${Object.keys(LOAD_STAGE_PATHS).join(', ')}`);
    const won = WON_STAGES.includes(p.stage);
    if (p.contract_value !== undefined) {
      if (!isAmount(p.contract_value)) add('"contract_value" must be a non-negative amount with at most 2 decimals');
      if (p.tax_treatment !== 'inclusive' && p.tax_treatment !== 'exclusive') {
        add('"tax_treatment" must be "inclusive" or "exclusive" when a contract value is given');
      }
      if (!isAmount(p.tax_amount)) {
        add('"tax_amount" must be a non-negative amount with at most 2 decimals when a contract value is given (0 = no tax)');
      }
    } else if (won) {
      add('"contract_value" is required to load a won project');
    }
    if (p.tax_rate !== undefined && !(typeof p.tax_rate === 'number' && p.tax_rate >= 0 && p.tax_rate <= 100)) {
      add('"tax_rate" must be a percentage from 0 to 100');
    }
    if ((p.tax_base_numerator === undefined) !== (p.tax_base_denominator === undefined)) {
      add('"tax_base_numerator" and "tax_base_denominator" go together');
    } else if (p.tax_base_numerator !== undefined
      && ![p.tax_base_numerator, p.tax_base_denominator].every((n) => Number.isInteger(n) && n > 0)) {
      add('"tax_base_numerator" and "tax_base_denominator" must be positive whole numbers');
    }
    if (p.tax_template !== undefined && !isText(p.tax_template)) add('"tax_template" must be text');
    if (won) {
      if (!isText(p.customer_contract_ref)) add('"customer_contract_ref" (the client\'s contract or PO number) is required to load a won project');
      if (!isDate(p.contract_date)) add('"contract_date" (YYYY-MM-DD) is required to load a won project');
    } else if (p.customer_contract_ref !== undefined || p.contract_date !== undefined) {
      add('"customer_contract_ref" and "contract_date" are recorded only when a project is won');
    }
    for (const d of ['start_date', 'end_date']) if (p[d] !== undefined && !isDate(p[d])) add(`"${d}" must be a date (YYYY-MM-DD)`);
    if (p.budget === undefined) return undefined;
    if (!Array.isArray(p.budget)) return add('"budget" must be a list of lines');
    const lineKeys = new Set();
    p.budget.forEach((l, j) => {
      const addLine = (m) => add(`budget[${j}]: ${m}`);
      if (!isObject(l)) return addLine('must be an object');
      for (const k of Object.keys(l)) if (!LINE_FIELDS.has(k)) addLine(`unknown field "${k}"`);
      if (!BUDGET_CATEGORIES.includes(l.category)) addLine(`"category" must be one of: ${BUDGET_CATEGORIES.join(', ')}`);
      if (!isAmount(l.budgeted_amount)) addLine('"budgeted_amount" must be a non-negative amount with at most 2 decimals');
      for (const k of ['description', 'fiscal_year', 'reference']) if (!isOptionalText(l[k])) addLine(`"${k}" must be text`);
      const k = lineKey(key, l);
      if (lineKeys.has(k)) addLine('is identical to an earlier line — give one of them a "reference" to keep both');
      else lineKeys.add(k);
      return undefined;
    });
    return undefined;
  });
  return problems;
}

/**
 * Read-only phase: match every company, project and budget, and return { problems, plan }. A non-empty
 * problems list means nothing may be written (FR-CSD-004).
 */
export async function resolveLoad(doc, api) {
  const problems = [];
  const owners = await api.get('external_domain_ownership', params({ select: 'domain,external_tier', domain: eq('companies') }));
  const erpOwnsCompanies = owners.length > 0;

  const found = new Map(); // legal name -> row | null | 'ambiguous'
  async function lookup(name) {
    if (!found.has(name)) {
      const rows = await api.get('companies', params({ select: 'id,name,short_name,archived_at', name: eq(name) }));
      found.set(name, rows.length === 0 ? null : rows.length === 1 ? rows[0] : 'ambiguous');
    }
    return found.get(name);
  }

  const companies = [];
  const refs = new Map(); // legal name -> the entry projects point at (its id is filled in on create)
  const unresolved = new Set(); // section companies already reported, so a project naming one adds no second problem
  for (const c of doc.companies ?? []) {
    const hit = await lookup(c.name);
    let problem = null;
    if (hit === 'ambiguous') problem = `company "${c.name}": more than one company has this legal name — resolve it in the app`;
    else if (hit?.archived_at) problem = `company "${c.name}" is archived — restore it in the app first`;
    else if (!hit && erpOwnsCompanies) {
      problem = `company "${c.name}" does not exist, and ERPNext owns companies for this organisation: create it in the app (Companies → New) or as a Customer in ERPNext, wait for it to appear in PMO, then run the load again`;
    }
    if (problem) {
      problems.push(problem);
      unresolved.add(c.name);
      continue;
    }
    const current = hit?.short_name?.trim() || null;
    const wanted = c.short_name ?? null;
    let action = 'create';
    if (hit) action = !wanted || wanted === current ? 'skip' : current === null ? 'set_short_name' : 'short_name_differs';
    const entry = { name: c.name, id: hit?.id ?? null, action, short_name: wanted, current_short_name: current };
    companies.push(entry);
    refs.set(c.name, entry);
  }

  async function companyRef(name, role, key) {
    if (refs.has(name)) return refs.get(name);
    if (unresolved.has(name)) return null;
    const hit = await lookup(name);
    if (hit && hit !== 'ambiguous' && !hit.archived_at) {
      const entry = { name, id: hit.id, action: 'existing', short_name: hit.short_name ?? null };
      refs.set(name, entry);
      return entry;
    }
    problems.push(
      hit === 'ambiguous' ? `${key}: more than one company is named "${name}" (${role}) — resolve it in the app`
        : hit ? `${key}: ${role} "${name}" is archived — restore it in the app first`
          : `${key}: ${role} "${name}" is not a company in PMO — add it to "companies"`,
    );
    return null;
  }

  const projects = [];
  for (const p of doc.projects ?? []) {
    const key = projectKey(p);
    const client = await companyRef(p.client, 'client', key);
    const endClient = p.end_client ? await companyRef(p.end_client, 'end customer', key) : null;
    if (!client || (p.end_client && !endClient)) continue;
    let rows = [];
    if (p.code) rows = await api.get('projects', params({ select: PROJECT_SELECT, code: eq(p.code) }));
    else if (client.id) rows = await api.get('projects', params({ select: PROJECT_SELECT, name: eq(p.name), client_id: eq(client.id) }));
    if (rows.length > 1) {
      problems.push(`${key}: more than one project matches — resolve it in the app`);
      continue;
    }
    const existing = rows[0] ?? null;
    if (existing && client.id && existing.client_id !== client.id) {
      problems.push(`${key}: a project with this code already exists for a different client — fix the file or the project`);
      continue;
    }
    const current = Number(existing?.contract_value ?? 0);
    const entry = {
      key, input: p, client, endClient, existing,
      id: existing?.id ?? null,
      pmo_project_number: existing?.pmo_project_number ?? null,
      path: existing ? remainingPath(p.stage, existing.status) : [...LOAD_STAGE_PATHS[p.stage]],
      value: !p.contract_value ? 'none' : current === 0 ? 'set' : current === p.contract_value ? 'same' : 'differs',
      budget: null,
    };
    if (entry.path !== null && p.budget?.length) entry.budget = await resolveBudget(api, entry, problems);
    projects.push(entry);
  }
  return { problems, plan: { erpOwnsCompanies, companies, projects } };
}

/** The app import's rule (DD-BIMP-7): the highest Draft, else a new one; skip once a budget was activated. */
async function resolveBudget(api, entry, problems) {
  const lines = entry.input.budget.map((l) => ({ ...l, import_key: lineKey(entry.key, l) }));
  if (!entry.existing) return { state: 'new', versionId: null, lines };
  const versions = await api.get('budget_versions', params({ select: 'id,status,version', project_id: eq(entry.id), order: 'version.desc' }));
  if (versions.some((v) => v.status !== 'Draft')) {
    return { state: 'skip', versionId: null, lines: [], reason: 'the project already has an active or archived budget — add lines with the budget import in the app' };
  }
  if (versions.length === 0) return { state: 'new', versionId: null, lines };
  const have = await api.get('budget_line_items', params({ select: 'import_key', budget_version_id: eq(versions[0].id), import_key: 'not.is.null' }));
  if (have.length >= READ_CAP) {
    problems.push(`${entry.key}: the draft budget has too many lines to check — finish it in the app`);
    return { state: 'skip', versionId: null, lines: [], reason: 'too many lines to check' };
  }
  const loaded = new Set(have.map((r) => r.import_key));
  return { state: 'attach', versionId: versions[0].id, lines: lines.filter((l) => !loaded.has(l.import_key)) };
}

function projectPayload(e) {
  const p = e.input;
  const body = { name: p.name, status: 'Leads', client_id: e.client.id };
  if (p.code !== undefined) body.code = p.code;
  if (e.endClient) body.end_client_id = e.endClient.id;
  for (const k of OPTIONAL_PROJECT_FIELDS) if (p[k] !== undefined) body[k] = p[k];
  return body;
}

function valueArgs(id, p) {
  const args = { p_id: id, p_value: p.contract_value, p_tax_treatment: p.tax_treatment, p_tax_amount: p.tax_amount };
  if (p.tax_rate !== undefined) args.p_tax_rate = p.tax_rate;
  if (p.tax_template !== undefined) args.p_tax_template = p.tax_template;
  if (p.tax_base_numerator !== undefined) args.p_tax_base_numerator = p.tax_base_numerator;
  if (p.tax_base_denominator !== undefined) args.p_tax_base_denominator = p.tax_base_denominator;
  return args;
}

function transitionArgs(e, to) {
  const args = { p_id: e.id, p_to: to };
  if (to === 'Won, Pending KoM') {
    args.p_customer_contract_ref = e.input.customer_contract_ref;
    args.p_contract_date = e.input.contract_date;
  }
  return args;
}

/**
 * Write phase. Runs the plan in order; with dryRun it only lists the actions. On the first refusal it
 * rethrows the server's error with err.loadReport = { done, failed } (FR-CSD-011).
 */
export async function applyLoad(plan, api, { dryRun, batchId = crypto.randomUUID(), importedAt = new Date().toISOString() }) {
  const done = [];
  const note = (action) => done.push(action);
  async function write(action, run) {
    if (dryRun) {
      done.push(action);
      return;
    }
    try {
      done.push({ ...action, ...((await run()) ?? {}) });
    } catch (err) {
      err.loadReport = { done: [...done], failed: action };
      throw err;
    }
  }

  for (const c of plan.companies) {
    if (c.action === 'create') {
      await write({ kind: 'company.create', name: c.name }, async () => {
        const [row] = await api.post('companies', { name: c.name, type: 'Client', ...(c.short_name ? { short_name: c.short_name } : {}) });
        c.id = row.id;
        return { id: row.id };
      });
    } else if (c.action === 'set_short_name') {
      await write({ kind: 'company.set_short_name', name: c.name, id: c.id, short_name: c.short_name }, async () => {
        const rows = await api.patch('companies', params({ id: eq(c.id) }), { short_name: c.short_name });
        // #541: an RLS-hidden row is a 0-row PATCH with no error — say so instead of reporting success.
        if (!rows?.length) throw Object.assign(new Error(`The short name of "${c.name}" was not changed — the database did not allow it`), { code: 'no_rows' });
      });
    } else if (c.action === 'short_name_differs') {
      note({ kind: 'company.short_name_differs', name: c.name, id: c.id, current: c.current_short_name, file: c.short_name });
    } else {
      note({ kind: 'company.skip', name: c.name, id: c.id });
    }
  }

  for (const e of plan.projects) {
    if (e.path === null) {
      note({ kind: 'project.diverged', key: e.key, id: e.id, status: e.existing.status, stage: e.input.stage });
      continue;
    }
    if (e.existing) {
      note({ kind: 'project.skip', key: e.key, id: e.id, pmo_project_number: e.pmo_project_number });
    } else {
      await write({ kind: 'project.create', key: e.key }, async () => {
        const [row] = await api.post('projects', projectPayload(e));
        e.id = row.id;
        e.pmo_project_number = row.pmo_project_number ?? null;
        return { id: e.id, pmo_project_number: e.pmo_project_number };
      });
    }
    if (e.value === 'set') {
      await write({ kind: 'project.contract_value', key: e.key, value: e.input.contract_value }, async () => {
        await api.rpc('set_project_contract_value', valueArgs(e.id, e.input));
      });
    } else if (e.value === 'differs') {
      note({ kind: 'project.contract_value_differs', key: e.key, id: e.id, current: Number(e.existing.contract_value), file: e.input.contract_value });
    }
    for (const to of e.path) {
      await write({ kind: 'project.transition', key: e.key, to }, async () => {
        await api.rpc('transition_project', transitionArgs(e, to));
      });
    }
    if (e.budget) await applyBudget(e, api, write, note, { batchId, importedAt });
  }
  return done;
}

async function applyBudget(e, api, write, note, { batchId, importedAt }) {
  if (e.budget.state === 'skip') return note({ kind: 'budget.skip', key: e.key, id: e.id, reason: e.budget.reason });
  if (e.budget.lines.length === 0) return note({ kind: 'budget.skip', key: e.key, id: e.id, reason: 'every line is already in the draft' });
  let versionId = e.budget.versionId;
  if (!versionId) {
    // `status` is omitted on purpose: the column default is Draft and the 0176 trigger refuses anything else.
    await write({ kind: 'budget.version', key: e.key, name: IMPORT_VERSION_NAME }, async () => {
      const [v] = await api.post('budget_versions', {
        project_id: e.id, version: 1, name: IMPORT_VERSION_NAME, import_batch_id: batchId, imported_at: importedAt,
      });
      versionId = v.id;
      return { version_id: v.id };
    });
  }
  return write({ kind: 'budget.lines', key: e.key, count: e.budget.lines.length }, async () => {
    let created = 0;
    let skipped = 0;
    for (const l of e.budget.lines) {
      try {
        // `actual_amount` is never sent: actuals are read from the ERP read-model (FR-BIMP-005).
        await api.post('budget_line_items', {
          budget_version_id: versionId, category: l.category, description: l.description ?? null,
          budgeted_amount: l.budgeted_amount, fiscal_year: l.fiscal_year ?? null,
          import_batch_id: batchId, imported_at: importedAt, import_key: l.import_key,
        });
        created += 1;
      } catch (err) {
        if (err.code !== '23505') throw err; // 0195's index: already loaded — a skip, as in the app import
        skipped += 1;
      }
    }
    return { version_id: versionId, created, skipped };
  });
}

/** { kind: count } for the report. */
export function countActions(actions) {
  const counts = {};
  for (const a of actions) counts[a.kind] = (counts[a.kind] ?? 0) + 1;
  return counts;
}
