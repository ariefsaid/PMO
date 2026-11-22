/**
 * A purchase line's own work order (wo-per-purchase-line). The line's value always wins when cost is read; a line with
 * none takes the work order the request names. '' is the picker's "same as the request" choice.
 */
export const SAME_AS_REQUEST = '';

export interface LineWorkOrderOption { id: string; label: string; cancelled?: boolean }

/** The choices for one line: the request default first, then the open work orders; a cancelled one stays visible on a line that already carries it. */
export function lineWorkOrderChoices(
  workOrders: readonly LineWorkOrderOption[],
  current: string,
  sameAsRequestLabel: string,
  cancelledSuffix: string,
): { value: string; label: string }[] {
  const open = workOrders.filter((w) => !w.cancelled).map((w) => ({ value: w.id, label: w.label }));
  const held = current ? workOrders.find((w) => w.id === current && w.cancelled) : undefined;
  return [
    { value: SAME_AS_REQUEST, label: sameAsRequestLabel },
    ...open,
    ...(held ? [{ value: held.id, label: `${held.label} (${cancelledSuffix})` }] : []),
  ];
}

/** True when the line names a work order and the request names a different one (information only; never a block). */
export function lineDiffersFromRequest(lineWorkOrderId: string | null | undefined, requestWorkOrderId: string | null | undefined): boolean {
  return Boolean(lineWorkOrderId && requestWorkOrderId && lineWorkOrderId !== requestWorkOrderId);
}

/** The work order the request records agree on: one value across all of them that name one, else none (as the cost read resolves it). */
export function requestWorkOrderOf(records: readonly { work_order_id?: string | null }[]): string | null {
  if (records.length === 0 || records.some((r) => !r.work_order_id)) return null;
  const ids = new Set(records.map((r) => r.work_order_id));
  return ids.size === 1 ? [...ids][0]! : null;
}

/** Lines that name a work order, as { lineId: workOrderId }; "same as the request" lines are left out (nothing to write). */
export function ownWorkOrdersByLine(values: Readonly<Record<string, string>>, lineIds: readonly string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const id of lineIds) if (values[id]) out[id] = values[id]!;
  return out;
}
