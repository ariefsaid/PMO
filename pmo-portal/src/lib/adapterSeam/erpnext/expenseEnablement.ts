/**
 * #775 phase B — DD-EXP-22 / FR-EXP-118 / spec §10.7: whether an Admin may employ the `expenses` domain.
 *
 * Closed until #901 ships: before it, the GL mirror never re-reads a cancelled GL entry, so cancelling a posted
 * approval Journal Entry would leave its rows live in `erp_gl_entry_mirror` and overstate project actuals. The
 * whole posting path (intents, sweep pass, cancel) is built and inert behind this one switch — no org can post
 * until it opens. Read by the Admin action (`external-set-company` employ-domain) and the ERP setup screen.
 *
 * ⚑ Flip to `true` in the change that carries #901. `expenseEnablement.test.ts` binds this value to the shipped
 * incremental GL fetch and fails in BOTH directions, so the flag can neither open early nor be forgotten.
 */
export const EXPENSES_EMPLOYABLE: boolean = false;
