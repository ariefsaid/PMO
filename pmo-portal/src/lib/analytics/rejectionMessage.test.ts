import { describe, expect, it } from 'vitest';
import { rejectionMessage } from './rejectionMessage';

describe('rejectionMessage — a real diagnostic message for ANY unhandledrejection reason', () => {
  it('an Error reason returns its .message', () => {
    expect(rejectionMessage(new Error('boom'))).toBe('boom');
  });

  it('a PostgrestError-shaped plain object (Supabase — NOT an Error instance) returns .message, never [object Object]', () => {
    const reason = { message: 'duplicate key value', code: '23505', details: null, hint: null };
    const result = rejectionMessage(reason);
    expect(result).toContain('duplicate key value');
    expect(result).not.toBe('[object Object]');
  });

  it('falls back to .error_description when .message is absent', () => {
    const reason = { error_description: 'invalid_grant: token expired' };
    expect(rejectionMessage(reason)).toContain('invalid_grant: token expired');
  });

  it('falls back to .error when .message and .error_description are both absent', () => {
    const reason = { error: 'network_error' };
    expect(rejectionMessage(reason)).toContain('network_error');
  });

  it('a bare string reason is returned as-is', () => {
    expect(rejectionMessage('a plain string rejection')).toBe('a plain string rejection');
  });

  it('an object with no known message-shaped field falls back to a JSON stringification, never [object Object]', () => {
    const result = rejectionMessage({ statusCode: 500, path: '/api/x' });
    expect(result).not.toBe('[object Object]');
    expect(result).toContain('statusCode');
  });

  it('a circular object falls back gracefully (never throws, never [object Object])', () => {
    const circular: Record<string, unknown> = { code: 'X' };
    circular.self = circular;
    expect(() => rejectionMessage(circular)).not.toThrow();
    const result = rejectionMessage(circular);
    expect(result).not.toBe('[object Object]');
    expect(typeof result).toBe('string');
  });

  it('null/undefined reasons return a safe fallback label, never a literal "null"/"undefined" string leak', () => {
    expect(rejectionMessage(null)).toBe('UnhandledRejection');
    expect(rejectionMessage(undefined)).toBe('UnhandledRejection');
  });
});
