/**
 * Why a stock command is held, as a typed cause set where the hold is raised, and the one plain sentence a keeper reads for it
 * (AC-OSP-007). The sentence names the Odoo transfer by its reference when known, never a model or a database id; the raw message
 * stays in the outbox row (`last_error`).
 */
export type HoldCause =
  | 'wizard-partial' | 'wizard-immediate' | 'wizard-other'
  | 'moves-differ' | 'lines-differ' | 'quantity-differs' | 'locations-differ'
  | 'cancelled' | 'other-company' | 'no-value' | 'no-project-cost'
  | 'odoo-refused' | 'anchor-ambiguous' | 'anchor-missing'
  | 'no-transfer-found' | 'not-checked';

export const HOLD_CAUSES: readonly HoldCause[] = [
  'wizard-partial', 'wizard-immediate', 'wizard-other', 'moves-differ', 'lines-differ', 'quantity-differs', 'locations-differ',
  'cancelled', 'other-company', 'no-value', 'no-project-cost', 'odoo-refused', 'anchor-ambiguous', 'anchor-missing', 'no-transfer-found', 'not-checked',
];

export const isHoldCause = (value: unknown): value is HoldCause => (HOLD_CAUSES as readonly unknown[]).includes(value);

/** The part of the sentence after "Odoo did not finish <transfer>:" for a cause where a transfer is known to exist. */
function finishedWhy(cause: Exclude<HoldCause, 'no-transfer-found' | 'not-checked'>): string {
  switch (cause) {
    case 'wizard-partial': return 'it asked to confirm a partial quantity';
    case 'wizard-immediate': return 'it asked to confirm an immediate transfer';
    case 'wizard-other': return 'it asked for a confirmation';
    case 'moves-differ':
    case 'lines-differ': return 'its lines differ from this document';
    case 'quantity-differs': return 'the quantity moved differs from this document';
    case 'locations-differ': return 'it moved between other locations than this document names';
    case 'cancelled': return 'it was cancelled in Odoo';
    case 'other-company': return 'it belongs to another Odoo company';
    case 'no-value': return 'Odoo did not report a value for it';
    case 'no-project-cost': return 'Odoo did not book the project cost';
    case 'odoo-refused': return 'Odoo refused one of its steps';
    case 'anchor-ambiguous': return 'Odoo holds more than one transfer for this document';
    case 'anchor-missing': return 'the transfer Odoo points to cannot be found';
  }
}

export function plainHoldReason(cause: HoldCause, reference?: string | null): string {
  const transfer = reference ? `transfer ${reference}` : 'this transfer';
  if (cause === 'no-transfer-found') return 'Odoo shows no transfer for this document, so it cannot be told whether one was sent. Check it in Odoo.';
  if (cause === 'not-checked') return `Odoo needs a manual check of ${transfer}.`;
  return `Odoo did not finish ${transfer}: ${finishedWhy(cause)}. Check it in Odoo.`;
}
