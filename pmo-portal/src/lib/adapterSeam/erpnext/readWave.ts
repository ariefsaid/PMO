/**
 * #2117 — independent read-only steps of one dispatch group are issued together (`Promise.allSettled`), then their
 * outcomes are taken back IN THE ORIGINAL STEP ORDER with `take`. A later read's failure therefore never pre-empts an
 * earlier step's refusal (the messages stay what they were), and no rejection is left unhandled when an earlier step
 * refuses first. Only read-only steps may join a group: no ERP write or outbox insert ever moves.
 */
export function take<T>(result: PromiseSettledResult<T>): T {
  if (result.status === 'rejected') throw result.reason;
  return result.value;
}
