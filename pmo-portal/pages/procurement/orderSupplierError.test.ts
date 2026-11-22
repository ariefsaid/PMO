import { describe, expect, it } from 'vitest';
import { isOrderNeedsSupplier, orderNeedsSupplierMessage } from './orderSupplierError';

const t = ((_key: string, fallback: string) => fallback) as never;

describe('JOB-PU1 an order refused for its supplier is said in plain words', () => {
  const err = Object.assign(new Error('ORDER_NEEDS_SUPPLIER: choose the supplier before the order is recorded'), { code: '23514' });
  it('names what to do and shows no code', () => {
    expect(isOrderNeedsSupplier(err)).toBe(true);
    const m = orderNeedsSupplierMessage(err, t);
    expect(m?.headline).toBe('Choose the supplier first');
    expect(JSON.stringify(m)).not.toContain('ORDER_NEEDS_SUPPLIER');
  });
  it('leaves any other error alone', () => {
    expect(orderNeedsSupplierMessage(new Error('boom'), t)).toBeNull();
  });
});
