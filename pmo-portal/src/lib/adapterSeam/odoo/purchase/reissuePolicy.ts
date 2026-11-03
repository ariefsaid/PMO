/**
 * Whether a recovery that finds nothing may mint the document again. OQ-OPP-10: bills and payments hold; orders and receipts
 * reissue only on CONCLUSIVE absence. Absence is conclusive only where a probe also covers the create-to-anchor gap (DD-OPP-4
 * amendment: a composite of vendor, lines, amount and window). The order, bill and payment composites exist (recoveryProbe.ts). A bill's
 * composite never ADOPTS an unanchored bill, and a miss still holds, because bills are never reissued on doubt (OQ-OPP-10). A
 * payment's anchor is a memo anyone can edit, so a miss proves nothing (ADR-0058 C-1): it is held, never reissued. The receipt (P4)
 * mints no document and has no create-to-anchor gap: its probe returns "nothing" only when Odoo's received quantities are provably
 * still at the plan's base (anything else throws and holds), so a miss there is conclusive. A revision is the exception that proves
 * the rule: it edits the order in place, towards a line set, so repeating it after a miss is a no-op and cannot mint anything
 * (AC-SCA-011 `absent-conclusive` -> reissue).
 */
import { ODOO_ANCHORS } from './anchors.ts';
import type { PurchaseKind } from './nextStep.ts';

const GAP_COVERED: Record<PurchaseKind, boolean> = { order: true, receipt: true, bill: true, payment: true };

export function odooReissueOnInconclusiveAbsence(kind: PurchaseKind, operation?: string): boolean {
  if (operation === 'revise') return true;
  return GAP_COVERED[kind] && !ODOO_ANCHORS[kind].mutable && kind !== 'bill';
}
