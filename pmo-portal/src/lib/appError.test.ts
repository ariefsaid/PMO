import { describe, it, expect } from 'vitest';
import { AppError, toAppError } from './appError';

describe('AppError (ADR-0017 shared error contract)', () => {
  it('is an Error subclass carrying message + optional code', () => {
    const e = new AppError('boom', 'P0001');
    expect(e).toBeInstanceOf(Error);
    expect(e).toBeInstanceOf(AppError);
    expect(e.message).toBe('boom');
    expect(e.code).toBe('P0001');
    expect(e.name).toBe('AppError');
  });

  it('allows an undefined code', () => {
    const e = new AppError('plain');
    expect(e.code).toBeUndefined();
    expect(e.message).toBe('plain');
  });
});

describe('toAppError (normalizes any thrown value, preserving code)', () => {
  it('returns the same instance when already an AppError', () => {
    const e = new AppError('already', '23505');
    expect(toAppError(e)).toBe(e);
  });

  it('preserves the string .code carried by ProcurementError / TimesheetWriteError style errors', () => {
    const legacy = Object.assign(new Error('permission denied'), { code: '42501' });
    const e = toAppError(legacy);
    expect(e).toBeInstanceOf(AppError);
    expect(e.message).toBe('permission denied');
    expect(e.code).toBe('42501');
  });

  it('maps a plain Error (no code) to an AppError with undefined code', () => {
    const e = toAppError(new Error('network down'));
    expect(e).toBeInstanceOf(AppError);
    expect(e.message).toBe('network down');
    expect(e.code).toBeUndefined();
  });

  it('ignores a non-string .code', () => {
    const weird = Object.assign(new Error('odd'), { code: 500 });
    expect(toAppError(weird).code).toBeUndefined();
  });

  it('maps a non-Error thrown value to a generic AppError', () => {
    const e = toAppError('a bare string');
    expect(e).toBeInstanceOf(AppError);
    expect(e.message).toBe('An unexpected error occurred');
    expect(e.code).toBeUndefined();
  });
});
