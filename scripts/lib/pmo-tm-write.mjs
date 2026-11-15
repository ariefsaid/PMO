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
