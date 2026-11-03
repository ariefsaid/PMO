import { describe, expect, it } from 'vitest';
import { qualifiedId, unqualifiedId } from './externalId.ts';

describe('the model-qualified external id (Odoo ids are per model)', () => {
  it('qualifies by model, so a bill and an order with the same Odoo id are different references', () => {
    expect(qualifiedId('account.move', 42)).toBe('account.move:42');
    expect(qualifiedId('account.move', 42)).not.toBe(qualifiedId('purchase.order', 42));
  });
  it('reads back only its own model\'s id', () => {
    expect(unqualifiedId('account.move:42', 'account.move')).toBe(42);
    expect(unqualifiedId('purchase.order:42', 'account.move')).toBeNull();
  });
  it.each([['42'], [''], [null], [undefined], ['account.move:'], ['account.move:0'], ['account.move:4a'], ['account.move:1234567890'], ['x:y:5']])('%s is not a qualified id', (ref) => {
    expect(unqualifiedId(ref as string, 'account.move')).toBeNull();
  });
});
