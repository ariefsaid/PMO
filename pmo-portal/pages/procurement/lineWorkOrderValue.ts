/**
 * A purchase line's own work order and discipline (wo-per-purchase-line, trace only). '' is the picker's "same as the request"
 * (nothing named on the line). The line value is shown, never summed: cost reads stay on the records.
 */
export const SAME_AS_REQUEST = '';

export interface LineAttributionValue { workOrderId: string; disciplineId: string }
export const NO_LINE_ATTRIBUTION: LineAttributionValue = { workOrderId: SAME_AS_REQUEST, disciplineId: SAME_AS_REQUEST };

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

/** The line rows as picker values. */
export function lineValuesOf(items: readonly { id: string; work_order_id?: string | null; discipline_id?: string | null }[]): Record<string, LineAttributionValue> {
  return Object.fromEntries(items.map((i) => [i.id, { workOrderId: i.work_order_id ?? SAME_AS_REQUEST, disciplineId: i.discipline_id ?? SAME_AS_REQUEST }]));
}

/** Lines that name a work order or a discipline, for the lines still on the form; "same as the request" lines are left out (nothing to write). */
export function ownAttributionByLine(values: Readonly<Record<string, LineAttributionValue>>, lineIds: readonly string[]): Record<string, LineAttributionValue> {
  const out: Record<string, LineAttributionValue> = {};
  for (const id of lineIds) {
    const v = values[id];
    if (v && (v.workOrderId || v.disciplineId)) out[id] = v;
  }
  return out;
}

/** Lines grouped by what they name, one write per group. */
export function groupLinesByAttribution(byLine: Readonly<Record<string, LineAttributionValue>>): { workOrderId: string | null; disciplineId: string | null; ids: string[] }[] {
  const groups = new Map<string, { workOrderId: string | null; disciplineId: string | null; ids: string[] }>();
  for (const [id, v] of Object.entries(byLine)) {
    const key = `${v.workOrderId}|${v.disciplineId}`;
    const g = groups.get(key) ?? { workOrderId: v.workOrderId || null, disciplineId: v.disciplineId || null, ids: [] };
    g.ids.push(id);
    groups.set(key, g);
  }
  return [...groups.values()];
}
