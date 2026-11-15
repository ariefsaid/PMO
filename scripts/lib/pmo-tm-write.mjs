/**
 * `pmo tm` writes (#1856): the rate card, assignments, claim assembly, deselection, withdrawal and the sign-off preparation.
 * Each command reads the current state, plans, and prints the plan; only `--apply` sends its RPC — the same RPC, with the
 * same argument names, the app's data layer sends (pmo-portal/src/lib/db/timeAndMaterials.ts). The database decides every
 * amount, role and separation-of-duties rule; nothing here prices an hour or sends an org, an author or an amount.
 * Spec: docs/specs/cli-time-and-materials.spec.md · plan docs/plans/2026-11-16-cli-time-and-materials.md.
 * Node 22 standard library only.
 */
import { isCalendarDate } from './pmo-tm.mjs';

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
