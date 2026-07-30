/**
 * FR-PHG-030/031, AC-PHG-030. Exceeding a PostHog free allowance is DESTRUCTIVE, not billed:
 * ingestion stops and the excess is "lost forever". A mid-month quota stop flattens every chart —
 * which is indistinguishable from nobody using the product. PostHog's own 80%/100% emails go only
 * to the org owner and are easy to miss.
 */
import { describe, it, expect } from 'vitest';
import { evaluateQuota, validateQuotaEnv, validateThreshold } from '../../../../scripts/posthog/quota.mjs';

/**
 * ⚑ THIS FIXTURE IS A REAL RESPONSE, captured live from
 * `GET https://us.i.posthog.com/api/projects/465502/quota_limits/` on 2026-07-28.
 *
 * The previous fixture invented a `{ quota_limits: [{ resource, usage, limit }] }` array. The API
 * returns no such field — it returns `limited`, an OBJECT KEYED BY RESOURCE NAME. Every one of the
 * 8 tests here (including the 3 security ones) passed against that invented shape, because the
 * fixture and the parser were written from the same misunderstanding. A test can only catch a
 * misreading of an external contract if its fixture comes from the contract, not from the code.
 *
 * Only the parser's fail-closed guard — added by a security review for an unrelated reason — kept
 * this from reporting "✓ all quotas below threshold" forever against a response it never parsed.
 */
const payload = {
  limited: {
    events: { limited: false, usage: 238, limit: 1_000_000 },
    exceptions: { limited: false, usage: 13, limit: 100_000 },
    recordings: { limited: false, usage: 25, limit: 5_000 },
    survey_responses: { limited: false, usage: 0, limit: 1_500 },
    ai_credits: { limited: false, usage: 32, limit: 500 },
    // Real resources come back with null usage AND null limit — must not divide, must not alarm.
    api_queries_read_bytes: { limited: false, usage: null, limit: null },
    workflow_push: { limited: false, usage: null, limit: null },
  },
  code_usage_billing_active: false,
};

