import { expect, it } from 'vitest';
import { anchorValue, externalIdentifier, ODOO_ANCHORS } from './anchors.ts';
it('uses validated keys and separates identifiers from payment memo', () => {
  const key = 'po:123e4567-e89b-12d3-a456-426614174000';
  expect(anchorValue(key)).toBe(`pmo:${key}`);
  expect(externalIdentifier(key)).toEqual({ module: 'pmo', name: 'po_123e4567_e89b_12d3_a456_426614174000' });
  expect(() => anchorValue('po:bad')).toThrow();
  expect(ODOO_ANCHORS.order.mutable).toBe(false);
  expect(ODOO_ANCHORS.payment.mutable).toBe(true);
});
