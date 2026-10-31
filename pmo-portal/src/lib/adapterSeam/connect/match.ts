/**
 * The one party matcher every ERP tier uses (DD-ECA-2; behaviour owned by `contractSuite/party.suite.ts`). The caller
 * supplies same-name, same-role candidates; a present source tax id narrows them to matching or unset ids. Moved out
 * of erpnext/partyAdopt.ts so Odoo matches through the same code. ECA-2 (#1605) grows this into `proposeMatches()`.
 */

export type PartyPick<C> =
  | { outcome: 'link'; candidate: C }
  | { outcome: 'none' }
  | { outcome: 'review'; reason: 'tax-conflict' | 'ambiguous'; eligible: number };

export function pickPartyCandidate<C extends { taxId: string | null }>(taxId: string | null | undefined, candidates: readonly C[]): PartyPick<C> {
  if (candidates.length === 0) return { outcome: 'none' };
  const eligible = taxId ? candidates.filter((c) => !c.taxId || c.taxId === taxId) : candidates;
  if (eligible.length === 1) return { outcome: 'link', candidate: eligible[0] };
  return { outcome: 'review', reason: eligible.length === 0 ? 'tax-conflict' : 'ambiguous', eligible: eligible.length };
}
