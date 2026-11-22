import { describe, expect, it } from 'vitest';
import { lineDiffersFromRequest, ownWorkOrdersByLine, requestWorkOrderOf } from './lineWorkOrderValue';

describe('AC-WPL-011 line work order helpers', () => {
  it('the request’s work order is the one value every request record names, else none (as the cost read resolves it)', () => {
    expect(requestWorkOrderOf([{ work_order_id: 'a' }, { work_order_id: 'a' }])).toBe('a');
    expect(requestWorkOrderOf([{ work_order_id: 'a' }, { work_order_id: 'b' }])).toBeNull();
    expect(requestWorkOrderOf([{ work_order_id: 'a' }, { work_order_id: null }])).toBeNull();
    expect(requestWorkOrderOf([])).toBeNull();
  });
  it('a difference is flagged only when both name a work order', () => {
    expect(lineDiffersFromRequest('a', 'b')).toBe(true);
    expect(lineDiffersFromRequest('a', 'a')).toBe(false);
    expect(lineDiffersFromRequest(null, 'b')).toBe(false);
    expect(lineDiffersFromRequest('a', null)).toBe(false);
  });
  it('only lines that name their own work order are written, and only lines still on the form', () => {
    expect(ownWorkOrdersByLine({ l1: 'w1', l2: '', gone: 'w9' }, ['l1', 'l2', 'l3'])).toEqual({ l1: 'w1' });
  });
});
