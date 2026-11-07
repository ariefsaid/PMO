/** FR-OPP-071: the outcome class of one Odoo-bound record, from its mirror facts and/or its newest outbox command. Display only. */
export type OdooOutcomeClass = 'confirmed' | 'pending' | 'held' | 'needs-attention' | 'refused';

export interface OdooOutcomeInput {
  erpState?: string | null;
  erpAttention?: string | null;
  erpReadAt?: string | null;
  outboxState?: string | null;
  outboxUpdatedAt?: string | null;
  lastError?: string | null;
}

export interface OdooOutcome {
  cls: OdooOutcomeClass;
  /** When PMO last heard from Odoo about it (mirror read), else when the command last moved. */
  asOf: string | null;
  reason: string | null;
}

const IN_FLIGHT = new Set(['pending', 'committing', 'committed', 'quarantined']);

export function matchRefusalReasonKey(raw: string | null | undefined): string | null {
  if (!raw) return null;
  if (/revision[-_]superseded/i.test(raw)) return 'revision_superseded';
  if (/po_has_submitted_bill/i.test(raw)) return 'po_has_submitted_bill';
  if (/revision_not_issued/i.test(raw)) return 'revision_not_issued';
  if (/po_not_found/i.test(raw)) return 'po_not_found';
  if (/below-received/i.test(raw)) return 'below-received';
  return null;
}

export function odooOutcome(i: OdooOutcomeInput): OdooOutcome | null {
  const sent = i.outboxUpdatedAt ?? null;
  // Whatever PMO has sent and not yet seen settled comes first: it is what a person must act on.
  if (i.outboxState === 'held') return { cls: 'held', asOf: sent, reason: i.lastError ?? null };
  if (i.outboxState && IN_FLIGHT.has(i.outboxState)) return { cls: 'pending', asOf: sent, reason: null };
  if (i.outboxState === 'failed') {
    return /rejected|refused/.test(i.lastError ?? '') || matchRefusalReasonKey(i.lastError) !== null
      ? { cls: 'refused', asOf: sent, reason: i.lastError ?? null }
      : { cls: 'pending', asOf: sent, reason: null };
  }
  if (i.erpAttention) return { cls: 'needs-attention', asOf: i.erpReadAt ?? null, reason: i.erpAttention };
  // Odoo's own purchase approval: PMO sent it and Odoo has it, but it is not an order yet. Nobody in PMO can act.
  if (i.erpState === 'to approve') return { cls: 'pending', asOf: i.erpReadAt ?? null, reason: 'awaiting-approval' };
  if (i.erpState) return { cls: 'confirmed', asOf: i.erpReadAt ?? null, reason: null };
  return null;
}
