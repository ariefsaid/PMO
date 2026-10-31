/** The identity of ONE user intent to write an externally-owned record (BLOCK 2, ADR-0058). */


/**
 * The identity of ONE user INTENT to write an externally-owned record (BLOCK 2, ADR-0058).
 *
 * `id` is the PMO record id the command mints; `idempotencyKey` is the outbox key. They are minted
 * TOGETHER, ONCE per form/mutation session (`newCommandIntent()`), and passed VERBATIM on every
 * attempt — so a human retry after a lost response ("external system unreachable — try again") lands
 * on the SAME outbox 4-tuple and is reconciled (the committed ERP doc is adopted) instead of opening a
 * fresh row and POSTing a SECOND money document. Omitting it keeps the legacy per-attempt minting,
 * which is safe only for a call site that never retries.
 */
export interface CommandIntent {
  id: string;
  idempotencyKey: string;
}
