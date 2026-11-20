/**
 * Pure rollup of client material requisitions (#2585, FR-CSR-018/019). Mirrors `csr_work_order_rollup` in SQL:
 * reserved = reservations - releases, collected = pickups, still to collect = reserved - collected,
 * awaiting reservation = max(requested - reserved, 0). Nothing is stored; figures derive from events.
 * Quantities are exact decimals (numeric(14,3)) held as thousandths in a bigint, never floating point.
 */
export type CsrEventKind = 'created' | 'sent' | 'cancelled' | 'reserved' | 'released' | 'pickup';

export interface CsrLine {
  id: string;
  requisitionId: string;
  itemId: string;
  itemName: string;
  unit: string;
  takeoffQuantity: string;
  requestedQuantity: string;
}

export interface CsrEvent {
  lineId: string | null;
  kind: CsrEventKind;
  quantity: string | null;
}

export interface CsrFigures {
  requested: string;
  reserved: string;
  collected: string;
  stillToCollect: string;
  awaitingReservation: string;
}

export interface CsrLineFigures extends CsrFigures {
  lineId: string;
  requisitionId: string;
  itemId: string;
  itemName: string;
  unit: string;
}

export interface CsrItemFigures extends CsrFigures {
  itemId: string;
  itemName: string;
  unit: string;
}

export interface CsrRollup {
  isEmpty: boolean;
  lines: CsrLineFigures[];
  items: CsrItemFigures[];
}

/** Parse a non-negative decimal with up to three places into thousandths; anything else counts as zero. */
export function parseMilli(value: string | null | undefined): bigint {
  if (value == null) return 0n;
  const m = /^(\d+)(?:\.(\d{1,3}))?$/.exec(value.trim());
  if (!m) return 0n;
  return BigInt(m[1]) * 1000n + BigInt((m[2] ?? '').padEnd(3, '0'));
}

export function formatMilli(milli: bigint): string {
  const neg = milli < 0n;
  const abs = neg ? -milli : milli;
  const whole = abs / 1000n;
  const frac = String(abs % 1000n).padStart(3, '0').replace(/0+$/, '');
  return `${neg ? '-' : ''}${whole}${frac ? `.${frac}` : ''}`;
}

interface Acc { requested: bigint; reserved: bigint; released: bigint; collected: bigint; awaiting?: bigint }

function figures(a: Acc): CsrFigures {
  const reserved = a.reserved - a.released;
  const still = reserved - a.collected;
  const awaiting = a.awaiting ?? (a.requested > reserved ? a.requested - reserved : 0n);
  return {
    requested: formatMilli(a.requested),
    reserved: formatMilli(reserved),
    collected: formatMilli(a.collected),
    stillToCollect: formatMilli(still),
    awaitingReservation: formatMilli(awaiting),
  };
}

export function rollupClientRequisitions(lines: CsrLine[], events: CsrEvent[]): CsrRollup {
  if (lines.length === 0) return { isEmpty: true, lines: [], items: [] };
  const byLine = new Map<string, Acc>();
  for (const l of lines) {
    byLine.set(l.id, { requested: parseMilli(l.requestedQuantity), reserved: 0n, released: 0n, collected: 0n });
  }
  for (const e of events) {
    if (!e.lineId) continue;
    const a = byLine.get(e.lineId);
    if (!a) continue;
    const q = parseMilli(e.quantity);
    if (e.kind === 'reserved') a.reserved += q;
    else if (e.kind === 'released') a.released += q;
    else if (e.kind === 'pickup') a.collected += q;
  }
  const itemAcc = new Map<string, { itemId: string; itemName: string; unit: string; acc: Acc }>();
  const lineOut: CsrLineFigures[] = lines.map((l) => {
    const a = byLine.get(l.id)!;
    const key = `${l.itemId}\u0000${l.unit}`;
    const t = itemAcc.get(key) ?? { itemId: l.itemId, itemName: l.itemName, unit: l.unit, acc: { requested: 0n, reserved: 0n, released: 0n, collected: 0n, awaiting: 0n } };
    // Awaiting reservation is per line (never below zero), then summed, so an over-reserved line cannot hide a short one.
    t.acc.requested += a.requested;
    t.acc.reserved += a.reserved;
    t.acc.released += a.released;
    t.acc.collected += a.collected;
    const net = a.reserved - a.released;
    t.acc.awaiting = (t.acc.awaiting ?? 0n) + (a.requested > net ? a.requested - net : 0n);
    itemAcc.set(key, t);
    return { lineId: l.id, requisitionId: l.requisitionId, itemId: l.itemId, itemName: l.itemName, unit: l.unit, ...figures(a) };
  });
  return {
    isEmpty: false,
    lines: lineOut,
    items: [...itemAcc.values()].map((t) => ({ itemId: t.itemId, itemName: t.itemName, unit: t.unit, ...figures(t.acc) })),
  };
}
