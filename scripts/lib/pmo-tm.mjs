/**
 * `pmo tm` (#1514): versioned contract rates and time-and-materials claims.
 *
 * The rate card is read from `contract_rate_lines` / `contract_rate_assignees` under RLS (an active Admin, Finance or
 * Executive member, or the project's Project Manager); the claims go through the two reads 0518 adds — `list_tm_claims`
 * and `preview_tm_claim` — which decide the amounts audience themselves. Nothing here prices an hour: `preview_tm_claim`
 * groups the approved, unclaimed sources exactly as the assembly would, and it writes nothing. This module only shapes the
 * calls, the text and the refusals that can be made before a request is sent.
 *
 * Contract: docs/specs/time-and-materials-claims.spec.md §4 AC-6 (FR-TM-051), plan T9. Node 22 standard library only.
 */

/** The database's T&M read tier — keep in step with `tm_read_rpcs` in `api_client_request_guard`. */
export const TM_READ_RPCS = Object.freeze(['list_tm_claim_source_details', 'list_tm_claims', 'preview_tm_claim']);

/** The rate-card columns the CLI reads: no `org_id`, no `created_by`, nothing a reader does not need. */
export const RATE_LINE_COLUMNS = Object.freeze([
  'project_id', 'line_key', 'version', 'is_current', 'kind', 'asset_id', 'label', 'unit', 'rate', 'standby_rate', 'effective_from', 'effective_to', 'applies_to',
]);
export const RATE_ASSIGNEE_COLUMNS = Object.freeze(['project_id', 'line_key', 'user_id', 'effective_from', 'effective_to']);
/** PostgREST truncates at 1000 rows by default; ask for that many explicitly so the bound is visible. */
export const MAX_RATE_ROWS = 1000;
/** A claim preview prices approved sources; a window wider than two years is a mistake, not a report. */
export const MAX_CLAIM_RANGE_DAYS = 731;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** A query the CLI refuses before anything is sent; `problems` lists every reason. */
export class TmQueryError extends Error {
  constructor(problems) {
    super(problems.join('; '));
    this.problems = problems;
  }
}

