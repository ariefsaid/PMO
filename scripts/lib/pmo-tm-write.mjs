/**
 * `pmo tm` writes (#1856): the rate card, assignments, claim assembly, deselection, withdrawal and the sign-off preparation.
 * Each command reads the current state, plans, and prints the plan; only `--apply` sends its RPC — the same RPC, with the
 * same argument names, the app's data layer sends (pmo-portal/src/lib/db/timeAndMaterials.ts). The database decides every
 * amount, role and separation-of-duties rule; nothing here prices an hour or sends an org, an author or an amount.
 * Spec: docs/specs/cli-time-and-materials.spec.md · plan docs/plans/2026-11-16-cli-time-and-materials.md.
 * Node 22 standard library only.
 */
import crypto from 'node:crypto';

import { MAX_RATE_ROWS, RATE_LINE_COLUMNS, TmQueryError, isCalendarDate, projectProblem, summarisePreview, validatePreview } from './pmo-tm.mjs';

/** The database's T&M write tier — keep in step with `tm_write_rpcs` in `api_client_request_guard`. */
export const TM_WRITE_RPCS = Object.freeze([
  'assemble_tm_claim', 'confirm_tm_signoff', 'deselect_tm_source', 'end_contract_rate_assignee', 'end_contract_rate_line',
  'prepare_tm_signoff', 'save_contract_rate_line', 'set_contract_rate_assignee', 'withdraw_tm_signoff',
]);
export const TM_WRITER_ROLES = Object.freeze(['Admin', 'Finance']);
export const TM_SCREEN = 'Project → Contract & billing → Time and materials';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const given = (value) => value !== undefined && value !== null;

const WRITE_HEADLINES = {
  42501: 'Not allowed (role or separation of duties)',
  22023: 'Invalid input',
  23505: 'Conflicts with an existing record',
  23514: 'Does not match the project or its document',
  40001: 'Changed since it was read: re-read with `pmo tm rates list` and run again',
  55000: 'Not ready to proceed',
  P0001: "Refused in the claim's current state",
  P0002: 'Not found',
};

/** A headline for a refused write, then the database's own message verbatim (FR-CTM-006). */
export function explainWriteError(error) {
  const head = WRITE_HEADLINES[error?.code];
  if (!head) return error?.message ?? String(error);
  return error.message ? `${head}: ${error.message}` : head;
}

/** A write whose outcome is unknown (the connection failed): never retried; `check` is the read that shows the truth. */
export class TmOutcomeUnknown extends Error {
  constructor(check) {
    super(`The write may or may not have been saved: the connection failed before an answer came back. Do not rerun it blindly; check with \`${check}\`.`);
    this.check = check;
  }
}

/** The one write a step makes. A failure with no HTTP status and no code never reached an answer (FR-CTM-008). */
async function write(api, name, body, check) {
  try {
    return await api.rpc(name, body);
  } catch (error) {
    if (error?.status === undefined && error?.code === undefined) throw new TmOutcomeUnknown(check);
    throw error;
  }
}

/** null when the signed-in member may run T&M writes; otherwise the refusal (FR-CTM-004). */
export function writerRefusal(profile, command) {
  if (TM_WRITER_ROLES.includes(profile?.role) && profile?.status === 'active') return null;
  const who = `${profile?.status && profile.status !== 'active' ? `${profile.status} ` : ''}${profile?.role ?? 'unknown role'}`;
  return `pmo tm ${command} is for an active Admin or Finance member (you are ${who}). Use the app instead: ${TM_SCREEN}.`;
}

const RATE_KEYS = Object.freeze(['project_id', 'line_key', 'expected_version', 'kind', 'asset_id', 'label', 'unit', 'rate', 'standby_rate', 'currency', 'effective_from', 'effective_to', 'sales_item_code']);
const MONEY = /^\d+(\.\d{1,2})?$/;
const isMoney = (value) => typeof value === 'number' && Number.isFinite(value) && value < 1e12 && MONEY.test(String(value));
const MONEY_RULE = 'must be a number, zero or more, below 1000000000000, with at most 2 decimals';

