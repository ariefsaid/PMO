import { describe, it, expect } from 'vitest';
import {
  rollupClientRequisitions,
  rollupEvents,
  type CsrLine,
  type CsrEvent,
} from '../clientRequisitionRollup';

// AC-CSR-001 hand calculation: take-off 100, requested 100; reservations 60 and 20, release 10, pickups 50.
// Reserved 70, collected 50, still to collect 20, awaiting reservation 30.
const line: CsrLine = {
  id: 'l1', requisitionId: 'r1', itemId: 'i-cement', itemName: 'Cement', unit: 'BAG',
  takeoffQuantity: '100', requestedQuantity: '100',
};
const events: CsrEvent[] = [
  { lineId: 'l1', kind: 'reserved', quantity: '60' },
  { lineId: 'l1', kind: 'reserved', quantity: '20' },
  { lineId: 'l1', kind: 'released', quantity: '10' },
  { lineId: 'l1', kind: 'pickup', quantity: '50' },
  { lineId: null, kind: 'sent', quantity: null },
];

describe('rollupClientRequisitions', () => {
  it('AC-CSR-001 reserved 70, collected 50, still to collect 20, awaiting reservation 30', () => {
    const r = rollupClientRequisitions([line], events);
    expect(r.isEmpty).toBe(false);
    expect(r.lines[0]).toMatchObject({
      lineId: 'l1', requested: '100', reserved: '70', collected: '50', stillToCollect: '20', awaitingReservation: '30',
    });
    expect(r.items).toHaveLength(1);
    expect(r.items[0]).toMatchObject({
      itemId: 'i-cement', unit: 'BAG', requested: '100', reserved: '70', collected: '50', stillToCollect: '20', awaitingReservation: '30',
    });
  });

  it('AC-CSR-001 only reserved, released and pickup events sum; header events carry no quantity', () => {
    const r = rollupClientRequisitions([line], [{ lineId: null, kind: 'created', quantity: null }, { lineId: null, kind: 'cancelled', quantity: null }]);
    expect(r.lines[0]).toMatchObject({ reserved: '0', collected: '0', stillToCollect: '0', awaitingReservation: '100' });
  });

  it('awaiting reservation never goes below zero (reserved above requested)', () => {
    const r = rollupClientRequisitions([line], [{ lineId: 'l1', kind: 'reserved', quantity: '120' }]);
    expect(r.lines[0].awaitingReservation).toBe('0');
    expect(r.lines[0].stillToCollect).toBe('120');
  });

  it('keeps three-decimal quantities exact', () => {
    const l: CsrLine = { ...line, takeoffQuantity: '0.3', requestedQuantity: '0.3' };
    const r = rollupClientRequisitions([l], [
      { lineId: 'l1', kind: 'reserved', quantity: '0.1' },
      { lineId: 'l1', kind: 'reserved', quantity: '0.2' },
    ]);
    expect(r.lines[0].reserved).toBe('0.3');
    expect(r.lines[0].awaitingReservation).toBe('0');
  });

  it('AC-CSR-002 lines of different units are shown separately, never added', () => {
    const other: CsrLine = { ...line, id: 'l2', itemId: 'i-cement', unit: 'KG', requestedQuantity: '40', takeoffQuantity: '40' };
    const r = rollupClientRequisitions([line, other], [...events, { lineId: 'l2', kind: 'reserved', quantity: '5' }]);
    expect(r.items).toHaveLength(2);
    const bag = r.items.find((i) => i.unit === 'BAG');
    const kg = r.items.find((i) => i.unit === 'KG');
    expect(bag?.requested).toBe('100');
    expect(kg).toMatchObject({ requested: '40', reserved: '5', awaitingReservation: '35' });
  });

  it('sums lines of one item and unit across requisitions', () => {
    const second: CsrLine = { ...line, id: 'l3', requisitionId: 'r2', requestedQuantity: '10', takeoffQuantity: '10' };
    const r = rollupClientRequisitions([line, second], [...events, { lineId: 'l3', kind: 'reserved', quantity: '4' }]);
    expect(r.items).toHaveLength(1);
    expect(r.items[0]).toMatchObject({ requested: '110', reserved: '74', awaitingReservation: '36' });
  });

  it('AC-CSR-003 no requisition shows an empty state, not zeros', () => {
    const r = rollupClientRequisitions([], []);
    expect(r.isEmpty).toBe(true);
    expect(r.items).toEqual([]);
    expect(r.lines).toEqual([]);
  });

  it('an invalid quantity string is ignored rather than turned into NaN', () => {
    const r = rollupClientRequisitions([line], [{ lineId: 'l1', kind: 'reserved', quantity: 'abc' }]);
    expect(r.lines[0].reserved).toBe('0');
  });
});

describe('item awaiting reservation', () => {
  it('sums per-line shortfalls so an over-reserved line does not hide a short one', () => {
    const a: CsrLine = { ...line, id: 'a', requestedQuantity: '10', takeoffQuantity: '10' };
    const b: CsrLine = { ...line, id: 'b', requestedQuantity: '10', takeoffQuantity: '10' };
    const r = rollupClientRequisitions([a, b], [{ lineId: 'a', kind: 'reserved', quantity: '15' }]);
    expect(r.items[0].awaitingReservation).toBe('10');
  });
});

describe('rollupEvents', () => {
  it('AC-CSR-001 collected comes from the pickup rows, once, whatever pickup events the log also holds', () => {
    const merged = rollupEvents(events, [{ lineId: 'l1', quantity: '50' }]);
    expect(merged.filter((e) => e.kind === 'pickup')).toHaveLength(1);
    const r = rollupClientRequisitions([line], merged);
    expect(r.lines[0]).toMatchObject({ reserved: '70', collected: '50', stillToCollect: '20', awaitingReservation: '30' });
  });
});
