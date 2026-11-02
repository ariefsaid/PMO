export type PurchaseKind = 'order' | 'receipt' | 'bill' | 'payment';
export type Observation = { state?: string; anchor?: string; absent?: boolean; probe?: 'conclusive' | 'inconclusive' };
export type Step = 'create' | 'confirm' | 'post' | 'reconcile' | 'validate' | 'adopt' | 'hold';

/** The caller supplies an already identified document; explicit foreign anchors and unknown states hold. */
export function nextStep(kind: PurchaseKind, observed: Observation): Step {
  if (observed.absent) return observed.probe === 'conclusive' && kind !== 'payment' ? 'create' : 'hold';
  if (observed.anchor !== undefined && observed.anchor !== 'ours') return 'hold';
  switch (kind) {
    case 'order': return observed.state === 'draft' ? 'confirm' : ['purchase', 'done'].includes(observed.state ?? '') ? 'adopt' : 'hold';
    case 'bill': return observed.state === 'draft' ? 'post' : observed.state === 'posted' ? 'adopt' : 'hold';
    case 'payment': return observed.state === 'draft' ? 'post' : observed.state === 'posted-unreconciled' ? 'reconcile' : observed.state === 'reconciled' ? 'adopt' : 'hold';
    case 'receipt': return observed.state === 'done' ? 'adopt' : ['assigned', 'confirmed'].includes(observed.state ?? '') ? 'validate' : 'hold';
  }
}
