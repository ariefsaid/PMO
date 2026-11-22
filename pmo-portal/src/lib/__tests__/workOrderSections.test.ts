import { describe, expect, it } from 'vitest';
import { allocationFits, allocationHeadroom, quantitiesByUnit, readinessRollup, rollupBySection } from '../workOrderSections';

describe('rollupBySection (AC-WOS-002: the roll-up invariant)', () => {
  it('direct budget: A 400.00 + B 350.00 + remainder 250.00 = 1,000.00 exactly', () => {
    const r = rollupBySection([
      { sectionId: 'a', value: '400.00' },
      { sectionId: 'b', value: '350.00' },
      { sectionId: null, value: '250.00' },
    ]);
    expect(r.total).toBe('1000.00');
    expect(r.remainder).toBe('250.00');
    expect(r.sections).toEqual([{ sectionId: 'a', value: '400.00' }, { sectionId: 'b', value: '350.00' }]);
    expect(r.empty).toBe(false);
  });

  it('cable requested: 40 + 10 + 20 = 70 at three decimals', () => {
    const r = rollupBySection([
      { sectionId: 'a', value: '40.000' }, { sectionId: 'b', value: '10.000' }, { sectionId: null, value: '20.000' },
    ], 3);
    expect(r.total).toBe('70.000');
  });

  it('is exact where floats are not: 0.1 three times is 0.30', () => {
    const r = rollupBySection([
      { sectionId: 'a', value: '0.10' }, { sectionId: 'b', value: '0.10' }, { sectionId: null, value: '0.10' },
    ]);
    expect(r.total).toBe('0.30');
    expect(0.1 + 0.1 + 0.1).not.toBe(0.3);
  });

  it('the remainder is part of the total: dropping it would break the invariant', () => {
    const rows = [{ sectionId: 'a', value: '400.00' }, { sectionId: 'b', value: '350.00' }, { sectionId: null, value: '250.00' }];
    const withRemainder = rollupBySection(rows);
    const sectionsOnly = rows.filter((x) => x.sectionId !== null).reduce((n, x) => n + Number(x.value), 0);
    expect(Number(withRemainder.total)).toBe(sectionsOnly + Number(withRemainder.remainder));
    expect(Number(withRemainder.total)).not.toBe(sectionsOnly);
  });

  it('a section with no figure stays absent, never zero-filled; no figure at all is empty', () => {
    const r = rollupBySection([{ sectionId: 'a', value: null }, { sectionId: null, value: null }]);
    expect(r.sections).toEqual([{ sectionId: 'a', value: null }]);
    expect(r.total).toBe('0.00');
    expect(r.empty).toBe(true);
  });

  it('refuses a malformed figure rather than reading it as zero', () => {
    expect(() => rollupBySection([{ sectionId: 'a', value: 'abc' }])).toThrow();
    expect(() => rollupBySection([{ sectionId: 'a', value: '1.005' }])).toThrow();
  });
});

describe('readinessRollup (AC-WOS-014: the render of the server counts)', () => {
  it('ready, ready, blocked: counts 2/0/1 and all ready is false', () => {
    const r = readinessRollup({ live_sections: 3, ready: 2, not_ready: 0, blocked: 1, all_ready: false });
    expect(r).toMatchObject({ live: 3, ready: 2, notReady: 0, blocked: 1, allReady: false, state: 'blocked' });
  });
  it('every live section ready: all ready', () => {
    expect(readinessRollup({ live_sections: 2, ready: 2, not_ready: 0, blocked: 0, all_ready: true })).toMatchObject({ allReady: true, state: 'all_ready' });
  });
  it('no live section: no roll-up', () => {
    expect(readinessRollup(null).state).toBe('none');
    expect(readinessRollup({ live_sections: 0, ready: 0, not_ready: 0, blocked: 0, all_ready: false }).allReady).toBe(false);
  });
  it('not ready and not blocked is in progress, and never trusts a stale all_ready flag', () => {
    expect(readinessRollup({ live_sections: 2, ready: 1, not_ready: 1, blocked: 0, all_ready: false }).state).toBe('in_progress');
    expect(readinessRollup({ live_sections: 2, ready: 1, not_ready: 1, blocked: 0, all_ready: true }).allReady).toBe(false);
  });
});

describe('quantitiesByUnit (FR-WOS-016)', () => {
  it('sums per section and unit exactly, keeping the remainder under null', () => {
    const out = quantitiesByUnit([
      { sectionId: 'a', unit: 'm', quantity: '0.100' }, { sectionId: 'a', unit: 'm', quantity: '0.200' },
      { sectionId: 'a', unit: 'm2', quantity: '3.000' }, { sectionId: null, unit: 'm', quantity: '1.000' },
    ]);
    expect(out.get('a')).toEqual([{ unit: 'm', quantity: '0.300' }, { unit: 'm2', quantity: '3.000' }]);
    expect(out.get(null)).toEqual([{ unit: 'm', quantity: '1.000' }]);
  });
  it('a malformed quantity throws rather than counting as zero', () => {
    expect(() => quantitiesByUnit([{ sectionId: 'a', unit: 'm', quantity: 'x' }])).toThrow();
  });
});

describe('allocationHeadroom (AC-WOS-008)', () => {
  it('allocations 60 and 30 against a plan of 100 leave 10', () => {
    expect(allocationHeadroom('100.000', ['60.000', '30.000'])).toEqual({ allocated: '90.000', remaining: '10.000', overAllocated: false });
  });
  it('raising B to 50 does not fit; 40 does', () => {
    expect(allocationFits('100.000', ['60.000'], '50.000')).toBe(false);
    expect(allocationFits('100.000', ['60.000'], '40.000')).toBe(true);
  });
  it('a plan that later drops to 80 flags the item and rewrites nothing', () => {
    const r = allocationHeadroom('80.000', ['60.000', '30.000']);
    expect(r).toEqual({ allocated: '90.000', remaining: '-10.000', overAllocated: true });
  });
});
