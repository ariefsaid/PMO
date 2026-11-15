/** Use the same scope and review identity when accepting a census. */
export async function captureHistory(api, { projectId = null, dryRun, revision, requestId }) {
  if (!dryRun && (!revision || !requestId)) {
    throw new Error('Apply requires the preview revision and request identity.');
  }
  const payload = { action: dryRun ? 'preview' : 'apply', scope: { projectId } };
  if (!dryRun) Object.assign(payload, { expectedRevision: revision, requestId });
  const result = await api.capture(payload);
  if (dryRun) return result;
  let report;
  try { report = await api.capture({ action: 'report', scope: { projectId } }); }
  catch { report = { complete: false, missing: ['report_unavailable'] }; }
  return { ...result, report };
}

/** Preserve the work error if cleanup also fails, while still exposing the cleanup error. */
export async function withCaptureProofCleanup(work, cleanup) {
  let result;
  try {
    result = await work();
  } catch (primary) {
    try { await cleanup(); }
    // eslint-disable-next-line preserve-caught-error -- the AggregateError already carries both errors (errors[0]=primary, errors[1]=cleanupError); primary stays the root cause
    catch (cleanupError) { throw new AggregateError([primary, cleanupError], 'Capture proof and cleanup both failed', { cause: primary }); }
    throw primary;
  }
  await cleanup();
  return result;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ASSIGN_KEYS = new Set(['request_id', 'source_id', 'decision', 'project_id', 'accept_set_aside', 'allow_capital_as_overhead', 'invoice_ids']);
export const MAX_ASSIGN_ROWS = 500;
/** An order family names 1 to 50 invoices (#2277). */
export const MAX_FAMILY_INVOICES = 50;

/** Local checks only; the server repeats every one of them. Returns the list of problems, empty when the file is sendable. */
export function assignmentProblems(rows) {
  if (!Array.isArray(rows) || rows.length < 1) return ['the file must be a JSON array with at least one row'];
  if (rows.length > MAX_ASSIGN_ROWS) return [`the file has ${rows.length} rows; send at most ${MAX_ASSIGN_ROWS} per run`];
  const problems = [];
  const requests = new Set();
  const sources = new Set();
  rows.forEach((row, i) => {
    const at = `row ${i + 1}`;
    if (!row || typeof row !== 'object' || Array.isArray(row)) { problems.push(`${at}: must be an object`); return; }
    for (const key of Object.keys(row)) if (!ASSIGN_KEYS.has(key)) problems.push(`${at}: unknown field ${key}`);
    if (!UUID_RE.test(String(row.request_id ?? ''))) problems.push(`${at}: request_id must be a UUID you keep for this decision`);
    if (!UUID_RE.test(String(row.source_id ?? ''))) problems.push(`${at}: source_id must be the invoice's UUID`);
    if (!['project', 'set_aside', 'order_family'].includes(row.decision)) problems.push(`${at}: decision must be "project", "set_aside" or "order_family"`);
    if (row.decision === 'project' && !UUID_RE.test(String(row.project_id ?? ''))) problems.push(`${at}: a project decision needs project_id (a UUID)`);
    if (row.decision === 'order_family') problems.push(...familyProblems(row, at));
    else if ('invoice_ids' in row) problems.push(`${at}: only an order_family row takes invoice_ids`);
    if (row.decision === 'set_aside' && 'project_id' in row) problems.push(`${at}: a set_aside decision takes no project_id`);
    for (const flag of ['accept_set_aside', 'allow_capital_as_overhead']) {
      if (flag in row && typeof row[flag] !== 'boolean') problems.push(`${at}: ${flag} must be true or false`);
    }
    const request = String(row.request_id ?? '').toLowerCase();
    if (request && requests.has(request)) problems.push(`${at}: request_id repeats an earlier row`);
    requests.add(request);
    // Every document, a row's source or a family's invoice, appears once in the file (the server refuses duplicate_assignment_row).
    const ids = [row.source_id, ...(row.decision === 'order_family' && Array.isArray(row.invoice_ids) ? row.invoice_ids : [])].map(id => String(id ?? '').toLowerCase());
    for (const id of ids) {
      if (id && sources.has(id)) problems.push(`${at}: ${id} repeats a document named earlier in the file`);
      sources.add(id);
    }
  });
  return problems;
}

/** An order_family row: the order (source_id), its project and every invoice that bills it, each named once; no capital override. */
function familyProblems(row, at) {
  const problems = [];
  if (!UUID_RE.test(String(row.project_id ?? ''))) problems.push(`${at}: an order_family row needs project_id (a UUID)`);
  if ('allow_capital_as_overhead' in row) problems.push(`${at}: an order_family row takes no allow_capital_as_overhead`);
  const invoices = row.invoice_ids;
  if (!Array.isArray(invoices) || invoices.length < 1 || invoices.length > MAX_FAMILY_INVOICES) {
    problems.push(`${at}: invoice_ids must list 1 to ${MAX_FAMILY_INVOICES} invoice UUIDs, every invoice that bills the order`);
    return problems;
  }
  if (invoices.some(id => !UUID_RE.test(String(id)))) problems.push(`${at}: every invoice_ids entry must be an invoice UUID`);
  if (new Set(invoices.map(id => String(id).toLowerCase())).size !== invoices.length) problems.push(`${at}: invoice_ids names an invoice twice`);
  return problems;
}

/** Preview by default. Apply needs the revision a preview printed; each row keeps its own request id so a retry is the same command. */
export async function runCaptureAssignments(api, rows, { dryRun, revision, file = '<file>' }) {
  const problems = assignmentProblems(rows);
  if (problems.length) {
    const error = new Error(`The assignment file has ${problems.length} problem(s); nothing was sent.`);
    error.problems = problems;
    throw error;
  }
  if (!dryRun && (typeof revision !== 'string' || !revision.trim())) throw new Error('Apply requires the revision from the preview.');
  const result = await api.capture({ action: 'assign', rows, expectedRevision: dryRun ? 'preview' : revision, dryRun });
  return formatAssignmentResults(result, rows, { dryRun, file });
}

const quote = value => `'${String(value).replace(/'/g, `'\\''`)}'`;
const CLI = 'node scripts/pmo.mjs';

const RETRY_LATER = new Set(['snapshot_refresh_required', 'feed_not_current', 'source_stale']);

/** One actionable line per row: what was decided or why it was refused, and the exact next command. Nothing here ever writes to the ERP. */
export function formatAssignmentResults(result, rows, { dryRun, file }) {
  const revision = result.revision ?? null;
  const previewCommand = `${CLI} purchases assign ${quote(file)}`;
  const applyCommand = `${previewCommand} --apply --revision ${revision}`;
  const byRequest = new Map(rows.map(row => [String(row.request_id).toLowerCase(), row]));
  const refusedAll = result.complete === false;
  const out = (result.results ?? []).map(item => {
    const input = byRequest.get(String(item.request_id).toLowerCase()) ?? {};
    const refused = item.outcome === 'refused' || item.outcome === 'not_found';
    const outcome = refused ? 'refused' : item.outcome === 'skip' ? 'skip' : item.outcome === 'attach' ? 'attach' : 'create';
    const isFamily = (input.decision ?? item.decision) === 'order_family';
    let next;
    if (refused) {
      next = item.reason === 'snapshot_refresh_required' ? `retry after the next ledger refresh: ${previewCommand}`
        : `fix this row, then preview again: ${previewCommand}`;
    } else if (outcome === 'skip') next = 'already recorded under this request_id; nothing to do';
    else if (dryRun) next = applyCommand;
    else if (outcome === 'attach') next = `to undo: ${CLI} purchases undo-record-only ${item.procurement_id} --attach ${item.request_id} --reason "<why>"`;
    else next = item.procurement_id ? `to undo: ${CLI} purchases undo-record-only ${item.procurement_id} --reason "<why>"` : 'recorded; nothing to do';
    if (isFamily) return familyRow(item, input, outcome, next);
    return {
      request_id: item.request_id, source_id: item.source_id, reference: item.source ?? null, supplier: item.supplier ?? null,
      choice: input.decision ?? item.decision ?? null, project_id: input.project_id ?? null,
      outcome, reason: item.reason ?? null, message: item.message ?? null,
      placement: item.mapped_amount === undefined ? null : { project_id: input.project_id ?? null, amount: item.mapped_amount, currency: item.ledger_currency ?? null, excluded: item.excluded ?? [],
      loses_cost: item.prior_placement ?? [], clears_overhead_mark: item.clears_mark === true },
      assignment_origin: item.assignment_origin ?? null, purchase_id: item.procurement_id ?? null, would_create: item.would_create ?? false,
      erp_write: false, next,
    };
  });
  const refusals = out.filter(row => row.outcome === 'refused').length;
  return {
    dry_run: dryRun, revision, complete: !refusedAll, reason: result.reason ?? null, erp_write: false,
    counts: { rows: out.length, create: out.filter(r => r.outcome === 'create').length, attach: out.filter(r => r.outcome === 'attach').length,
      skip: out.filter(r => r.outcome === 'skip').length, refused: refusals },
    rows: out,
    next: refusedAll ? (RETRY_LATER.has(result.reason) ? `preview again: ${previewCommand}` : `fix the cause (${result.reason}), then preview again`)
      : dryRun ? (refusals ? 'fix the refused rows, then preview again' : applyCommand) : refusals ? `fix the refused rows, preview again (${previewCommand}), then apply with the new revision; rows already applied are skipped` : 'done',
  };
}

/** One order-family result: the purchase it creates or attaches to, each invoice's mapped ledger amount, the commitment before and after, and one readable line. */
function familyRow(item, input, outcome, next) {
  const project = input.project_id ?? item.project_id ?? null;
  const invoices = (item.invoices ?? []).map(inv => ({ source_id: inv.source_id, reference: inv.source ?? null, tagged_in_erp: inv.tagged === true,
    amount: inv.tagged === true ? null : inv.mapped_amount ?? null, excluded: inv.excluded ?? [], loses_cost: inv.prior_placement ?? [], state: inv.state ?? null }));
  const placed = outcome === 'create' || outcome === 'attach';
  const commitment = placed ? { before: item.commitment_before ?? null, after: item.commitment_after ?? null, currency: item.ledger_currency ?? null } : null;
  const summary = placed ? [
    `${item.source ?? item.source_id} → ${project}: ${outcome === 'attach' ? `attach to ${item.procurement_id}` : 'create'}`,
    ...invoices.map(inv => inv.tagged_in_erp ? `${inv.reference ?? inv.source_id} (tagged in the ERP)` : `${inv.reference ?? inv.source_id} ${inv.amount} (${item.assignment_origin ?? 'pmo_assignment'})`),
    `commitment ${commitment.before} → ${commitment.after}`, 'erp_write: false'].join(', ') : null;
  return {
    request_id: item.request_id, source_id: item.source_id, reference: item.source ?? null, supplier: item.supplier ?? null, choice: 'order_family', project_id: project,
    outcome, reason: item.reason ?? null, message: item.message ?? null,
    ...(item.reason === 'family_incomplete' ? { missing_invoice_ids: item.missing_invoice_ids ?? [], extra_invoice_ids: item.extra_invoice_ids ?? [] } : {}),
    invoices, commitment, summary, assignment_origin: item.assignment_origin ?? null, purchase_id: item.procurement_id ?? null, would_create: item.would_create ?? false,
    erp_write: false, next,
  };
}

/** #2349: one fixed sentence per cause of source_settings_unreadable. Only these sentences reach the terminal. */
const SOURCE_SETTINGS_NOTES = {
  refused: 'grant the integration user read access to System Settings, then preview again.',
  not_found: "the ERP site answered but has no such document at that address; check the integration's site address and that it is the supported ERP product, then preview again.",
  unreachable: 'the ERP did not answer; check it is reachable and healthy, then preview again.',
  malformed_reply: "the ERP's reply was not a System Settings record; check the integration's site address points at the ERP's API, then preview again.",
  version_unknown: "the integration's ERP version is not recorded or not supported; run the integration's version check again, then preview again.",
};

/** The line the CLI prints when a capture reply (or its report) names why System Settings could not be read, else null. */
export function sourceSettingsNote(result) {
  const settings = result?.source_settings ?? result?.report?.source_settings;
  if (!settings || typeof settings !== 'object') return null;
  const cause = typeof settings.cause === 'string' && Object.hasOwn(SOURCE_SETTINGS_NOTES, settings.cause) ? settings.cause : null;
  return cause
    ? `System Settings could not be read (${cause}): ${SOURCE_SETTINGS_NOTES[cause]}`
    : 'System Settings could not be read: see source_settings in the reply, then preview again.';
}
