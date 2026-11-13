import { formatCalendarDayInTimeZone } from './format';

export type ProjectNumberPatternValidation =
  | { valid: true }
  | { valid: false; reason: string };

const SYSTEM_DEFAULT = 'PRJ-{YY}-{SEQ4}';
const REQUIRED_TOKENS = ['CLIENT', 'YY', 'SEQ4'] as const;

/**
 * Illustrative values for the Admin preview (UX-075). The database assigns the real client
 * segment (from the project's company), year (org timezone) and sequence at creation time;
 * this preview shows only how the saved pattern expands, never a promised next number.
 */
export const PREVIEW_CLIENT_SEGMENT = 'NSN';
export const PREVIEW_SEQUENCE = '0312';

/** Expand a VALID pattern's supported tokens with illustrative values; callers hide it when invalid. */
export function previewProjectNumber(pattern: string, twoDigitYear: number): string {
  return pattern
    .replaceAll('{CLIENT}', PREVIEW_CLIENT_SEGMENT)
    .replaceAll('{YY}', String(twoDigitYear).padStart(2, '0'))
    .replaceAll('{SEQ4}', PREVIEW_SEQUENCE);
}

/** Resolve the business year using the same organisation calendar-day formatter as the server contract. */
export function projectNumberYear(at: Date, timezone: string): number | null {
  try {
    const calendarDay = formatCalendarDayInTimeZone(at, timezone);
    const match = calendarDay.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    return match ? Number(match[1].slice(2)) : null;
  } catch {
    return null;
  }
}

/**
 * What is wrong with a pattern, as a CODE plus the English sentence it was written with.
 *
 * The code is what a screen shows: the message goes through the catalogue (C4 — the panel is
 * otherwise translated, so the one sentence explaining the pattern used to be the only English
 * left on it). `reason` stays on the issue so the existing English sentence remains the default
 * text and a caller that only logs it still reads a sentence.
 */
export interface ProjectNumberPatternIssue {
  code:
    | 'empty'
    | 'closing-brace'
    | 'unclosed-token'
    | 'unknown-token'
    | 'duplicate-token'
    | 'missing-token';
  /** The offending token name, when the issue is about one (`unknown`, `duplicate`, `missing`). */
  token?: string;
  reason: string;
}

/** The first problem with a pattern, or null when it is valid. Tenant, timezone and sequence are the database's. */
export function projectNumberPatternIssue(pattern: string): ProjectNumberPatternIssue | null {
  if (!pattern.trim()) {
    return { code: 'empty', reason: 'Pattern cannot be empty. Enter a project-number pattern.' };
  }
  if (pattern === SYSTEM_DEFAULT) return null;

  const counts = new Map<string, number>();
  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index];
    if (character === '}') {
      return { code: 'closing-brace', reason: 'A closing brace has no matching opening brace.' };
    }
    if (character !== '{') continue;

    const closing = pattern.indexOf('}', index + 1);
    if (closing === -1) {
      return { code: 'unclosed-token', reason: 'A token is missing its closing brace.' };
    }
    const token = pattern.slice(index + 1, closing);
    if (!REQUIRED_TOKENS.includes(token as (typeof REQUIRED_TOKENS)[number])) {
      return {
        code: 'unknown-token',
        token,
        reason: `Unknown token {${token}}. Use {CLIENT}, {YY}, or {SEQ4}.`,
      };
    }
    const count = (counts.get(token) ?? 0) + 1;
    counts.set(token, count);
    if (count > 1) {
      return { code: 'duplicate-token', token, reason: `Use {${token}} exactly once.` };
    }
    index = closing;
  }

  const missing = REQUIRED_TOKENS.find((token) => counts.get(token) !== 1);
  if (missing) {
    return { code: 'missing-token', token: missing, reason: `Include {${missing}} exactly once.` };
  }
  return null;
}

/** Validate the display pattern only; tenant, timezone, and sequence are resolved by the database. */
export function validateProjectNumberPattern(pattern: string): ProjectNumberPatternValidation {
  const issue = projectNumberPatternIssue(pattern);
  return issue ? { valid: false, reason: issue.reason } : { valid: true };
}