/** Every reason a rate-line row is refused before anything is sent (the server re-checks each one). */
export function rateRowProblems(row) {
  if (row === null || typeof row !== 'object' || Array.isArray(row)) return ['each rate line must be a JSON object'];
  const problems = Object.keys(row).filter((key) => !RATE_KEYS.includes(key))
    .map((key) => `"${key}" is not a rate-line field (the server sets the organisation, the author and the version)`);
  if (!UUID.test(String(row.project_id ?? ''))) problems.push('project_id must be a project id (uuid)');
  if (!['labour', 'equipment'].includes(row.kind)) problems.push('kind must be labour or equipment');
  const label = typeof row.label === 'string' ? row.label.trim() : '';
  if (label.length < 1 || label.length > 120) problems.push('label is required (at most 120 characters)');
  if (!['hour', 'day'].includes(row.unit)) problems.push('unit must be hour or day');
  if (!isMoney(row.rate)) problems.push(`rate ${MONEY_RULE}`);
  if (row.kind === 'equipment') {
    if (!UUID.test(String(row.asset_id ?? ''))) problems.push('asset_id (uuid) is required for an equipment line');
    if (given(row.standby_rate) && !isMoney(row.standby_rate)) problems.push(`standby_rate ${MONEY_RULE}`);
  } else if (given(row.asset_id) || given(row.standby_rate)) {
    problems.push('asset_id and standby_rate are only for equipment lines');
  }
  if (typeof row.currency !== 'string' || !/^[A-Z]{3}$/.test(row.currency)) problems.push('currency must be a three-letter code');
  if (!isCalendarDate(row.effective_from)) problems.push('effective_from must be a date (YYYY-MM-DD)');
  if (given(row.effective_to) && (!isCalendarDate(row.effective_to) || row.effective_to < row.effective_from)) {
    problems.push('effective_to must be a date on or after effective_from');
  }
  if (given(row.sales_item_code) && (typeof row.sales_item_code !== 'string' || row.sales_item_code.trim().length > 140 || /\p{Cc}/u.test(row.sales_item_code))) {
    problems.push('sales_item_code must be text of at most 140 characters, with no control characters');
  }
  if ((row.line_key === undefined) !== (row.expected_version === undefined)) {
    problems.push('an edit names both line_key and expected_version (from `pmo tm rates list`); a new line names neither');
  }
  if (row.line_key !== undefined && !UUID.test(String(row.line_key))) problems.push('line_key must be a uuid');
  if (row.expected_version !== undefined && !(Number.isInteger(row.expected_version) && row.expected_version > 0)) {
    problems.push('expected_version must be a positive whole number');
  }
  return problems;
}

/** The plan reads the rate card with the sales-item code too, so an unchanged mapping is recognised. */
export const RATE_PLAN_COLUMNS = Object.freeze([...RATE_LINE_COLUMNS, 'sales_item_code']);

/** Bounded read: one more than the bound is asked for, and a full answer is refused rather than planned from (NFR-CTM-003). */
async function readBounded(api, table, query, what) {
  query.set('limit', String(MAX_RATE_ROWS + 1));
  const rows = await api.get(table, query);
  const list = Array.isArray(rows) ? rows : [];
  if (list.length > MAX_RATE_ROWS) {
    throw new TmQueryError([`these projects have more than ${MAX_RATE_ROWS} ${what}; the CLI will not plan from a partial list. Use the app: ${TM_SCREEN}`]);
  }
  return list;
}

async function readCurrentLines(api, projects) {
  const query = new URLSearchParams({ select: RATE_PLAN_COLUMNS.join(','), project_id: `in.(${projects.join(',')})`, is_current: 'eq.true', order: 'project_id.asc,label.asc' });
  return (await readBounded(api, 'contract_rate_lines', query, 'current rate lines')).filter((line) => line.is_current);
}

async function readProjectCurrencies(api, projects) {
  const rows = await api.get('projects', new URLSearchParams({ select: 'id,currency', id: `in.(${projects.join(',')})` }));
  return new Map((Array.isArray(rows) ? rows : []).map((row) => [row.id, row.currency]));
}

const projectsOf = (rows) => [...new Set(rows.map((row) => String(row?.project_id ?? '').toLowerCase()).filter((id) => UUID.test(id)))];

function sameContent(row, line) {
  const norm = (value) => (given(value) ? value : null);
  const money = (value) => (given(value) ? Number(value) : null);
  return row.kind === line.kind && norm(row.asset_id) === norm(line.asset_id) && row.label.trim() === line.label
    && row.unit === line.unit && money(row.rate) === money(line.rate) && money(row.standby_rate) === money(line.standby_rate)
    && row.effective_from === line.effective_from && norm(row.effective_to) === norm(line.effective_to)
    && (!('sales_item_code' in row) || norm(row.sales_item_code?.trim() || null) === norm(line.sales_item_code));
}

