/**
 * AC-ENA-030/031 — erpnext/moneyShape.ts: every money/rate/qty/outstanding/allocated/total crosses
 * the contract as a decimal STRING (design decision #4); ERP `null`/absent maps to SQL `NULL`, never
 * `0`; a value exceeding `numeric(14,2)` is `commit-rejected`. The mirrored ERP header total is
 * always the money oracle — never a PMO-side Σ of the lines (ADR-0048).
 */
import { describe, expect, it } from 'vitest';
import { mirrorMoney, PROCUREMENT_ITEMS_AMOUNT_ORACLE_COLUMN, toDecimalString } from './moneyShape.ts';
import { AdapterError } from '../contract.ts';

describe('erpnext/moneyShape', () => {
  describe('AC-ENA-030 — Purchase Invoice header + line round-trip exactly, no JS float artifact', () => {
    it('round-trips the header grand_total/outstanding_amount exactly', () => {
      expect(toDecimalString('150000.00')).toBe('150000.00');
      expect(toDecimalString(150000)).toBe('150000.00');
      expect(toDecimalString('0.00')).toBe('0.00');
      expect(toDecimalString(0)).toBe('0.00');
    });

    it('round-trips line qty/rate/amount exactly (the header total remains the oracle, never Σ lines)', () => {
      expect(toDecimalString('2')).toBe('2.00');
      expect(toDecimalString('100000.00')).toBe('100000.00');
      expect(toDecimalString('200000.00')).toBe('200000.00');
    });

    it('never derives a float artifact for a fractional currency amount (33.33 stays 33.33, not 33.330000000000005)', () => {
      expect(toDecimalString(33.33)).toBe('33.33');
      expect(toDecimalString('1.005')).toBe('1.01'); // round-half-up, not toFixed's known misround to 1.00
    });

    it('rejects a value exceeding numeric(14,2) as commit-rejected', () => {
      expect(() => toDecimalString('1000000000000.00')).toThrow(AdapterError); // 13 integer digits
      try {
        toDecimalString('1000000000000.00');
      } catch (err) {
        expect((err as AdapterError).code).toBe('commit-rejected');
      }
      expect(toDecimalString('999999999999.99')).toBe('999999999999.99'); // the exact boundary, 12 digits
    });

    it('rejects a non-numeric value as commit-rejected', () => {
      expect(() => toDecimalString('not-a-number')).toThrow(AdapterError);
    });
  });

  describe('AC-ENA-031 — Payment Entry paid_amount/allocated_amount -> payments.amount exactly; absent -> NULL', () => {
    it('maps a present paid_amount/allocated_amount to the exact decimal string', () => {
      expect(mirrorMoney(150000)).toBe('150000.00');
      expect(mirrorMoney('150000.00')).toBe('150000.00');
    });

    it('maps ERP null/undefined/absent to SQL NULL — never 0', () => {
      expect(mirrorMoney(null)).toBeNull();
      expect(mirrorMoney(undefined)).toBeNull();
      expect(mirrorMoney('')).toBeNull();
    });

    it('an over-scale allocated_amount is commit-rejected', () => {
      expect(() => mirrorMoney('1000000000000.00')).toThrow(AdapterError);
    });
  });

  it('documents the procurement_items.amount GENERATED-column divergence: the money oracle is erp_line_amount, never the generated `amount`', () => {
    expect(PROCUREMENT_ITEMS_AMOUNT_ORACLE_COLUMN).toBe('erp_line_amount');
  });
});
