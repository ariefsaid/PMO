/** #1513 — the canonical PO revision (`purchase-order.revise`): the full effective line set of one PMO revision. */
export interface PurchaseOrderRevise {
  key: string;            // porev:<po uuid>:<revision>
  poId: string;
  revision: number;       // ≥ 2 (revision 1 is the ordinary purchase-order create)
  lines: Array<{ itemRef: string; quantity: string; rate: string; unit: string }>; // 3-dp / 2-dp strings
}
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
export const PO_REVISE_KEY_RE = new RegExp(`^porev:${UUID}:[0-9]{1,6}$`);
export function purchaseOrderReviseKey(poId: string, revision: number): string {
  const key = `porev:${poId}:${revision}`;
  if (!PO_REVISE_KEY_RE.test(key) || revision < 2) throw new Error(`purchase-order.revise: bad key ${key}`);
  return key;
}
export type ReviseProbe =
  | { probe: 'inconclusive' }
  | { probe: 'absent-conclusive' }
  | { probe: 'found'; key: string; expectedKey: string };
/** ADR-0058 applied to a revise: adopt only our own key; anything uncertain is held for an operator (C-1 posture). */
export function poReviseRecoveryDecision(p: ReviseProbe): 'adopt' | 'held' | 'reissue' {
  if (p.probe === 'found') return p.key === p.expectedKey ? 'adopt' : 'held';
  return p.probe === 'absent-conclusive' ? 'reissue' : 'held';
}
