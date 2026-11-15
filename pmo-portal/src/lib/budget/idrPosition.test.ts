import { describe, expect, it } from 'vitest';
import { idrPosition, toIdr } from './idrPosition';

const RATE = 18500;

describe('rupiah position for a budget in mixed currencies', () => {
  it('a USD budget against IDR spending: Budget used and Left are computed in IDR', () => {
    const p = idrPosition({
      budget: { amount: 100000, currency: 'USD' },
      spent: { amount: 780000000, currency: 'IDR' },
      committed: { amount: 0, currency: 'IDR' },
    }, RATE);
    expect(p.budget).toBe(1850000000);
    expect(p.usedPercent).toBe(42);
    expect(p.usedApproximate).toBe(true);
    expect(p.left).toBe(1070000000);
  });

  it('an IDR budget with USD commitments converts only the commitments', () => {
    const p = idrPosition({
      budget: { amount: 2000000000, currency: 'IDR' },
      spent: { amount: 500000000, currency: 'IDR' },
      committed: { amount: 10000, currency: 'USD' },
    }, RATE);
    expect(p.committed).toBe(185000000);
    expect(p.usedPercent).toBe(25);
    expect(p.usedApproximate).toBe(false); // budget and spending share a currency: exact, no rate involved
    expect(p.left).toBe(2000000000 - 500000000 - 185000000);
  });

  it('without a rate a USD figure is unknown, so a figure that needs it stays unknown', () => {
    const p = idrPosition({
      budget: { amount: 100000, currency: 'USD' },
      spent: { amount: 780000000, currency: 'IDR' },
      committed: { amount: 0, currency: 'IDR' },
    }, null);
    expect(p.usedPercent).toBeNull();
    expect(p.left).toBeNull();
  });

  it('unknown spending or open orders leave Used / Left unknown, and a zero budget has no percentage', () => {
    expect(idrPosition({ budget: { amount: 1, currency: 'IDR' }, spent: { amount: null, currency: 'IDR' }, committed: { amount: 0, currency: 'IDR' } }, RATE).usedPercent).toBeNull();
    expect(idrPosition({ budget: { amount: 100, currency: 'IDR' }, spent: { amount: 10, currency: 'IDR' }, committed: { amount: null, currency: 'IDR' } }, RATE).left).toBeNull();
    expect(idrPosition({ budget: { amount: 0, currency: 'IDR' }, spent: { amount: 10, currency: 'IDR' }, committed: { amount: 0, currency: 'IDR' } }, RATE).usedPercent).toBeNull();
  });

  it('only USD and IDR convert; another currency is never guessed', () => {
    expect(toIdr({ amount: 5, currency: 'EUR' }, RATE)).toBeNull();
    expect(toIdr({ amount: 5, currency: 'USD' }, 0)).toBeNull();
  });
});
