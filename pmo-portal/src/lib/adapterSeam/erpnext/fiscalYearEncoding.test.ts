/**
 * fiscalYearEncoding.test.ts — BFY T1: the canonical fiscal-year encoding + identity parser
 * (FR-BFY-031/032/038). The served round-trip is owned by AC-BFY-009/030 (Deno); this unit test owns
 * the encoding's invariants.
 *
 * The encoding maps ANY ERPNext `Fiscal Year` NAME (incl. names bearing `:`, spaces, `/`, or letters)
 * to a token composed ONLY of characters in the served key guard's third-segment charset `[0-9TZ:.+-]`
 * (`adapter-dispatch/transitionTargetGuard.ts:190`, DETERMINISTIC_KEY_RE — UNMODIFIED). The per-year
 * idempotency key `bud:<vid>:<encoded-fy>:<epoch>` and the year-qualified outbox identity
 * `<vid>:<encoded-fy>` both depend on it.
 *
 * ⚑ DEVIATION FROM THE PLAN (T1): the plan suggested "URL-safe base32". base32's alphabet is A-Z2-7;
 * its letters (A,B,…,Y except T/Z) are NOT in the unmodifiable guard charset `[0-9TZ:.+-]`, so a
 * base32-encoded FY in the key's third segment would FAIL DETERMINISTIC_KEY_RE and the key could never
 * be dispatched. This module uses a fixed-width base-16 over a 16-symbol charset-safe alphabet instead
 * — same binding property (round-trippable for any UTF-8 name, no `:`/space/letter collision in the
 * token), and it actually passes the guard. See fiscalYearEncoding.ts header.
 */
import { describe, it, expect } from 'vitest';
import { encodeFiscalYear, decodeFiscalYear, budgetVersionIdOf } from './fiscalYearEncoding';

const VERSION = '3f1b0c9e-1a2b-4c3d-8e4f-5a6b7c8d9e0f';

describe('fiscalYearEncoding (T1 — canonical FY encoding + identity parser)', () => {
  it('round-trips a bare calendar-year name ("2026")', () => {
    const enc = encodeFiscalYear('2026');
    expect(decodeFiscalYear(enc)).toBe('2026');
  });

  it('round-trips a hyphenated Jul–Jun name ("2025-2026")', () => {
    const enc = encodeFiscalYear('2025-2026');
    expect(decodeFiscalYear(enc)).toBe('2025-2026');
  });

  it('round-trips a COLON-bearing name ("A:B 2026")', () => {
    const enc = encodeFiscalYear('A:B 2026');
    expect(decodeFiscalYear(enc)).toBe('A:B 2026');
  });

  it('round-trips a SPACE- and letter-bearing name ("FY 2026")', () => {
    const enc = encodeFiscalYear('FY 2026');
    expect(decodeFiscalYear(enc)).toBe('FY 2026');
  });

  it('round-trips a slash-bearing name ("2025/2026") — a name whose token itself contains ":"', () => {
    const enc = encodeFiscalYear('2025/2026');
    expect(decodeFiscalYear(enc)).toBe('2025/2026');
  });

  it('encode is deterministic (the same name → the same token — two originators land on one identity)', () => {
    expect(encodeFiscalYear('2026')).toBe(encodeFiscalYear('2026'));
  });

  it('different names encode to different tokens (no collision)', () => {
    expect(encodeFiscalYear('2026')).not.toBe(encodeFiscalYear('2025-2026'));
  });

  it('encode is injective across names of the same length (no prefix collision)', () => {
    expect(encodeFiscalYear('2026')).not.toBe(encodeFiscalYear('2027'));
  });

  it('⚑ the encoded token stays within the served key guard charset [0-9TZ:.+-] — base32 would not', () => {
    // DETERMINISTIC_KEY_RE's third segment is [0-9TZ:.+-] (transitionTargetGuard.ts:190, UNMODIFIED).
    // Every encoded token must be composed solely of those characters or the per-year key
    // `bud:<uuid>:<token>:<epoch>` cannot be dispatched. base32 (A-Z2-7) fails this — hence the
    // custom alphabet (see the module header).
    const charsetOk = /^[0-9TZ:.+-]+$/i;
    for (const name of ['2026', '2025-2026', 'A:B 2026', 'FY 2026', '2025/2026']) {
      expect(charsetOk.test(encodeFiscalYear(name))).toBe(true);
    }
  });

  it('rejects an empty name — never an empty token (the identity/key must name a year)', () => {
    expect(() => encodeFiscalYear('')).toThrow(/fiscal year|empty/i);
  });

  it('budgetVersionIdOf("<vid>:<enc>") recovers the bare <vid>', () => {
    const enc = encodeFiscalYear('2026');
    const identity = `${VERSION}:${enc}`;
    expect(budgetVersionIdOf(identity)).toBe(VERSION);
  });

  it('budgetVersionIdOf recovers the vid even when the encoded year itself contains a ":" (a "/" name)', () => {
    // '/' (0x2F) encodes to a token containing ':'; the identity still splits unambiguously because a
    // canonical UUID never contains ':'.
    const enc = encodeFiscalYear('2025/2026');
    expect(enc).toContain(':');
    expect(budgetVersionIdOf(`${VERSION}:${enc}`)).toBe(VERSION);
  });

  it('budgetVersionIdOf throws on an unparseable identity (no delimiter)', () => {
    expect(() => budgetVersionIdOf('not-an-identity')).toThrow(/identity|uuid|parse/i);
  });

  it('budgetVersionIdOf throws when the leading segment is not a budget_version_id UUID', () => {
    expect(() => budgetVersionIdOf('garbage:something')).toThrow(/identity|uuid|parse/i);
  });
});
