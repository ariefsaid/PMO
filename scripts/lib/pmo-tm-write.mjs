/**
 * `pmo tm` writes (#1856): the rate card, assignments, claim assembly, deselection, withdrawal and the sign-off preparation.
 * Each command reads the current state, plans, and prints the plan; only `--apply` sends its RPC — the same RPC, with the
 * same argument names, the app's data layer sends (pmo-portal/src/lib/db/timeAndMaterials.ts). The database decides every
 * amount, role and separation-of-duties rule; nothing here prices an hour or sends an org, an author or an amount.
 * Spec: docs/specs/cli-time-and-materials.spec.md · plan docs/plans/2026-11-16-cli-time-and-materials.md.
 * Node 22 standard library only.
 */

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
