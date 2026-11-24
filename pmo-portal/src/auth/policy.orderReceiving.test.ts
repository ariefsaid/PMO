import { describe, expect, it } from 'vitest';
import { can } from './policy';

describe('order receiving affordances', () => {
  it('uses the database purchasing witness and a different real actor for excess approval', () => {
    const ctx = { realRole: 'Engineer' as const, currentUserId: 'buyer', record: { receivingPurchaser: true, created_by: 'receiver' } };
    expect(can('edit', 'orderReceiving', ctx)).toBe(true);
    expect(can('approve', 'orderReceiving', ctx)).toBe(true);
    expect(can('approve', 'orderReceiving', { ...ctx, currentUserId: 'receiver' })).toBe(false);
    expect(can('edit', 'orderReceiving', { ...ctx, record: { ...ctx.record, receivingPurchaser: false } })).toBe(false);
    expect(can('approve', 'orderReceiving', { ...ctx, record: { ...ctx.record, viewOnly: true } })).toBe(false);
  });
  it('only a real Admin can change the setting', () => {
    expect(can('manage', 'orderReceiving', { realRole: 'Admin' })).toBe(true);
    expect(can('manage', 'orderReceiving', { realRole: 'Finance' })).toBe(false);
    expect(can('manage', 'orderReceiving', { realRole: 'Admin', record: { viewOnly: true } })).toBe(false);
  });
});
