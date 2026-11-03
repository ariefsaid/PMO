import { describe, expect, it } from 'vitest';
import { INVOICE_POST_ERROR } from '../__fixtures__/revenue.ts';
import type { OdooErrorClass } from '../client.ts';
import { classifyFailure, odooExceptionKind } from './errors.ts';

describe('AC-OCI-061 transport and server failures are pending until a probe settles them', () => {
  it.each([
    [{ errorClass: 'timeout' }, { outcome: 'pending', retry: false }],
    [{ errorClass: 'unreachable' }, { outcome: 'pending', retry: false }],
    [{ errorClass: 'server-error', status: 500 }, { outcome: 'pending', retry: false }],
    [{ errorClass: 'server-error', status: 502 }, { outcome: 'pending', retry: false }],
    [{ errorClass: 'server-error', status: 429 }, { outcome: 'pending', retry: true }],
  ] as const)('%o → %o', (failure, expected) => expect(classifyFailure(failure)).toEqual(expected));
});

describe('AC-OCI-061 a validation failure is commit-rejected with a fixed user-safe reason', () => {
  it('classifies on the exception name over JSON-2: UserError and ValidationError 422, MissingError 404, AccessError 403', () => {
    expect(odooExceptionKind('odoo.exceptions.UserError')).toBe('validation');
    expect(odooExceptionKind('odoo.exceptions.ValidationError')).toBe('validation');
    expect(odooExceptionKind('odoo.exceptions.MissingError')).toBe('missing');
    expect(odooExceptionKind('odoo.exceptions.AccessError')).toBe('access');
    expect(odooExceptionKind('werkzeug.exceptions.NotFound')).toBe('unknown');   // an unknown method or model: the HTTP class decides
    expect(odooExceptionKind('something.Else')).toBe('unknown');
    expect(odooExceptionKind(undefined)).toBe('unknown');
  });
  it('rejects a validation error without echoing Odoo\'s message, arguments, context or traceback', () => {
    const result = classifyFailure({ errorClass: 'validation', status: 422, name: INVOICE_POST_ERROR.name, message: INVOICE_POST_ERROR.message, debug: INVOICE_POST_ERROR.debug } as never);
    expect(result).toMatchObject({ outcome: 'commit-rejected' });
    const json = JSON.stringify(result);
    expect(json).not.toContain(INVOICE_POST_ERROR.message);
    expect(json).not.toContain(INVOICE_POST_ERROR.debug);
  });
  it('a name, when present, decides between validation, missing and access', () => {
    expect(classifyFailure({ errorClass: 'validation', name: 'odoo.exceptions.MissingError' })).toMatchObject({ outcome: 'commit-rejected', reason: expect.stringMatching(/no longer/i) });
    expect(classifyFailure({ errorClass: 'access-denied', name: 'odoo.exceptions.AccessError' })).toMatchObject({ outcome: 'commit-rejected', reason: expect.stringMatching(/access/i) });
  });
});

describe('every client failure class has a classification', () => {
  const ALL: OdooErrorClass[] = ['unreachable', 'timeout', 'tls', 'not-odoo', 'no-json2', 'database-not-found', 'key-rejected', 'access-denied',
    'missing-model', 'validation', 'server-error', 'destination-refused', 'unsupported-version'];
  it.each(ALL)('%s is pending, commit-rejected or refused, never an unclassified throw', (errorClass) => {
    expect(['pending', 'commit-rejected', 'refused']).toContain(classifyFailure({ errorClass }).outcome);
  });
  it('a destination Odoo may not be called is refused with the seam\'s own code', () => {
    expect(classifyFailure({ errorClass: 'destination-refused' })).toEqual({ outcome: 'refused', code: 'destination_not_permitted' });
  });
});
