/** Heights, in px, of the line editor's filled block (cards plus add-line action), measured in the browser. */
export interface LinesReserve { phone: number; md: number }

/** Movement forms (receive, issue, return, transfer): one blank line card. */
export const MOVEMENT_LINES_RESERVE: Record<string, LinesReserve> = {
  receive: { phone: 318.4, md: 138.2 },
  issue: { phone: 324.3, md: 138.2 },
  return: { phone: 238.4, md: 138.2 },
  transfer: { phone: 238.4, md: 138.2 },
};

const COUNT_NEW = { noWarehouse: { phone: 234, md: 134 }, withWarehouse: { phone: 290, md: 176 } };
const ADJUSTMENT_NEW: LinesReserve = { phone: 320, md: 134 };
/** A reopened draft always shows each line's on-hand row; extra lines add a card plus its remove action. */
const COUNT_DRAFT = { first: { phone: 318, md: 204 }, extra: { phone: 322, md: 208 } };
const ADJUSTMENT_DRAFT = { first: { phone: 348, md: 162 }, extra: { phone: 408, md: 208 }, cost: { phone: 108, md: 48 } };

/**
 * The count / adjustment editor's reserve. A new document is one blank line: a count shows its fill action once a
 * warehouse is chosen; an adjustment is the same either way. A reopened draft sizes to its lines
 * (`inDirectionLines` of an adjustment's lines also carry a unit-cost field).
 */
export function writeOffLinesReserve(o: { kind: 'count' | 'adjustment'; hasWarehouse: boolean; draftLines?: number; inDirectionLines?: number }): LinesReserve {
  const n = o.draftLines ?? 0;
  if (n < 1) {
    if (o.kind === 'adjustment') return ADJUSTMENT_NEW;
    return o.hasWarehouse ? COUNT_NEW.withWarehouse : COUNT_NEW.noWarehouse;
  }
  if (o.kind === 'count') {
    return { phone: COUNT_DRAFT.first.phone + (n - 1) * COUNT_DRAFT.extra.phone, md: COUNT_DRAFT.first.md + (n - 1) * COUNT_DRAFT.extra.md };
  }
  const c = o.inDirectionLines ?? 0;
  return {
    phone: ADJUSTMENT_DRAFT.first.phone + (n - 1) * ADJUSTMENT_DRAFT.extra.phone + c * ADJUSTMENT_DRAFT.cost.phone,
    md: ADJUSTMENT_DRAFT.first.md + (n - 1) * ADJUSTMENT_DRAFT.extra.md + c * ADJUSTMENT_DRAFT.cost.md,
  };
}
