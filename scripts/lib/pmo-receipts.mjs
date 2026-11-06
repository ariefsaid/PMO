/**
 * `pmo purchases receive` (#1866): record a goods receipt through the same `adapter-dispatch` command the app sends
 * (domain procurement, erp_doc_kind goods-receipt). Whole purchase = Basic, on any connected tier; `--line` quantities
 * need procurement_full AND the Odoo tier (whose receipt command is the one that takes caller lines).
 * One intent UUID is both the PMO record id and the idempotency key, so re-running with it never double-records.
 * Every rule (plan, state, open quantity) is the server's; this module only shapes the command and explains refusals.
 * Node 22 standard library only.
 */

export const RECEIPT_STATUSES = Object.freeze(['Partial', 'Complete']);

/**
 * The only tier whose goods-receipt command takes caller-directed line quantities: `receiptLines` is the
 * Odoo caller shape. The ERPNext receipt keys caller lines on `record.items` — a shape this command never
 * sends — so `--line` there would be ignored and the WHOLE open purchase received at ordered quantity.
 * Anything else (including an unrecognised tier) is refused rather than silently receiving everything.
 */
export const RECEIPT_LINE_TIERS = Object.freeze(['odoo']);

/** `--line` on a tier that takes no per-line quantities: the refusal text, or null when the tier is fine. */
export function receiptLineTierRefusal(tier, lines) {
  if (!lines.length || RECEIPT_LINE_TIERS.includes(tier)) return null;
  return {
    message: `--line is not available on this organisation's accounting-system tier (${tier ?? 'unknown'}): it would receive the whole open purchase, not the quantities given.`,
    hint: 'Record the whole purchase instead (run again without --line), or enter the line quantities in the app: Procurement, open the purchase, Record goods receipt.',
  };
}

/** A real calendar date: `YYYY-MM-DD` plus a round-trip, so a day that does not exist (2026-02-30) cannot roll over. */
export function isReceiptDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const stamp = Date.parse(`${value}T00:00:00Z`);
  return !Number.isNaN(stamp) && new Date(stamp).toISOString().slice(0, 10) === value;
}

/** `--line Pump=3` (repeatable) → `[{itemRef, quantity}]`, or the problems. Splits on the LAST `=`. */
export function parseLineFlags(raw) {
  const lines = [];
  const problems = [];
  const seen = new Set();
  for (const text of raw) {
    const at = text.lastIndexOf('=');
    const itemRef = at > 0 ? text.slice(0, at).trim() : '';
    const quantity = Number(text.slice(at + 1));
    if (!itemRef || !Number.isFinite(quantity) || quantity <= 0) { problems.push(`--line '${text}': use <item>=<positive quantity>`); continue; }
    if (seen.has(itemRef)) { problems.push(`--line '${itemRef}' is given twice`); continue; }
    seen.add(itemRef);
    lines.push({ itemRef, quantity });
  }
  return problems.length ? { problems } : { lines };
}

/** The adapter-dispatch body for one receipt. */
export function receiptCommand({ procurementId, status, date, lines, intent }) {
  return {
    domain: 'procurement', operation: 'create', idempotencyKey: intent,
    record: { id: intent, procurementId, status, receiptDate: date, erp_doc_kind: 'goods-receipt', ...(lines.length ? { receiptLines: lines } : {}) },
  };
}

const PRE_CUTOVER_HINT = 'This purchase was ordered before the accounting-system connection and cannot be received there. Record it in the app: Procurement, open the purchase, Record goods receipt.';
const HINTS = [
  [/require procurement full/i, 'Line-level receipts are part of the Full plan. Record the whole purchase instead (run again without --line), or ask the owner to switch the plan on.'],
  [/over-receipt/i, 'That quantity is more than the open quantity on the line (ordered minus already received). Lower it, or check what is open in Procurement.'],
  [/receipt-nothing-open/i, 'Everything ordered is already fully received; there is nothing left to receive.'],
  [/receipt-line-missing|receipt-line-ambiguous/i, 'Use the item reference exactly as the purchase order shows it.'],
  [/receipt-duplicate-item|receipt-quantity-invalid|receipt-empty|receipt-lines-invalid/i, 'Give each item once with a positive quantity.'],
  [/po-missing|order-not-in-odoo|po-unreadable/i, 'The purchase has no sent purchase order in the accounting system yet. Issue the purchase order first, then receive.'],
  // The served refusal's message never says "cutover" ("not sent: this purchase started before the ERP
  // connection"); the code is the reliable key (see `receiptHint`). The message pattern stays for safety.
  [/pre-?cutover|before the erp connection/i, PRE_CUTOVER_HINT],
];

/** Hint for a refusal, or undefined. An unreachable ERP means the result is unknown: re-run with the same intent. */
export function receiptHint(code, message) {
  if (code === 'external-unreachable') return 'The result is unknown. Run the same command again with the same --intent; it will not record twice.';
  if (code === 'pre-cutover') return PRE_CUTOVER_HINT;
  return HINTS.find(([re]) => re.test(message ?? ''))?.[1];
}
