/**
 * The one plain sentence a keeper reads when Odoo could not finish a transfer (AC-OSP-007). It names the Odoo transfer by its
 * reference when known, never a model or a database id; the raw cause stays in the outbox row and the log.
 */
const CAUSES: Array<[RegExp, string]> = [
  [/stock\.backorder\.confirmation/, 'it asked to confirm a partial quantity'],
  [/stock\.immediate\.transfer/, 'it asked to confirm an immediate transfer'],
  [/needs the wizard/, 'it asked for a confirmation'],
  [/do not match the document's lines|STK_EVIDENCE_LINES/, 'its lines differ from this document'],
  [/STK_EVIDENCE_QUANTITY/, 'the quantity moved differs from this document'],
  [/STK_EVIDENCE_LOCATION/, 'it moved between other locations than this document names'],
  [/STK_EVIDENCE_CANCELLED/, 'it was cancelled in Odoo'],
  [/STK_EVIDENCE_COMPANY/, 'it belongs to another Odoo company'],
  [/STK_EVIDENCE_VALUATION/, 'Odoo did not report a value for it'],
  [/STK_EVIDENCE_PROJECT_COST/, 'Odoo did not book the project cost'],
  [/Odoo refused/, 'Odoo refused one of its steps'],
];

export function plainHoldReason(raw: string, reference?: string | null): string {
  const cause = CAUSES.find(([pattern]) => pattern.test(raw))?.[1];
  if (!cause) return 'Odoo needs a manual check of this transfer.';
  return `Odoo did not finish ${reference ? `transfer ${reference}` : 'this transfer'}: ${cause}. Check it in Odoo.`;
}
