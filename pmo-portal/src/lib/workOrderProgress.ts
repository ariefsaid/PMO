/**
 * Scope and progress of ONE work order (#2518, AC-WORP-005): pure derivation over the allocations
 * (`work_order_lines`), the BoQ items (for rate and code) and the acceptances (BAST). Only a Confirmed
 * acceptance counts as accepted; the overall percent is value-weighted (rate × quantity), as shipped for claims.
 */
export interface ProgressLineInput { id: string; boq_item_id: string; quantity: number | string }
export interface ProgressItemInput { id: string; rate: number | string; item_code: string; unit: string; earning_basis: string; description: string }
export interface ProgressAcceptanceInput { status: string; lines: Array<{ boq_item_id: string; quantity: number | string }> }

export interface ScopeLine {
  id: string;
  boqItemId: string;
  itemCode: string | null;
  description: string | null;
  unit: string | null;
  lumpSum: boolean;
  allocated: number;
  accepted: number;
  /** 0-100, null when nothing is allocated on the line. */
  percent: number | null;
}
export interface ScopeProgress { lines: ScopeLine[]; overallPercent: number | null }

export function deriveScopeProgress(
  allocations: readonly ProgressLineInput[],
  items: readonly ProgressItemInput[],
  acceptances: readonly ProgressAcceptanceInput[],
): ScopeProgress {
  const itemOf = new Map(items.map((i) => [i.id, i]));
  const accepted = new Map<string, number>();
  for (const a of acceptances) {
    if (a.status !== 'Confirmed') continue;
    for (const l of a.lines) accepted.set(l.boq_item_id, (accepted.get(l.boq_item_id) ?? 0) + Number(l.quantity));
  }
  let valueAllocated = 0;
  let valueAccepted = 0;
  let priced = true;
  const lines: ScopeLine[] = allocations.map((al) => {
    const item = itemOf.get(al.boq_item_id);
    const allocated = Number(al.quantity);
    const done = accepted.get(al.boq_item_id) ?? 0;
    if (item) {
      const rate = Number(item.rate);
      valueAllocated += rate * allocated;
      valueAccepted += rate * Math.min(done, allocated);
    } else {
      priced = false;
    }
    return {
      id: al.id,
      boqItemId: al.boq_item_id,
      itemCode: item?.item_code ?? null,
      description: item?.description ?? null,
      unit: item?.unit ?? null,
      lumpSum: item?.earning_basis === 'lump_sum',
      allocated,
      accepted: done,
      percent: allocated > 0 ? Math.min(100, (done / allocated) * 100) : null,
    };
  });
  return { lines, overallPercent: priced && valueAllocated > 0 ? (valueAccepted / valueAllocated) * 100 : null };
}