/** Each row as create | new version | unchanged | refused, against the current card (FR-CTM-011, FR-CTM-012). */
export async function planRates(api, rows) {
  if (!Array.isArray(rows) || rows.length === 0) throw new TmQueryError(['the rates file must be a non-empty JSON array of rate lines']);
  const projects = projectsOf(rows);
  const card = projects.length ? await readCurrentLines(api, projects) : [];
  const currencies = projects.length ? await readProjectCurrencies(api, projects) : new Map();
  const newLabels = new Set();
  return rows.map((row, index) => {
    const refused = (...problems) => ({ index, action: 'refused', problems });
    const problems = rateRowProblems(row);
    if (problems.length) return refused(...problems);
    const project = row.project_id.toLowerCase();
    const currency = currencies.get(project);
    if (!currency) return refused('project not found (or not visible to you)');
    if (row.currency !== currency) return refused(`currency ${row.currency} is not the project's currency (${currency})`);
    if (row.line_key === undefined) {
      if (row.kind === 'labour') {
        const label = row.label.trim().toLowerCase();
        const key = `${project}|${label}`;
        if (newLabels.has(key) || card.some((line) => line.project_id === project && line.kind === 'labour' && line.label.toLowerCase() === label)) {
          return refused(`the project already has a current labour line labelled "${row.label.trim()}": edit it with its line_key and expected_version (\`pmo tm rates list --project ${project}\`)`);
        }
        newLabels.add(key);
      }
      return { index, action: 'create', line_key: crypto.randomUUID(), send: row };
    }
    const lineKey = row.line_key.toLowerCase();
    const current = card.find((line) => line.project_id === project && line.line_key === lineKey);
    if (!current) return refused(`no current rate line has this line_key on the project; list them with \`pmo tm rates list --project ${project}\``);
    if (sameContent(row, current)) return { index, action: 'unchanged', line_key: lineKey, version: current.version };
    if (row.expected_version !== current.version) {
      return refused(`the line is at version ${current.version}, the file expects ${row.expected_version}: re-read with \`pmo tm rates list --project ${project}\``);
    }
    if (row.kind !== current.kind || (row.asset_id ?? null) !== (current.asset_id ?? null)) {
      return refused('a rate line keeps its kind and asset: end it in the app and add a new line');
    }
    return { index, action: 'new version', line_key: lineKey, send: row };
  });
}

/** `tm rates set <file>`: every row in ONE save_contract_rate_line call, or nothing (Q5). */
export async function setRates(api, rows, { apply }) {
  const plan = await planRates(api, rows);
  const shown = plan.map(({ send, ...row }) => row);
  const refused = plan.filter((row) => row.action === 'refused').length;
  const toSend = plan.filter((row) => row.send);
  if (refused > 0) {
    return { exit: 2, result: { applied: false, rows: shown, note: `Nothing was sent: ${refused} row(s) refused. The file saves completely or not at all; fix them and run again.` } };
  }
  if (toSend.length === 0) return { exit: 0, result: { applied: false, rows: shown, note: 'Nothing to save: every row matches the current rate card.' } };
  if (!apply) {
    return { exit: 0, result: { applied: false, rows: shown, next: 'Run the same command with --apply to save these rows in one transaction. A new line keeps the line_key printed by --apply.' } };
  }
  const lines = toSend.map((row) => ({ ...row.send, line_key: row.line_key }));
  const saved = await write(api, 'save_contract_rate_line', { p_line: lines }, `pmo tm rates list --project ${lines[0].project_id}`);
  const keys = new Set(lines.map((line) => line.line_key));
  const current = (await readCurrentLines(api, projectsOf(lines))).filter((line) => keys.has(line.line_key));
  return { exit: 0, result: { applied: true, rows: shown, saved, current } };
}

const ASSIGN_KEYS = Object.freeze(['project_id', 'line_key', 'user_id', 'effective_from', 'effective_to']);

export function assignRowProblems(row) {
  if (row === null || typeof row !== 'object' || Array.isArray(row)) return ['each assignment must be a JSON object'];
  const problems = Object.keys(row).filter((key) => !ASSIGN_KEYS.includes(key)).map((key) => `"${key}" is not an assignment field`);
  if (!UUID.test(String(row.project_id ?? ''))) problems.push('project_id must be a project id (uuid)');
  if (!UUID.test(String(row.line_key ?? ''))) problems.push('line_key must be a rate line key (uuid) from `pmo tm rates list`');
  if (!UUID.test(String(row.user_id ?? ''))) problems.push('user_id must be a person id (uuid); list them with `pmo get profiles`');
  if (!isCalendarDate(row.effective_from)) problems.push('effective_from must be a date (YYYY-MM-DD)');
  if (given(row.effective_to) && (!isCalendarDate(row.effective_to) || row.effective_to < row.effective_from)) {
    problems.push('effective_to must be a date on or after effective_from');
  }
  return problems;
}