function isCalendarDate(value) {
  if (typeof value !== 'string' || !DATE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function projectProblem(project) {
  if (project === undefined || project === null || String(project).trim() === '') return 'name a project with --project <id>';
  if (!UUID.test(String(project))) return '--project must be a project id (uuid)';
  return null;
}

/** `tm claim list --project <id>` → the RPC body. */
export function validateClaimList({ project }) {
  const problem = projectProblem(project);
  if (problem) throw new TmQueryError([problem]);
  return { p_project: String(project).toLowerCase() };
}

/** `tm claim preview --project <id> --from <date> --to <date>` → the RPC body. */
export function validatePreview({ project, from, to }) {
  const problems = [];
  const problem = projectProblem(project);
  if (problem) problems.push(problem);
  if (!isCalendarDate(from)) problems.push('--from must be a date (YYYY-MM-DD)');
  if (!isCalendarDate(to)) problems.push('--to must be a date (YYYY-MM-DD)');
  if (isCalendarDate(from) && isCalendarDate(to)) {
    const days = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000;
    if (days < 0) problems.push('--to must be on or after --from');
    else if (days > MAX_CLAIM_RANGE_DAYS) problems.push('the preview window may not exceed two years');
  }
  if (problems.length > 0) throw new TmQueryError(problems);
  return { p_project: String(project).toLowerCase(), p_from: from, p_to: to };
}

/** `tm rates list [--project <id>] [--assignees]` → the project filter (or null for the whole visible card). */
export function validateRatesList({ project }) {
  if (project === undefined || project === null || String(project).trim() === '') return { project_id: null };
  if (!UUID.test(String(project))) throw new TmQueryError(['--project must be a project id (uuid)']);
  return { project_id: String(project).toLowerCase() };
}

const MESSAGES = {
  42501: "Not allowed: T&M amounts are for an active Admin, Finance, Executive or the project's Project Manager member.",
  22023: 'The time-and-materials query is not valid',
  P0002: 'Not found',
};

/** A clear message for a database refusal; keeps the database's own reason after a colon. */
export function explainError(error) {
  const base = MESSAGES[error?.code];
  if (!base) return error?.message ?? String(error);
  // A refusal here is directional (the wrong role, or a read the API-client surface does not carry yet): keep the
  // database's own words so the reader knows which one it was.
  if (error.code === '42501') return error.message ? `${base} (${error.message})` : base;
  return error.message ? `${base}: ${error.message}` : base;
}

/** Preview the approved, unclaimed sources: { lines, unrated, total }. Reads only — writes nothing. */
export async function previewClaim(api, { project, from, to }) {
  const rows = await api.rpc('preview_tm_claim', validatePreview({ project, from, to }));
  return summarisePreview(rows);
}

/** Split the preview rows into the priced lines and the listed-but-unrated rows; the total sums the priced ones only. */
export function summarisePreview(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const lines = list.filter((row) => !row.unrated_reason);
  return { lines, unrated: list.filter((row) => row.unrated_reason), total: total(lines) };
}

/** A project's claims with their frozen lines. */
export async function listClaims(api, { project }) {
  const rows = await api.rpc('list_tm_claims', validateClaimList({ project }));
  return Array.isArray(rows) ? rows : [];
}

/** The visible rate card (and, with `assignees`, who holds each line). Table reads, RLS-scoped. */
export async function readRateCard(api, { project, assignees }) {
  const { project_id } = validateRatesList({ project });
  const rates = await api.get('contract_rate_lines', rateQuery(project_id, RATE_LINE_COLUMNS, 'project_id.asc,label.asc,version.asc'));
  const holders = assignees
    ? await api.get('contract_rate_assignees', rateQuery(project_id, RATE_ASSIGNEE_COLUMNS, 'project_id.asc,user_id.asc,effective_from.asc'))
    : [];
  return { rates: Array.isArray(rates) ? rates : [], assignees: Array.isArray(holders) ? holders : [] };
}

function rateQuery(projectId, columns, order) {
  const query = new URLSearchParams({ select: columns.join(','), order, limit: String(MAX_RATE_ROWS) });
  if (projectId) query.set('project_id', `eq.${projectId}`);
  return query;
}

function money(value) {
  return Number(value ?? 0).toFixed(2);
}

function total(rows) {
  const cents = rows.reduce((sum, row) => sum + Math.round(Number(row.amount ?? 0) * 100), 0);
  return (cents / 100).toFixed(2);
}

/**
 * A readable preview: priced lines as a table, then the sources nobody may bill, with the reason, then `Total` —
 * which sums the priced lines only, so a window where nothing is rated still ends `Total 0.00` (nothing is billable,
 * rather than a preview that stopped early). `names` maps a person's id to their name; an id it does not carry prints
 * as the id, so a person the directory read cannot resolve still appears.
 */
export function formatPreview({ lines = [], unrated = [], total: sum = '0.00' } = {}, names = new Map()) {
  if (lines.length === 0 && unrated.length === 0) return '(no approved sources to price in this window)\n';
  const out = [];
  if (lines.length > 0) {
    const table = lines.map((line) => [
      formatBasisLabel(line.label ?? '(no label)', line.basis),
      line.unit ?? '',
      money(line.units),
      money(line.rate),
      money(line.amount),
      String(line.source_count ?? ''),
    ]);
    const head = ['Label', 'Unit', 'Units', 'Rate', 'Amount', 'Sources'];
    const widths = head.map((heading, column) => Math.max(heading.length, ...table.map((row) => row[column].length)));
    const format = (row) => row.map((value, column) => (column >= 2 ? value.padStart(widths[column]) : value.padEnd(widths[column]))).join('  ').trimEnd();
    out.push(format(head), format(widths.map((width) => '-'.repeat(width))), ...table.map(format));
  }
  if (unrated.length > 0) {
    if (out.length > 0) out.push('');
    out.push('Unrated (listed, not billed):');
    for (const row of unrated) {
      const person = row.user_id ? names?.get?.(row.user_id) ?? row.user_id : row.asset_name ?? null;
      out.push(`  ${formatBasisLabel(row.label ?? '(no label)', row.basis)}  ${money(row.units)} ${row.unit ?? ''}${person ? `  ${person}` : ''}  ${row.unrated_reason}`);
    }
  }
  out.push(`Total ${sum}`);
  return `${out.join('\n').trimEnd()}\n`;
}

/** A readable claim list: the header, then each frozen line with its rate. */
export function formatClaims(claims) {
  if (!Array.isArray(claims) || claims.length === 0) return '(no time-and-materials claims for this project)\n';
  const out = [];
  for (const claim of claims) {
    out.push(`${claim.id} · ${claim.period_from} → ${claim.period_to} · ${claim.status} · ${claim.currency ?? ''} ${money(claim.gross_amount)}`.replace(' ·  ', ' · '));
    for (const line of Array.isArray(claim.lines) ? claim.lines : []) {
      out.push(`  ${formatBasisLabel(line.label ?? '(no label)', line.basis)}  ${money(line.units)} ${line.unit ?? ''} × ${money(line.rate)} = ${money(line.amount)}`);
    }
  }
  return `${out.join('\n')}\n`;
}

/** The rate card as text: each line, and (with `--assignees`) the people holding it — printed once, on its newest version. */
export function formatRateCard({ rates = [], assignees = [] } = {}, names = new Map()) {
  if (!Array.isArray(rates) || rates.length === 0) return '(no contract rate lines are visible to you)\n';
  const holders = new Map();
  for (const assignee of Array.isArray(assignees) ? assignees : []) {
    const key = `${assignee.project_id}|${assignee.line_key}`;
    if (!holders.has(key)) holders.set(key, []);
    holders.get(key).push(assignee);
  }
  const newest = new Map();
  for (const line of rates) {
    const key = `${line.project_id}|${line.line_key}`;
    newest.set(key, Math.max(newest.get(key) ?? 0, Number(line.version ?? 0)));
  }
  const out = [];
  for (const line of rates) {
    const window = line.effective_to ? `from ${line.effective_from}, ended ${line.effective_to}` : `from ${line.effective_from}`;
    const state = line.is_current ? 'current' : 'history';
    const equipment = line.kind === 'equipment'
      ? ` · asset ${line.asset_id ?? '(missing)'} · standby ${line.standby_rate == null ? 'unrated' : money(line.standby_rate)}`
      : '';
    out.push(`${line.project_id} · ${line.label} · ${line.kind} · ${line.unit} · ${money(line.rate)}${equipment} · ${window} · ${state}`);
    const key = `${line.project_id}|${line.line_key}`;
    if (Number(line.version ?? 0) !== newest.get(key)) continue;
    for (const person of holders.get(key) ?? []) out.push(formatAssignees([person], names));
  }
  out.push(`${rates.length} rate line${rates.length === 1 ? '' : 's'}`);
  return `${out.join('\n')}\n`;
}

function formatBasisLabel(label, basis) {
  return basis === 'standby' ? `${label} (standby)` : label;
}

/** Assignee rows as indented lines under their rate line; `names` (id → name) prints a person by name, else their id. */
export function formatAssignees(assignees, names = new Map()) {
  return (Array.isArray(assignees) ? assignees : [])
    .map((person) => `  ${names?.get?.(person.user_id) ?? person.user_id}  from ${person.effective_from}${person.effective_to ? ` to ${person.effective_to}` : ''}`)
    .join('\n');
}
