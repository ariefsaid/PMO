import type { RevenueKind } from './anchors.ts';

export const OBSERVATIONS = [
  'absent', 'draft-with-anchor', 'posted-with-anchor', 'payment-created', 'payment-posted', 'payment-reconciled', 'state-unreadable', 'several',
] as const;
export type Observed = (typeof OBSERVATIONS)[number];
export type Step = 'create' | 'post' | 'reconcile' | 'adopt' | 'hold' | 'wait';
/** Where the command is in recovery: a first attempt, a retry inside the recovery window, or past it (ADR-0058 C-1). */
export type Recovery = 'none' | 'in-window' | 'after-window';

/**
 * What the next call is, given what Odoo shows for the command's anchor. Pure: the I/O wrapper only performs the
 * returned step. Absence reissues only on a first attempt; past the window it holds for both kinds (OQ-OCI-14), so a
 * mutable anchor can never mint a second invoice or a second receipt. Several matches, an unreadable state and a
 * document of the wrong shape never advance.
 */
export function nextStep(kind: RevenueKind, observed: Observed, recovery: Recovery): Step {
  switch (observed) {
    case 'absent': return recovery === 'none' ? 'create' : recovery === 'in-window' ? 'wait' : 'hold';
    case 'state-unreadable': return recovery === 'after-window' ? 'hold' : 'wait';
    case 'several': return 'hold';
    case 'draft-with-anchor': return kind === 'sales-invoice' ? 'post' : 'hold';
    case 'posted-with-anchor': return kind === 'sales-invoice' ? 'adopt' : 'hold';
    case 'payment-created': return kind === 'incoming-payment' ? 'post' : 'hold';
    case 'payment-posted': return kind === 'incoming-payment' ? 'reconcile' : 'hold';
    case 'payment-reconciled': return kind === 'incoming-payment' ? 'adopt' : 'hold';
  }
}
