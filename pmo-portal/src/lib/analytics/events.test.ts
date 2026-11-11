import { describe, expect, expectTypeOf, it } from 'vitest';
import { buildEventProperties } from './events';
import type { AuthMethod, AuthFailureReason } from './events';
import { EVENT_PRODUCERS } from './eventCallSites';

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

  // The failed-action payload shapes are proven at the FACADE's actual capture
  // (index.test.ts) — the only production path these events flow through.
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

describe('AC-PHO-043 business events are pre-registered with a facade producer (S5 fills the callers)', () => {
  it.each([
    ['budget_activated', 'trackBudgetActivated'],
    ['invoice_issued', 'trackInvoiceIssued'],
    ['payment_recorded', 'trackPaymentRecorded'],
    ['purchase_approved', 'trackPurchaseApproved'],
  ])('%s -> %s', (event, producer) => {
    expect(EVENT_PRODUCERS[event as keyof typeof EVENT_PRODUCERS]).toEqual({ producer, kind: 'facade' });
  });
});
