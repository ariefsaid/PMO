import { describe, expect, it } from 'vitest';
import { groupLinesByAttribution, lineDiffersFromRequest, lineValuesOf, ownAttributionByLine } from './lineWorkOrderValue';

describe('AC-WPL-011 line attribution helpers', () => {
  it('a difference is flagged only when both name a work order', () => {
    expect(lineDiffersFromRequest('a', 'b')).toBe(true);
    expect(lineDiffersFromRequest('a', 'a')).toBe(false);
    expect(lineDiffersFromRequest(null, 'b')).toBe(false);
    expect(lineDiffersFromRequest('a', null)).toBe(false);
  });
  it('only lines that name a work order or a discipline are written, and only lines still on the form', () => {
    expect(ownAttributionByLine({
      l1: { workOrderId: 'w1', disciplineId: '' }, l2: { workOrderId: '', disciplineId: '' }, l4: { workOrderId: '', disciplineId: 'd1' }, gone: { workOrderId: 'w9', disciplineId: '' },
    }, ['l1', 'l2', 'l3', 'l4'])).toEqual({ l1: { workOrderId: 'w1', disciplineId: '' }, l4: { workOrderId: '', disciplineId: 'd1' } });
  });
  it('lines are grouped by what they name, one write per group, empty meaning null', () => {
    const groups = groupLinesByAttribution({
      a: { workOrderId: 'w1', disciplineId: '' }, b: { workOrderId: 'w1', disciplineId: '' }, c: { workOrderId: '', disciplineId: '' },
    });
    expect(groups).toEqual([{ workOrderId: 'w1', disciplineId: null, ids: ['a', 'b'] }, { workOrderId: null, disciplineId: null, ids: ['c'] }]);
  });
  it('the saved lines become picker values', () => {
    expect(lineValuesOf([{ id: 'a', work_order_id: 'w1', discipline_id: null }, { id: 'b' }])).toEqual({
      a: { workOrderId: 'w1', disciplineId: '' }, b: { workOrderId: '', disciplineId: '' },
    });
  });
});
