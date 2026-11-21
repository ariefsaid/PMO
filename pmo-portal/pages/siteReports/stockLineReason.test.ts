import { describe, expect, it } from 'vitest';
import type { TFunction } from 'i18next';
import { stockLineReason } from './stockLineReason';
import type { DsrStockLine } from '@/src/lib/db/dsrStockIssue';

/** The plain-words reason per flagged line state (FR-DRS-031): the catalogue key each state maps to. */
const t = ((key: string, opts?: Record<string, unknown>) => `${key}?${opts ? JSON.stringify(opts) : ''}`) as unknown as (k: string, o?: Record<string, unknown>) => string;

const line = (o: Partial<DsrStockLine> = {}): DsrStockLine => ({
  consumableId: 'c1', position: 1, itemCode: 'CEM', itemName: 'Cement', unit: 'bag', quantity: '10',
  state: 'short', shortBy: '4', reason: null,
  ...o,
});

describe('stockLineReason', () => {
  it('a short line names the shortfall and the location', () => {
    expect(stockLineReason(t, line(), 'Yard A')).toContain('stock.reason.short');
    expect(stockLineReason(t, line(), 'Yard A')).toContain('"n":"4"');
    expect(stockLineReason(t, line(), 'Yard A')).toContain('Yard A');
  });

  it('a line with no location says so', () => {
    expect(stockLineReason(t, line({ state: 'no_location' }), null)).toContain('stock.reason.noLocation');
  });

  it('a line with no work item says so', () => {
    expect(stockLineReason(t, line({ state: 'no_work_item' }), null)).toContain('stock.reason.noWorkItem');
  });

  it('a failed line shows the database reason code as written', () => {
    expect(stockLineReason(t, line({ state: 'failed', reason: 'insufficient stock' }), null)).toContain('insufficient stock');
  });

  it('a not-stocked item says so, and any other state says nothing', () => {
    expect(stockLineReason(t, line({ state: 'not_stocked' }), null)).toContain('stock.reason.notStocked');
    expect(stockLineReason(t, line({ state: 'pending' }), null)).toBe('');
  });
});
