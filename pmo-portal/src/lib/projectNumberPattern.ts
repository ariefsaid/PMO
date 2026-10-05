export type ProjectNumberPatternValidation =
  | { valid: true }
  | { valid: false; reason: string };

const SYSTEM_DEFAULT = 'PRJ-{YY}-{SEQ4}';
const REQUIRED_TOKENS = ['CLIENT', 'YY', 'SEQ4'] as const;

/** Validate the display pattern only; tenant, timezone, and sequence are resolved by the database. */
export function validateProjectNumberPattern(pattern: string): ProjectNumberPatternValidation {
  if (!pattern.trim()) return { valid: false, reason: 'Pattern cannot be empty. Enter a project-number pattern.' };
  if (pattern === SYSTEM_DEFAULT) return { valid: true };

  const counts = new Map<string, number>();
  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index];
    if (character === '}') {
      return { valid: false, reason: 'A closing brace has no matching opening brace.' };
    }
    if (character !== '{') continue;

    const closing = pattern.indexOf('}', index + 1);
    if (closing === -1) return { valid: false, reason: 'A token is missing its closing brace.' };
    const token = pattern.slice(index + 1, closing);
    if (!REQUIRED_TOKENS.includes(token as (typeof REQUIRED_TOKENS)[number])) {
      return { valid: false, reason: `Unknown token {${token}}. Use {CLIENT}, {YY}, or {SEQ4}.` };
    }
    const count = (counts.get(token) ?? 0) + 1;
    counts.set(token, count);
    if (count > 1) return { valid: false, reason: `Use {${token}} exactly once.` };
    index = closing;
  }

  const missing = REQUIRED_TOKENS.find((token) => counts.get(token) !== 1);
  if (missing) return { valid: false, reason: `Include {${missing}} exactly once.` };
  return { valid: true };
}
