import { describe, expect, it } from 'vitest';
import { addFollower, buildTickRows, initialTickState, isoWeekStart, type TickState } from './attendanceTick';

const members = ['w1', 'w2', 'w3', 'w4', 'w5', 'w6'].map((id) => ({ worker_id: id, off_rotation: false }));

describe('attendance tick (#2528)', () => {
  it('AC-CRW-005 marking a 6-person crew present for 8 hours with one override to 6 yields six rows with the right hours', () => {
    const state: TickState = { ...initialTickState(members, []), defaultHours: '8' };
    state.people.w4 = { ...state.people.w4, hours: '6' };
    const { rows, errors } = buildTickRows(state);
    expect(errors).toEqual({});
    expect(rows).toHaveLength(6);
    expect(rows.map((r) => [r.worker_id, r.status, r.hours])).toEqual([
      ['w1', 'present', 8], ['w2', 'present', 8], ['w3', 'present', 8],
      ['w4', 'present', 6], ['w5', 'present', 8], ['w6', 'present', 8],
    ]);
  });

  it('AC-CRW-005 an absent person sends no hours, and a blank override falls back to the crew default', () => {
    const state: TickState = { ...initialTickState(members.slice(0, 2), []), defaultHours: '7.5' };
    state.people.w1 = { ...state.people.w1, status: 'absent', hours: '4' };
    state.people.w2 = { ...state.people.w2, hours: '  ' };
    expect(buildTickRows(state).rows).toEqual([
      { worker_id: 'w1', status: 'absent', hours: null, overtime_hours: null, reason: null },
      { worker_id: 'w2', status: 'present', hours: 7.5, overtime_hours: null, reason: null },
    ]);
  });

  it('AC-CRW-005 hours outside 0..24 or a present day with no hours are field errors, not rows', () => {
    const state: TickState = { ...initialTickState(members.slice(0, 2), []), defaultHours: '' };
    state.people.w1 = { ...state.people.w1, hours: '25' };
    const { rows, errors } = buildTickRows(state);
    expect(rows).toEqual([]);
    expect(errors).toEqual({ w1: 'hoursRange', w2: 'hoursRequired' });
  });

  it('AC-CRW-006 an off-rotation person defaults to off rotation and needs a reason to be marked present', () => {
    const state = { ...initialTickState([{ worker_id: 'w1', off_rotation: true }], []), defaultHours: '8' };
    expect(state.people.w1.status).toBe('off_rotation');
    state.people.w1 = { ...state.people.w1, status: 'present' };
    expect(buildTickRows(state).errors).toEqual({ w1: 'reasonRequired' });
    state.people.w1 = { ...state.people.w1, reason: 'Called in' };
    expect(buildTickRows(state).rows[0]).toMatchObject({ status: 'present', hours: 8, reason: 'Called in' });
  });

  it('pre-fills from records already held for the day', () => {
    const state = initialTickState(members.slice(0, 1), [
      { worker_id: 'w1', status: 'present', hours: 6, overtime_hours: 1, reason: null },
    ]);
    expect(state.people.w1).toEqual({ status: 'present', hours: '6', overtime: '1', reason: '' });
  });

  it('finds the Monday of a date', () => {
    expect(isoWeekStart('2026-11-19')).toBe('2026-11-16');
    expect(isoWeekStart('2026-11-16')).toBe('2026-11-16');
    expect(isoWeekStart('2026-11-22')).toBe('2026-11-16');
  });

  it('AC-FOL-008 a person added from another crew is sent with the followed crew; the crew\'s own members are not', () => {
    const state = addFollower({ ...initialTickState(members.slice(0, 1), []), defaultHours: '8' }, 'w9');
    expect(state.order).toEqual(['w1', 'w9']);
    expect(buildTickRows(state, 'c-recv').rows).toEqual([
      { worker_id: 'w1', status: 'present', hours: 8, overtime_hours: null, reason: null },
      { worker_id: 'w9', status: 'present', hours: 8, overtime_hours: null, reason: null, followed_crew_id: 'c-recv' },
    ]);
  });

  it('AC-FOL-008 adding the same person twice, or a member already listed, changes nothing', () => {
    const base = initialTickState(members.slice(0, 1), []);
    const once = addFollower(base, 'w9');
    expect(addFollower(once, 'w9')).toBe(once);
    expect(addFollower(base, 'w1')).toBe(base);
  });
});
