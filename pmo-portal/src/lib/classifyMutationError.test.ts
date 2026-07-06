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

  it('23503 → still-in-use headline, verbatim FK message as detail (in-use delete)', () => {
    const e = Object.assign(
      new Error('update or delete on table "companies" violates foreign key constraint'),
      { code: '23503' },
    );
    expect(classifyMutationError(e)).toEqual({
      headline: 'Still in use',
      detail: 'update or delete on table "companies" violates foreign key constraint',
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

  it('AC-INV: an optional overrides map classifies a caller-specific code (e.g. an edge-fn error code)', () => {
    const e = new AppError('DUPLICATE_EMAIL', 'DUPLICATE_EMAIL');
    expect(
      classifyMutationError(e, { DUPLICATE_EMAIL: 'That person is already in your workspace.' }),
    ).toEqual({ headline: 'That person is already in your workspace.', detail: 'DUPLICATE_EMAIL' });
  });

  it('AC-INV: overrides take precedence over the built-in Postgres-code mapping for the same code', () => {
    const e = Object.assign(new Error('nope'), { code: '42501' });
    expect(classifyMutationError(e, { '42501': 'Custom message' }).headline).toBe('Custom message');
  });

  it('AC-INV: an unmatched code falls through to the generic headline even with overrides present', () => {
    const e = Object.assign(new Error('boom'), { code: 'UNKNOWN_ONE' });
    expect(classifyMutationError(e, { DUPLICATE_EMAIL: 'x' }).headline).toBe('Update failed');
  });
});