async function readAssignees(api, projects) {
  const query = new URLSearchParams({ select: 'id,project_id,line_key,user_id,effective_from,effective_to', project_id: `in.(${projects.join(',')})`, order: 'project_id.asc,user_id.asc' });
  return readBounded(api, 'contract_rate_assignees', query, 'assignments');
}

const OPEN_END = '9999-12-31';

/** `tm assign set <file>`: one set_contract_rate_assignee per row; a refused row does not stop the rest (FR-CTM-014/015). */
export async function setAssignees(api, rows, { apply }) {
  if (!Array.isArray(rows) || rows.length === 0) throw new TmQueryError(['the assignments file must be a non-empty JSON array']);
  const valid = rows.filter((row) => assignRowProblems(row).length === 0);
  const projects = projectsOf(valid);
  const users = [...new Set(valid.map((row) => row.user_id.toLowerCase()))];
  const lines = projects.length ? await readCurrentLines(api, projects) : [];
  const held = projects.length ? await readAssignees(api, projects) : [];
  const members = users.length ? await api.get('profiles', new URLSearchParams({ select: 'id,status', id: `in.(${users.join(',')})` })) : [];
  const active = new Set((Array.isArray(members) ? members : []).filter((member) => member.status === 'active').map((member) => member.id));
  const plan = rows.map((row, index) => {
    const problems = assignRowProblems(row);
    if (problems.length) return { index, action: 'refused', problems };
    const [project, lineKey, user] = [row.project_id, row.line_key, row.user_id].map((id) => id.toLowerCase());
    const to = row.effective_to ?? null;
    if (held.some((a) => a.project_id === project && a.line_key === lineKey && a.user_id === user && a.effective_from === row.effective_from && (a.effective_to ?? null) === to)) {
      return { index, action: 'skip', reason: 'this assignment already exists' };
    }
    const warnings = [];
    if (!active.has(user)) warnings.push('not an active member of the organisation: the server will refuse this row');
    if (!lines.some((line) => line.project_id === project && line.line_key === lineKey && line.kind === 'labour')) {
      warnings.push('not a current labour line on this project: the server will refuse this row');
    }
    const clash = held.find((a) => a.project_id === project && a.user_id === user && a.effective_from <= (to ?? OPEN_END) && row.effective_from <= (a.effective_to ?? OPEN_END));
    if (clash) warnings.push(`overlaps this person's assignment from ${clash.effective_from}${clash.effective_to ? ` to ${clash.effective_to}` : ''}: the server will refuse this row`);
    const body = { p_project: project, p_line_key: lineKey, p_user: user, p_from: row.effective_from, p_to: to };
    return { index, action: 'create', ...(warnings.length ? { warnings } : {}), body };
  });
  const shown = () => plan.map(({ body, ...row }) => row);
  if (!apply) {
    return { exit: plan.some((row) => row.action === 'refused') ? 2 : 0, result: { applied: false, rows: shown(), next: 'Run the same command with --apply. Each row is saved on its own; a refused row does not stop the others.' } };
  }
  for (const step of plan.filter((row) => row.body)) {
    try {
      step.assignment_id = await write(api, 'set_contract_rate_assignee', step.body, `pmo tm rates list --project ${step.body.p_project} --assignees`);
      step.action = 'created';
    } catch (error) {
      if (error instanceof TmOutcomeUnknown) throw error;
      Object.assign(step, { action: 'refused', code: error.code, problems: [explainWriteError(error)] });
    }
  }
  return { exit: plan.some((row) => row.action === 'refused') ? 1 : 0, result: { applied: true, rows: shown() } };
}

const readClaims = async (api, project) => {
  const rows = await api.rpc('list_tm_claims', { p_project: project });
  return Array.isArray(rows) ? rows : [];
};

