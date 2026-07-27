/**
 * FR-PHG-030/031, AC-PHG-030. Exceeding a PostHog free allowance is DESTRUCTIVE, not billed:
 * ingestion stops and the excess is "lost forever". A mid-month quota stop flattens every chart —
 * which is indistinguishable from nobody using the product. PostHog's own 80%/100% emails go only
 * to the org owner and are easy to miss.
 */
import { describe, it, expect } from 'vitest';
import { evaluateQuota } from '../../../../scripts/posthog/quota.mjs';

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
});