describe('evaluateQuota', () => {
  it('AC-PHG-030: the REAL live payload shape parses, and a healthy project exits zero', () => {
    const r = evaluateQuota(payload, 0.8);
    expect(r.exitCode).toBe(0);
    expect(r.lines).toEqual([]);
  });

  it('AC-PHG-030: a resource at >=80% exits non-zero and names resource, usage and limit', () => {
    const hot = { ...payload, limited: { ...payload.limited, events: { limited: false, usage: 810_000, limit: 1_000_000 } } };
    const r = evaluateQuota(hot, 0.8);
    expect(r.exitCode).toBe(1);
    expect(r.lines.join('\n')).toMatch(/events.*810000.*1000000/);
  });

  it('AC-PHG-030: a resource below the threshold is not reported as a breach', () => {
    const hot = { ...payload, limited: { ...payload.limited, events: { limited: false, usage: 810_000, limit: 1_000_000 } } };
    expect(evaluateQuota(hot, 0.8).lines.join('\n')).not.toMatch(/recordings/);
  });

  // `limited: true` means PostHog has ALREADY stopped ingesting and the excess is being discarded
  // permanently. That is the emergency this alarm exists for, and it must fire regardless of ratio.
  it('AC-PHG-030: a resource already flagged limited:true is a breach even below the threshold', () => {
    const stopped = { ...payload, limited: { ...payload.limited, events: { limited: true, usage: 1, limit: 1_000_000 } } };
    const r = evaluateQuota(stopped, 0.8);
    expect(r.exitCode).toBe(1);
    expect(r.lines.join('\n')).toMatch(/events/);
  });

  // Mixed payload: one evaluable resource + one all-null. The all-null one must be skipped, but the
  // run must still count as "something was checked". (The previous version asserted a SINGLE all-null
  // resource exits 0 — which codified the fail-open hole below rather than testing the skip.)
  it('AC-PHG-030: null usage/limit is skipped, never divided and never alarmed', () => {
    const r = evaluateQuota(
      {
        limited: {
          events: { limited: false, usage: 1, limit: 1_000_000 },
          api_queries_read_bytes: { limited: false, usage: null, limit: null },
        },
      },
      0.8,
    );
    expect(r.exitCode).toBe(0);
    expect(r.lines).toEqual([]);
    expect(r.evaluated).toBe(1); // the null resource must NOT count as an allowance checked
  });

  // ── The fail-open hole both reviewers found independently (2026-07-28) ──────────────────────
  // The container guard checked that `limited` is a non-empty object, but every ROW could be
  // silently skipped and still reach exitCode 0. All four of these printed
  // "✓ all quotas below threshold" against the previous parser.
  describe('SECURITY: a check that did not happen must never report all-clear', () => {
    it('a resource->boolean map does NOT report all-clear (recordings is genuinely limited)', () => {
      // The most plausible drift, given the field is literally named `limited`.
      const r = evaluateQuota({ limited: { events: false, recordings: true } }, 0.8);
      expect(r.exitCode).not.toBe(0);
    });

    it('rows that are not objects fail closed, naming the resource', () => {
      const r = evaluateQuota({ limited: { events: 'over', recordings: 42 } }, 0.8);
      expect(r.exitCode).toBe(2);
      expect(r.lines.join('\n')).toMatch(/events/);
    });

    it('rows missing usage/limit keys entirely do NOT report all-clear', () => {
      expect(evaluateQuota({ limited: { events: { limited: false } } }, 0.8).exitCode).not.toBe(0);
    });

    it('every resource all-null does NOT report all-clear — nothing was evaluated', () => {
      const r = evaluateQuota(
        { limited: { a: { limited: false, usage: null, limit: null }, b: { limited: false, usage: null, limit: null } } },
        0.8,
      );
      expect(r.exitCode).toBe(2);
      expect(r.lines.join('\n')).toMatch(/nothing was actually checked/i);
    });

    it('a truthy non-boolean `limited` still alarms (serialiser drift must not slip past)', () => {
      expect(evaluateQuota({ limited: { events: { limited: 'true', usage: 1, limit: 1_000_000 } } }, 0.8).exitCode).toBe(1);
      expect(evaluateQuota({ limited: { events: { limited: 1, usage: 1, limit: 1_000_000 } } }, 0.8).exitCode).toBe(1);
    });
  });

  // MEDIUM-1: resource names are third-party object KEYS interpolated into CI stderr, and GitHub
  // Actions parses workflow commands from every output line. A newline-bearing key emitted live
  // ::add-mask:: / ::error:: / ::stop-commands:: in a probe.
  it('SECURITY: a hostile resource name cannot inject CI workflow commands', () => {
    const hostile = 'events\n::add-mask::dev\n::error title=pwned::injected\n::stop-commands::x1';
    const r = evaluateQuota({ limited: { [hostile]: { limited: true, usage: 1, limit: 10 } } }, 0.8);
    expect(r.exitCode).toBe(1);
    const out = r.lines.join('\n');
    // The words survive (letters/hyphens are legal) and that is FINE — plain text in a log line is
    // harmless. What must not survive is the SYNTAX: a newline followed by '::'.
    expect(out).not.toMatch(/\n/);   // single line — nothing can start a new command line
    expect(out).not.toMatch(/::/);    // no workflow-command delimiter survives at all
  });

  // SECURITY (2026-07-27 review round 2, MEDIUM #1): a malformed 200 must NOT read as "all clear".
  // A fail-OPEN alarm is worse than no alarm: it actively asserts safety it never checked.
  it('AC-PHG-030 SECURITY: a payload with no limited object does NOT report all-clear', () => {
    expect(evaluateQuota({ oops: 'the endpoint schema changed' }, 0.8).exitCode).not.toBe(0);
  });

  it('AC-PHG-030 SECURITY: limited present but not an object does NOT report all-clear', () => {
    expect(evaluateQuota({ limited: 'unexpected-string' }, 0.8).exitCode).not.toBe(0);
    expect(evaluateQuota({ limited: [] }, 0.8).exitCode).not.toBe(0);
  });

  // The "scanned nothing" class: an empty resource map means we checked zero allowances. Reporting
  // green off that is the same defect as a gate that passes having scanned no files.
  it('AC-PHG-030 SECURITY: an EMPTY limited object does NOT report all-clear', () => {
    expect(evaluateQuota({ limited: {} }, 0.8).exitCode).not.toBe(0);
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

describe('validateThreshold (SECURITY, 2026-07-28 review MEDIUM-4)', () => {
  // Number('abc') is NaN, and `ratio >= NaN` is ALWAYS false — a typo silently disabled the alarm.
  // The direct JS analogue of the `NaN >= 0` Postgres trap from #401.
  it('rejects a non-numeric threshold — the NaN path silently disabled the alarm', () => {
    expect(validateThreshold('abc').length).toBeGreaterThan(0);
  });
  it("rejects an empty string (Number('') is 0, which alarms on everything)", () => {
    expect(validateThreshold('').length).toBeGreaterThan(0);
  });
  it('rejects out-of-range thresholds', () => {
    expect(validateThreshold('5').length).toBeGreaterThan(0);
    expect(validateThreshold('0').length).toBeGreaterThan(0);
    expect(validateThreshold('-0.5').length).toBeGreaterThan(0);
  });
  it('accepts a real fraction', () => {
    expect(validateThreshold('0.8')).toEqual([]);
    expect(validateThreshold('1')).toEqual([]);
  });
});

describe('validateQuotaEnv host allowlist (SECURITY, 2026-07-28 review MEDIUM-2)', () => {
  // The scheme-only check claimed to stop "sending the key to an arbitrary origin". It did not.
  it.each([
    ['https://evil.com', 'a plain wrong origin'],
    ['https://us.i.posthog.com@evil.com', 'the userinfo trick'],
    ['https://us.i.p\u043esthog.com', 'a Cyrillic-o IDN homograph'],
    ['https://us.i.posthog.com#', 'a fragment that truncates the path'],
    ['https://us.i.posthog.com/api/projects/9/quota_limits/?x=', 'a host carrying its own path (PID bypass)'],
    ['http://us.i.posthog.com', 'plain http'],
  ])('rejects %s (%s)', (host) => {
    expect(validateQuotaEnv(host, '465502').length).toBeGreaterThan(0);
  });

  it('accepts the real PostHog origins', () => {
    expect(validateQuotaEnv('https://us.i.posthog.com', '465502')).toEqual([]);
    expect(validateQuotaEnv('https://eu.i.posthog.com', '465502')).toEqual([]);
  });
});
