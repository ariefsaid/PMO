import { describe, it, expect } from 'vitest';
import { classifyMutationError } from './classifyMutationError';
import { AppError } from './appError';

describe('classifyMutationError (ADR-0017, promoted from ProcurementDetails)', () => {
  it('P0001 → illegal-stage headline, verbatim message as detail', () => {
    const e = Object.assign(new Error('illegal transition Requested→Approved'), { code: 'P0001' });
    expect(classifyMutationError(e)).toEqual({
      headline: "That move isn't allowed from the current stage.",
      detail: 'illegal transition Requested→Approved',
    });
  });

  it('42501 → not-permitted / SoD headline', () => {
    const e = Object.assign(new Error('permission denied for transition_procurement'), { code: '42501' });
    expect(classifyMutationError(e)).toEqual({
      headline: "You don't have permission to do that.",
      detail: 'permission denied for transition_procurement',
    });
  });

  it('23505 → duplicate headline', () => {
    const e = Object.assign(new Error('duplicate key value violates unique constraint'), { code: '23505' });
    expect(classifyMutationError(e)).toEqual({
      headline: 'That already exists.',
      detail: 'duplicate key value violates unique constraint',
    });
  });

  it('reads the code carried by an AppError instance', () => {
    const e = new AppError('nope', '42501');
    expect(classifyMutationError(e).headline).toBe("You don't have permission to do that.");
  });

  it('unknown code → generic headline, verbatim detail', () => {
    const e = Object.assign(new Error('something broke'), { code: 'XX999' });
    expect(classifyMutationError(e)).toEqual({ headline: 'Update failed', detail: 'something broke' });
  });

  it('no code → generic headline', () => {
    expect(classifyMutationError(new Error('boom'))).toEqual({ headline: 'Update failed', detail: 'boom' });
  });

  it('non-Error value → generic headline + fallback detail', () => {
    expect(classifyMutationError('weird')).toEqual({ headline: 'Update failed', detail: 'An error occurred' });
  });
});