/** `tm claim assemble`: preview the window, refuse a second Draft for it, then assemble once (FR-CTM-020..022). */
export async function assembleClaim(api, { project, from, to, workOrder }, { apply }) {
  const body = validatePreview({ project, from, to });
  if (given(workOrder)) {
    if (!UUID.test(String(workOrder))) throw new TmQueryError(['--work-order must be a work order id (uuid)']);
    body.p_work_order = String(workOrder).toLowerCase();
  }
  const preview = summarisePreview(await api.rpc('preview_tm_claim', { p_project: body.p_project, p_from: body.p_from, p_to: body.p_to }));
  const existing = (await readClaims(api, body.p_project)).find((claim) => claim.status === 'Draft'
    && (claim.work_order_id ?? null) === (body.p_work_order ?? null) && claim.period_from <= body.p_to && body.p_from <= claim.period_to);
  if (existing) return { exit: 0, result: { status: 'already_assembled', claim: existing, note: 'A Draft claim already covers this window; nothing was sent.' } };
  if (!apply) return { exit: 0, result: { applied: false, preview, next: 'Run the same command with --apply to assemble this Draft claim.' } };
  const claimId = await write(api, 'assemble_tm_claim', body, `pmo tm claim list --project ${body.p_project}`);
  const claim = (await readClaims(api, body.p_project)).find((row) => row.id === claimId) ?? null;
  const result = { applied: true, claim_id: claimId, claim };
  const assembled = claim ? Number(claim.gross_amount).toFixed(2) : null;
  if (assembled !== preview.total) {
    result.warning = { total_changed: { preview: preview.total, assembled }, note: 'Hours were approved or changed between the preview and the assembly: review the claim before preparing its sign-off.' };
  }
  return { exit: 0, result };
}

function claimId(claim) {
  if (!UUID.test(String(claim ?? ''))) throw new TmQueryError(['name the claim: <claim-id> (uuid) from `pmo tm claim list --project <id>`']);
  return String(claim).toLowerCase();
}

const readSources = async (api, claim) => {
  const rows = await api.rpc('list_tm_claim_source_details', { p_claim: claim });
  return Array.isArray(rows) ? rows : [];
};

/** `tm claim sources <claim>` (read): each source and whether a prepared sign-off still matches the claim. */
export async function claimSources(api, { claim }) {
  const id = claimId(claim);
  const sources = await readSources(api, id);
  return {
    claim_id: id,
    signoff_is_current: sources[0]?.signoff_is_current ?? null,
    sources: sources.map((s) => ({ source_id: s.id, date: s.entry_date, who: s.person_name ?? s.asset_name ?? s.person_id ?? s.asset_id, units: s.units, unit: s.unit, line: s.line_label, basis: s.basis, in_claim: s.is_selected })),
  };
}

/** D3: a claim is found only in its named project's list, before any write. */
async function findClaim(api, { claim, project }) {
  const problems = [];
  if (!UUID.test(String(claim ?? ''))) problems.push('name the claim: <claim-id> (uuid) from `pmo tm claim list --project <id>`');
  const problem = projectProblem(project);
  if (problem) problems.push(problem);
  if (problems.length) throw new TmQueryError(problems);
  const [id, projectId] = [String(claim).toLowerCase(), String(project).toLowerCase()];
  const found = (await readClaims(api, projectId)).find((row) => row.id === id);
  if (!found) throw new TmQueryError([`no claim ${id} on project ${projectId}: list them with \`pmo tm claim list --project ${projectId}\``]);
  return found;
}

const claimView = (claim) => ({ claim_id: claim.id, status: claim.status, period: `${claim.period_from} → ${claim.period_to}`, currency: claim.currency, gross_amount: claim.gross_amount, lines: claim.lines });

/** `tm claim deselect <claim> <source>…`: one deselect_tm_source per source still in the Draft claim. */
export async function deselectSources(api, { claim, project, sources }, { apply }) {
  const found = await findClaim(api, { claim, project });
  const ids = (sources ?? []).map((id) => String(id).toLowerCase());
  if (ids.length === 0 || ids.some((id) => !UUID.test(id))) throw new TmQueryError(['name one or more source ids (uuid) from `pmo tm claim sources <claim-id>`']);
  if (found.status !== 'Draft') throw new TmQueryError([`only a Draft claim can be changed (this one is ${found.status})`]);
  const details = await readSources(api, found.id);
  const plan = ids.map((id) => {
    const source = details.find((row) => row.id === id);
    if (!source || !source.is_selected) return { source_id: id, action: 'skip', reason: source ? 'already out of the claim' : 'not a source of this claim' };
    return { source_id: id, action: 'deselect', date: source.entry_date, who: source.person_name ?? source.asset_name, units: source.units, unit: source.unit, line: source.line_label };
  });
  if (!apply) return { exit: 0, result: { applied: false, claim: claimView(found), sources: plan, next: 'Run the same command with --apply to take these sources out of the claim.' } };
  for (const step of plan.filter((row) => row.action === 'deselect')) {
    await write(api, 'deselect_tm_source', { p_claim: found.id, p_source: step.source_id }, `pmo tm claim sources ${found.id}`);
  }
  return { exit: 0, result: { applied: true, sources: plan, claim: claimView(await findClaim(api, { claim: found.id, project })) } };
}

