/**
 * FR-PHG-030/031, AC-PHG-030. Exceeding a PostHog free allowance is DESTRUCTIVE, not billed:
 * ingestion stops and the excess is "lost forever". A mid-month quota stop flattens every chart —
 * which is indistinguishable from nobody using the product. PostHog's own 80%/100% emails go only
 * to the org owner and are easy to miss.
 */
import { describe, it, expect } from 'vitest';
import { evaluateQuota, validateQuotaEnv } from '../../../../scripts/posthog/quota.mjs';

const payload = {
  quota_limits: [
    { resource: 'events', usage: 810_000, limit: 1_000_000 },
    { resource: 'recordings', usage: 100, limit: 5_000 },
    { resource: 'exceptions', usage: 100_000, limit: 100_000 },
  ],
};

describe('evaluateQuota', () => {
  it('AC-PHG-030: a resource at >=80% exits non-zero and names resource, usage and limit', () => {
    const r = evaluateQuota(payload, 0.8);
    expect(r.exitCode).toBe(1);
    expect(r.lines.join('\n')).toMatch(/events.*810000.*1000000/);
    expect(r.lines.join('\n')).toMatch(/exceptions.*100000.*100000/);
  });

  it('AC-PHG-030: a resource below the threshold is not reported as a breach', () => {
    expect(evaluateQuota(payload, 0.8).lines.join('\n')).not.toMatch(/recordings/);
  });

  it('AC-PHG-030: all clear exits zero', () => {
    const r = evaluateQuota({ quota_limits: [{ resource: 'events', usage: 1, limit: 1_000_000 }] }, 0.8);
    expect(r.exitCode).toBe(0);
  });

  it('AC-PHG-030: a resource with no limit (unlimited) is skipped, not divided by zero', () => {
    const r = evaluateQuota({ quota_limits: [{ resource: 'events', usage: 5, limit: null }] }, 0.8);
    expect(r.exitCode).toBe(0);
    expect(r.lines).toEqual([]);
  });

  // SECURITY finding (2026-07-27 review round 2, MEDIUM #1): `payload?.quota_limits ?? []`
  // treats ANY malformed 200 response (a renamed field, a schema change, an error-shaped 200)
  // as "zero rows" -> exitCode 0 -> check-quota.mjs prints "all clear". A fail-OPEN alarm is
  // worse than no alarm: it actively asserts safety it never checked.
  it('AC-PHG-030 SECURITY: a payload with no quota_limits array does NOT report all-clear', () => {
    const r = evaluateQuota({ oops: 'the endpoint schema changed' }, 0.8);
    expect(r.exitCode).not.toBe(0);
  });

  it('AC-PHG-030 SECURITY: quota_limits present but not an array does NOT report all-clear', () => {
    const r = evaluateQuota({ quota_limits: 'unexpected-string' }, 0.8);
    expect(r.exitCode).not.toBe(0);
  });

  it('AC-PHG-030 SECURITY: a null/undefined payload does NOT report all-clear', () => {
    expect(evaluateQuota(null, 0.8).exitCode).not.toBe(0);
    expect(evaluateQuota(undefined, 0.8).exitCode).not.toBe(0);
  });
});

describe('validateQuotaEnv (SECURITY, review round 2 #5)', () => {
  // check-quota.mjs interpolates POSTHOG_HOST/POSTHOG_PROJECT_ID, unvalidated, into the URL it
  // sends the personal API key's Authorization header to. A mis-set HOST (or a compromised env)
  // could send the key to an arbitrary/non-https origin; a PID containing `../` could re-point
  // the authenticated request. Fail closed on either.
  it('rejects a non-numeric project id (path-injection guard)', () => {
    expect(validateQuotaEnv('https://us.i.posthog.com', '../../evil').length).toBeGreaterThan(0);
  });

  it('rejects a project id containing anything but digits', () => {
    expect(validateQuotaEnv('https://us.i.posthog.com', '465502; rm -rf /').length).toBeGreaterThan(0);
  });

  it('rejects a non-https host — the API key must never travel over plain http or to a non-URL scheme', () => {
    expect(validateQuotaEnv('http://us.i.posthog.com', '465502').length).toBeGreaterThan(0);
  });

  it('a well-formed https host + numeric project id passes validation (no errors)', () => {
    expect(validateQuotaEnv('https://us.i.posthog.com', '465502')).toEqual([]);
  });
});
