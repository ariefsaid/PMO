/**
 * How a failed Odoo call settles (FR-071, FR-074; SD-15). A timeout, a 5xx or a lost response is *pending* until a probe
 * settles it, never failure and never success; a 429 retries under the shared bounded policy and is then pending; a
 * validation error is `commit-rejected` with a fixed, user-safe reason. Odoo's message, arguments, context and traceback
 * never leave this function: only the exception NAME and the HTTP status decide.
 */
import type { OdooErrorClass } from '../client.ts';

export type ExceptionKind = 'validation' | 'missing' | 'access' | 'unknown';
export type FailureOutcome =
  | { outcome: 'pending'; retry: boolean }
  | { outcome: 'commit-rejected'; reason: string }
  | { outcome: 'refused'; code: 'destination_not_permitted' };

/** The six-key failure body carries the Python exception name; that is the classifier over JSON-2 (V-OCI15). */
export function odooExceptionKind(name: unknown): ExceptionKind {
  switch (name) {
    case 'odoo.exceptions.UserError': case 'odoo.exceptions.ValidationError': return 'validation';
    case 'odoo.exceptions.MissingError': return 'missing';
    case 'odoo.exceptions.AccessError': return 'access';
    default: return 'unknown';
  }
}

const REASON = {
  validation: 'Odoo did not accept this document. Check the invoice details and try again.',
  missing: 'A record this document refers to no longer exists in Odoo.',
  access: 'The connection does not have access to do this in Odoo. Ask an administrator to check it.',
  unsupported: 'This Odoo does not support this action.',
} as const;
const rejected = (reason: string): FailureOutcome => ({ outcome: 'commit-rejected', reason });
const PENDING: FailureOutcome = { outcome: 'pending', retry: false };

// Total over the client's failure classes: a new class fails typecheck until it is classified here.
const BY_CLASS: Record<OdooErrorClass, (status?: number) => FailureOutcome> = {
  'timeout': () => PENDING,
  'unreachable': () => PENDING,
  'tls': () => PENDING,
  'server-error': (status) => (status === 429 ? { outcome: 'pending', retry: true } : PENDING),
  'validation': () => rejected(REASON.validation),
  'access-denied': () => rejected(REASON.access),
  'key-rejected': () => rejected(REASON.access),
  'missing-model': () => rejected(REASON.missing),
  'not-odoo': () => rejected(REASON.unsupported),
  'no-json2': () => rejected(REASON.unsupported),
  'database-not-found': () => rejected(REASON.unsupported),
  'unsupported-version': () => rejected(REASON.unsupported),
  'destination-refused': () => ({ outcome: 'refused', code: 'destination_not_permitted' }),
};

export function classifyFailure(failure: { errorClass: OdooErrorClass; status?: number; name?: string }): FailureOutcome {
  const kind = odooExceptionKind(failure.name);
  if (kind === 'missing') return rejected(REASON.missing);
  if (kind === 'access') return rejected(REASON.access);
  if (kind === 'validation') return rejected(REASON.validation);
  return BY_CLASS[failure.errorClass](failure.status);
}
