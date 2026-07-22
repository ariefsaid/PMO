/**
 * erpnext/feedErrorPolicy.ts (HIGH-A, Luna re-audit round 2) — the ERPNext feed's `ApplyErrorPolicy`
 * (`applyEngine.ts`): which per-change apply THROW is a terminal, ack-and-skip outcome for ONE
 * document, and which must halt the poll so the next tick retries it.
 *
 * ⚑ WHY THIS EXISTS. Three inbound branches throw BY DESIGN, for documents whose correct handling is
 * "record it, tell a human, move on":
 *   • `native-budget-not-adopted`    (FR-BUD-140) — a Budget created directly in the ERPNext Desk;
 *   • `native-timesheet-not-adopted` (FR-TSP-082) — likewise a Timesheet; PMO owns entry AND approval;
 *   • `procurement-inbound-adopt-no-case-link` (FR-ENA-083) — an inbound adopt that needs the PMO
 *     procurement-case link only the dispatch path can make (the documented "lossy hint": log + ack).
 * Each is an EXPECTED event on any live bench. `runSweep` had no per-change catch, so the first such
 * document stopped the loop before the watermark advanced — permanently, since the document is still
 * there next tick. Everything queued behind it (a Desk CANCEL of a PMO-pushed Budget, FR-BUD-142)
 * never applied, while PMO kept reporting the push as landed.
 *
 * Everything else HALTS. A transient DB/network fault must be retried, never skipped past: the poll is
 * `modified >= cursor`, so a change the watermark moves beyond is never re-listed.
 *
 * Pure + Deno-importable (relative imports only).
 */

/** The classified reasons an inbound apply may terminally refuse ONE document. Matched on the error's
 *  `code` OR its message, because the two never-adopt branches classify as `AdapterError`
 *  (`code:'commit-rejected'`, the reason in the MESSAGE) while the procurement one is an `AppError`
 *  carrying the reason as its `code`. */
const TERMINAL_APPLY_REASONS = [
  'native-budget-not-adopted',
  'native-timesheet-not-adopted',
  'procurement-inbound-adopt-no-case-link',
] as const;

/**
 * The classified never-adopt reason this error carries, or `null` when it is not one of them.
 *
 * ⚑ AC-TSP-040: the WEBHOOK ingress needs the reason, not merely the verdict — Frappe RETRIES a failed
 * webhook, so an un-adoptable document answering 500 becomes a permanent retry storm against the
 * client's own ERP. The ingress acks it 200 and NAMES the rule that applied, using this same
 * classification rather than a forked copy of it.
 */
export function terminalApplyReason(err: unknown): string | null {
  const code = (err as { code?: unknown } | null | undefined)?.code;
  const message = err instanceof Error ? err.message : '';
  return TERMINAL_APPLY_REASONS.find((reason) => code === reason || message.includes(reason)) ?? null;
}

/** `'skip'` for a terminal, already-surfaced per-document refusal; `'halt'` for everything else. */
export function erpFeedApplyErrorPolicy(err: unknown): 'skip' | 'halt' {
  return terminalApplyReason(err) === null ? 'halt' : 'skip';
}
