import { describe, it, expect } from 'vitest';
import { mayReserve } from './useStockReservations';

describe('who may reserve', () => {
  it('AC-RSV-005 the screen offers Reserve to the keeper, a planner and an Admin, never while viewing as another role', () => {
    expect(mayReserve('Engineer', false, true)).toBe(true);
    expect(mayReserve('Project Manager', false, false)).toBe(true);
    expect(mayReserve('Admin', false, false)).toBe(true);
    expect(mayReserve('Engineer', false, false)).toBe(false);
    expect(mayReserve('Admin', true, true)).toBe(false);
  });
});
