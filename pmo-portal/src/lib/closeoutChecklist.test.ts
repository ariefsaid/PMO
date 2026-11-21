import { describe, expect, it } from 'vitest';
import { closeoutItemAgeDays, closeoutRemaining, currentCloseoutIndex } from './closeoutChecklist';

describe('closeout checklist derivations', () => {
  it('AC-WCO-008 an open first item counts from the issue date to today', () => {
    expect(closeoutItemAgeDays({ startedOn: '2026-03-01', doneOn: null }, '2026-03-11')).toBe(10);
  });
  it('AC-WCO-008 a later item counts from the previous item done date, and a done item stops at its done date', () => {
    expect(closeoutItemAgeDays({ startedOn: '2026-03-05', doneOn: null }, '2026-03-11')).toBe(6);
    expect(closeoutItemAgeDays({ startedOn: '2026-03-05', doneOn: '2026-03-08' }, '2026-03-30')).toBe(3);
  });
  it('AC-WCO-008 an item that has not started has no age', () => {
    expect(closeoutItemAgeDays({ startedOn: null, doneOn: null }, '2026-03-11')).toBeNull();
  });
  it('AC-WCO-011 only required items not done stand between the work order and closing', () => {
    const items = [
      { required: true, doneOn: '2026-03-02' },
      { required: true, doneOn: null },
      { required: false, doneOn: null },
      { required: true, doneOn: null },
    ];
    expect(closeoutRemaining(items)).toBe(2);
    expect(closeoutRemaining([])).toBe(0);
  });
  it('the current item is the first one not done', () => {
    expect(currentCloseoutIndex([{ doneOn: '2026-03-02' }, { doneOn: null }, { doneOn: null }])).toBe(1);
    expect(currentCloseoutIndex([{ doneOn: '2026-03-02' }])).toBeNull();
  });
});
