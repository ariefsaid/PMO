/**
 * `pmo bid win|lose|decline` (#1789): record the outcome of an existing bid through transition_project, the same
 * function and checks the app's win and lost dialogs use. This module only plans: it checks the artifacts and
 * builds the RPC arguments. The database stays the authority on role, organisation, stage legality and the
 * contract-value approval rule; every check here is at least as strict as the server's, never looser.
 */

/** The outcome → target status. */
export const BID_OUTCOMES = Object.freeze({ win: 'Won, Pending KoM', lose: 'Loss Tender', decline: 'Declined' });

/** The stages a bid can be decided from (the app's pipeline). */
export const OPEN_BID_STATUSES = Object.freeze(['Leads', 'PQ Submitted', 'Quotation Submitted', 'Tender Submitted', 'Negotiation']);

/** transition_project's lost/declined reasons (pinned to the latest migration by AC-1789-006). */
export const LOST_REASONS = Object.freeze(['price', 'competitor', 'scope_fit', 'timing', 'capacity', 'relationship', 'client_cancelled', 'no_decision', 'other']);

const MAX_NOTE = 500;
const AMOUNT = /^\d+(\.\d{1,2})?$/;

function isIsoDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value ?? '')) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}

const text = (v) => (typeof v === 'string' ? v.trim() : '');

/**
 * @param {'win'|'lose'|'decline'} outcome
 * @param {{ref?: string, date?: string, value?: string, reason?: string, note?: string}} input  the command's flags
 * @param {{id: string, name?: string, status: string, contract_value: number|string|null}} project  the project as read
 * @param {{today: string}} opts  the latest calendar date anywhere (a contract date after it is refused)
 * @returns {{problems: string[], rpc: object|null, from: string, to: string, contract_value: number|null}}
 */
export function planBidOutcome(outcome, input, project, { today }) {
  const to = BID_OUTCOMES[outcome];
  const problems = [];
  const stored = project.contract_value === null || project.contract_value === undefined ? null : Number(project.contract_value);
  if (!OPEN_BID_STATUSES.includes(project.status)) {
    problems.push(`The project is '${project.status}', not an open bid (${OPEN_BID_STATUSES.join(', ')}); a decided project changes in the app.`);
  }
  let rpc;
  if (outcome === 'win') {
    for (const flag of ['reason', 'note']) if (input[flag] !== undefined) problems.push(`--${flag} is for lose and decline, not win.`);
    const ref = text(input.ref);
    if (!ref) problems.push('--ref <client order number> is required to record a win (the client\'s service order, contract or PO number).');
    if (!isIsoDate(input.date)) problems.push('--date <YYYY-MM-DD> is required to record a win (a real date on the client\'s order).');
    else if (input.date > today) problems.push(`--date ${input.date} is in the future; use the date on the client's order.`);
    if (!(stored > 0)) {
      problems.push('The project has no contract value. Set it first (pmo load, or in the app) so its approval rule applies, then record the win.');
    } else if (!AMOUNT.test(input.value ?? '')) {
      problems.push(`--value <contract value> is required to record a win; it must match the project's contract value (${stored}).`);
    } else if (Number(input.value) !== stored) {
      problems.push(`--value ${input.value} does not match the project's contract value (${stored}). Correct the value in the app first, or check the order.`);
    }
    rpc = { p_id: project.id, p_to: to, p_customer_contract_ref: ref, p_contract_date: input.date };
  } else {
    for (const flag of ['ref', 'date', 'value']) if (input[flag] !== undefined) problems.push(`--${flag} is for win, not ${outcome}.`);
    const reason = text(input.reason);
    const note = text(input.note);
    if (!LOST_REASONS.includes(reason)) problems.push(`--reason is required: one of ${LOST_REASONS.join(', ')}.`);
    if (reason === 'other' && !note) problems.push('--note is required when the reason is other.');
    if (note.length > MAX_NOTE) problems.push(`--note is limited to ${MAX_NOTE} characters.`);
    rpc = { p_id: project.id, p_to: to, p_lost_reason: reason, ...(note ? { p_lost_note: note } : {}) };
  }
  return { problems, rpc: problems.length ? null : rpc, from: project.status, to, contract_value: stored };
}
