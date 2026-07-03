/**
 * Tests for the agent-chat persistence helpers (ADR-0043 §2/§3/§4).
 * AC-AGP-013..017 own the handler journal/de-dupe/heartbeat/cancel assertions here.
 * [REC-1]: handler unit tests live under pmo-portal/src/lib/agent/*.test.ts (no Vitest
 * project rooted in supabase/), importing the handler + persistence via relative path.
 */
import { it, expect } from 'vitest';
import { hashToolArgs } from '../../../../supabase/functions/agent-chat/persistence';

// ── Task B1 — hashToolArgs (RED→GREEN with persistence.ts scaffold) ──────────

it('hashToolArgs canonicalizes key order — same value regardless of key insertion order', () => {
  expect(hashToolArgs({ b: 2, a: 1 })).toBe(hashToolArgs({ a: 1, b: 2 }));
});

it('hashToolArgs differs for genuinely different arg values', () => {
  expect(hashToolArgs({ a: 1 })).not.toBe(hashToolArgs({ a: 2 }));
});

it('hashToolArgs returns a 64-char lowercase hex sha-256 digest', () => {
  expect(hashToolArgs({ a: 1 })).toMatch(/^[0-9a-f]{64}$/);
});
