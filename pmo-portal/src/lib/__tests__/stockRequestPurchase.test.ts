import { describe, it, expect } from 'vitest';
import { restockQuantity, buildRestockUrl, readOrigin, readRestockLine } from '../stockRequestPurchase';

describe('restockQuantity', () => {
  it('is the shortfall to the reorder level', () => expect(restockQuantity('50', '20')).toBe('30'));
  it('keeps at most 2 decimals, rounding up so the level is reached', () => expect(restockQuantity('10', '2.333')).toBe('7.67'));
  it('falls back to the set order quantity at the level', () => expect(restockQuantity('10', '10', '25')).toBe('25'));
  it('is null when nothing is known', () => expect(restockQuantity('10', '12')).toBeNull());
});

describe('buildRestockUrl', () => {
  it('carries the item line, the project and an explicit origin', () => {
    const u = new URL(buildRestockUrl({ itemCode: 'CEM', itemName: 'Cement', unitCode: 'bag', quantity: '30', projectId: 'p1', from: '/stock?belowReorder=1' }), 'http://x');
    expect(u.pathname).toBe('/procurement/new');
    expect(u.searchParams.get('project')).toBe('p1');
    expect(u.searchParams.get('from')).toBe('/stock?belowReorder=1');
    expect(u.searchParams.get('lineName')).toBe('Cement (bag)');
    expect(u.searchParams.get('lineQty')).toBe('30');
  });
  it('omits project and quantity when unknown', () => {
    const u = new URL(buildRestockUrl({ itemCode: 'CEM', itemName: 'Cement', unitCode: 'bag', quantity: null, projectId: null, from: '/stock/reorder' }), 'http://x');
    expect(u.searchParams.has('project')).toBe(false);
    expect(u.searchParams.has('lineQty')).toBe(false);
  });
});

describe('readOrigin', () => {
  it('accepts an in-app path', () => expect(readOrigin('?from=%2Fstock%2Freorder')).toBe('/stock/reorder'));
  it('rejects an external or protocol-relative target', () => {
    expect(readOrigin('?from=https%3A%2F%2Fevil.test')).toBeNull();
    expect(readOrigin('?from=%2F%2Fevil.test')).toBeNull();
  });
  it('is null when absent', () => expect(readOrigin('')).toBeNull());
});

describe('readRestockLine', () => {
  it('reads a line only when name and a positive quantity are present', () => {
    expect(readRestockLine('?lineName=Cement%20(bag)&lineQty=30')).toEqual({ name: 'Cement (bag)', quantity: 30 });
    expect(readRestockLine('?lineName=Cement')).toBeNull();
    expect(readRestockLine('?lineName=Cement&lineQty=0')).toBeNull();
  });
});
