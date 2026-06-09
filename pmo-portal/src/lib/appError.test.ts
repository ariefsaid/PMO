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

  // F6: PostgREST / supabase-js client errors are plain objects { message, code } (NOT Error
  // instances). toAppError must preserve both so classifyMutationError can map the code.
  it('preserves message + code from a PostgREST plain-object error (the supabase-js shape)', () => {
    const e = toAppError({ message: 'permission denied for table budget_versions', code: '42501' });
    expect(e).toBeInstanceOf(AppError);
    expect(e.message).toBe('permission denied for table budget_versions');
    expect(e.code).toBe('42501');
  });
  it('degrades a plain object without a string message to the generic message (no [object Object] leak)', () => {
    const e = toAppError({ foo: 1 });
    expect(e.message).toBe('An unexpected error occurred');
    expect(e.code).toBeUndefined();
  });
  it('drops a non-string code on a plain object', () => {
    expect(toAppError({ message: 'x', code: 500 }).code).toBeUndefined();
  });
  it('handles array / null without throwing', () => {
    expect(toAppError([]).message).toBe('An unexpected error occurred');
    expect(toAppError(null).message).toBe('An unexpected error occurred');
  });
});
