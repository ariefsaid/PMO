import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  buildEventProperties,
  trackFormValidationFailed,
  trackSaveFailed,
  trackBulkImportFailed,
  trackEmptyStateSeen,
} from './events';
import type { AuthMethod, AuthFailureReason } from './events';

describe('analytics event sanitizer', () => {
  it('AC-PH-014: blocks forbidden property keys in dev/test', () => {
    expect(() => buildEventProperties('save_failed', {
      failure_class: 'project',
      operation: 'update',
      reason_code: 'network',
      module: 'projects',
      email: 'pm@acme.test',
    }, false)).toThrow(/forbidden analytics property/i);
  });

  it('AC-PH-014: blocks forbidden property keys in dev/test (token)', () => {
    expect(() => buildEventProperties('auth_login_failed', {
      method: 'password',
      reason_code: 'invalid_credentials',
      access_token: 'abc123',
    }, false)).toThrow(/forbidden analytics property/i);
  });

  it('AC-PH-014: drops forbidden keys silently in production', () => {
    const result = buildEventProperties('save_failed', {
      failure_class: 'project',
      operation: 'update',
      reason_code: 'network',
      module: 'projects',
      email: 'pm@acme.test',
    }, true);
    expect(result).not.toHaveProperty('email');
    expect(result).toMatchObject({
      failure_class: 'project',
      operation: 'update',
      reason_code: 'network',
      module: 'projects',
    });
  });

  it('AC-PH-014: blocks unsafe nested object values in dev/test', () => {
    expect(() => buildEventProperties('save_failed', {
      failure_class: 'project',
      details: { raw: 'object' } as unknown as string,
    }, false)).toThrow(/unsafe analytics value/i);
  });

  it('AC-PH-014: drops unsafe nested values silently in production', () => {
    const result = buildEventProperties('save_failed', {
      failure_class: 'project',
      details: { raw: 'object' } as unknown as string,
    }, true);
    expect(result).not.toHaveProperty('details');
    expect(result).toMatchObject({ failure_class: 'project' });
  });

  it('AC-PH-014: allows safe values through', () => {
    const result = buildEventProperties('save_failed', {
      failure_class: 'project',
      operation: 'update',
      reason_code: 'network',
      module: 'projects',
      field_count: 2,
      is_retry: true,
    }, false);
    expect(result).toEqual({
      failure_class: 'project',
      operation: 'update',
      reason_code: 'network',
      module: 'projects',
      field_count: 2,
      is_retry: true,
    });
  });

  it('AC-PH-013: failed-action helpers emit safe metadata only', () => {
    expect(trackFormValidationFailed('project-form', 2, 'required', 'projects')).toMatchObject({
      event: 'form_validation_failed',
      properties: { form_id: 'project-form', field_count: 2, reason_code: 'required', module: 'projects' },
    });
    expect(trackSaveFailed('permission_denied', 'update', 'network', 'projects').event).toBe('save_failed');
    expect(trackSaveFailed('permission_denied', 'update', 'network', 'projects').properties).toMatchObject({
      failure_class: 'permission_denied',
      operation: 'update',
      reason_code: 'network',
      module: 'projects',
    });
    expect(trackEmptyStateSeen('project-list-empty', 'Project Manager', 'projects').event).toBe('empty_state_seen');
    expect(trackEmptyStateSeen('project-list-empty', 'Project Manager', 'projects').properties).toMatchObject({
      state_id: 'project-list-empty',
      role: 'Project Manager',
      module: 'projects',
    });
  });

  // 2026-07-27 code-quality review #2: `bulk_import_failed` is a DISTINCT event from `save_failed`
  // (never a lump `failed_count` bolted onto save_failed's existing shape — that mixed two units
  // of measurement, see classifyMutationError.ts's trackBatchSaveFailed doc comment).
  it('AC-PH-013: trackBulkImportFailed emits a distinct event with module/failure_class/failed_count', () => {
    expect(trackBulkImportFailed('companies', 'permission_denied', 4800)).toEqual({
      event: 'bulk_import_failed',
      properties: { module: 'companies', failure_class: 'permission_denied', failed_count: 4800 },
    });
  });
});

describe('auth analytics unions (FR-AUTHF-061)', () => {
  it('AC-AUTHF-061: AuthMethod includes password_reset + invite_accept', () => {
    const m: AuthMethod[] = ['password', 'magic_link', 'password_reset', 'invite_accept'];
    expectTypeOf(m).toEqualTypeOf<AuthMethod[]>();
  });

  it('AC-AUTHF-061: AuthFailureReason includes email_not_confirmed + weak_password + expired_token', () => {
    const r: AuthFailureReason[] = [
      'invalid_credentials',
      'auth_error',
      'email_not_confirmed',
      'weak_password',
      'expired_token',
    ];
    expectTypeOf(r).toEqualTypeOf<AuthFailureReason[]>();
  });
});