/** `tm claim withdraw <claim>`: withdraw_tm_signoff once; a Withdrawn claim is reported, not withdrawn twice. */
export async function withdrawClaim(api, { claim, project }, { apply }) {
  const found = await findClaim(api, { claim, project });
  if (found.status === 'Withdrawn') return { exit: 0, result: { status: 'already_withdrawn', claim_id: found.id } };
  const live = (await readSources(api, found.id)).filter((row) => row.is_selected).length;
  const releases = `${live} source(s) become claimable again${found.status === 'SignedOff' ? '; a signed-off claim with an invoice, or an ERP raise in flight, is refused: cancel the invoice instead' : ''}`;
  if (!apply) return { exit: 0, result: { applied: false, claim: claimView(found), releases, next: 'Run the same command with --apply to withdraw the claim.' } };
  await write(api, 'withdraw_tm_signoff', { p_claim: found.id }, `pmo tm claim list --project ${String(project).toLowerCase()}`);
  const after = await findClaim(api, { claim: found.id, project });
  return { exit: 0, result: { applied: true, claim_id: found.id, status: after.status } };
}

async function readDocument(api, id) {
  const rows = await api.get('project_documents', new URLSearchParams({ select: 'id,project_id,title,revision,status,file_path', id: `eq.${id}` }));
  return Array.isArray(rows) ? rows[0] ?? null : null;
}

/** Why the sign-off would be refused at confirmation with this document (the server re-checks both then). */
function documentWarnings(doc) {
  const warnings = [];
  if (!['Issued', 'Approved'].includes(doc.status)) warnings.push(`the document is ${doc.status}: confirmation will refuse it until it is Issued or Approved (Project → Documents)`);
  if (!String(doc.file_path ?? '').trim()) warnings.push('the document has no file: confirmation will refuse it until one is uploaded (`pmo documents upload`)');
  return warnings;
}

const documentView = (doc) => ({ document_id: doc.id, title: doc.title, revision: doc.revision, status: doc.status, has_file: Boolean(String(doc.file_path ?? '').trim()) });

/** `tm signoff prepare <claim> --document <id>`: prepare_tm_signoff once (FR-CTM-030). */
export async function prepareSignoff(api, { claim, project, document, note }, { apply }) {
  const found = await findClaim(api, { claim, project });
  const problems = [];
  if (!UUID.test(String(document ?? ''))) problems.push('--document must be the signed project document id (uuid) from `pmo documents list --project <id>`');
  const text = typeof note === 'string' ? note.trim() : '';
  if (text.length > 500) problems.push('--note may have at most 500 characters');
  if (found.status !== 'Draft') problems.push(`only a Draft claim can be prepared for sign-off (this one is ${found.status})`);
  const doc = problems.length ? null : await readDocument(api, String(document).toLowerCase());
  if (!problems.length && !doc) problems.push('document not found (or not visible to you)');
  // list_tm_claims carries no project id: the claim was found under --project, so the document must be on that project.
  if (doc && doc.project_id !== String(project).toLowerCase()) problems.push("the sign-off document must belong to the claim's project");
  if (problems.length) throw new TmQueryError(problems);
  const warnings = documentWarnings(doc);
  const body = { p_claim: found.id, p_document: doc.id, ...(text ? { p_note: text } : {}) };
  if (!apply) return { exit: 0, result: { applied: false, claim: claimView(found), document: documentView(doc), warnings, next: 'Run the same command with --apply to prepare the sign-off.' } };
  await write(api, 'prepare_tm_signoff', body, `pmo tm claim sources ${found.id}`);
  const after = await findClaim(api, { claim: found.id, project });
  const current = (await readSources(api, found.id))[0]?.signoff_is_current ?? null;
  return { exit: 0, result: { applied: true, claim_id: found.id, prepared_by: after.signoff_prepared_by, document_id: after.document_id, signoff_is_current: current, warnings } };
}
