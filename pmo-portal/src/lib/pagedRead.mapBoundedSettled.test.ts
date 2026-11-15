import { describe, expect, it } from 'vitest';
import { mapBoundedSettled } from './pagedRead';

describe('mapBoundedSettled (bulk writes: bounded, every item attempted, failures named per item)', () => {
  it('runs 150 items with never more than 5 in flight', async () => {
    let inFlight = 0;
    let peak = 0;
    const items = Array.from({ length: 150 }, (_, i) => i);
    const results = await mapBoundedSettled(items, 5, async (n) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 1));
      inFlight -= 1;
      return n;
    });
    expect(peak).toBeLessThanOrEqual(5);
    expect(peak).toBeGreaterThan(1);
    expect(results.every((r) => r.status === 'fulfilled')).toBe(true);
  });

  it('one failing item leaves the other 149 written and names the one', async () => {
    const written: number[] = [];
    const items = Array.from({ length: 150 }, (_, i) => i);
    const results = await mapBoundedSettled(items, 5, async (n) => {
      await Promise.resolve();
      if (n === 42) throw new Error('item 42 failed');
      written.push(n);
    });
    expect(written).toHaveLength(149);
    expect(written).not.toContain(42);
    const failed = items.filter((_, i) => results[i]!.status === 'rejected');
    expect(failed).toEqual([42]);
    expect((results[42] as PromiseRejectedResult).reason).toEqual(new Error('item 42 failed'));
  });
});
