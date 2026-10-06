import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// The shipped edge fn is Deno (its handler needs vault + Deno.serve), so this binds to its source: the onboarding run must
// call the negative-rates setup step and report its outcome, or a claim with a down-payment recovery fails at ERPNext submit.
const source = readFileSync(new URL('../../../../../supabase/functions/erpnext-onboard/index.ts', import.meta.url), 'utf8');

describe('erpnext-onboard wiring (#858 item 3)', () => {
  it('AC-858-3 imports the shipped ensureErpSellingSettings step', () => {
    expect(source).toMatch(/import\s*\{[^}]*\bensureErpSellingSettings\b[^}]*\}\s*from\s*'[^']*erpSellingSettings\.ts'/);
  });

  it('AC-858-3 calls the negative-rates setup step and returns its outcome', () => {
    expect(source).toMatch(/await\s+ensureErpSellingSettings\(\s*clientDeps\s*\)/);
    expect(source).toMatch(/return json\(\{[^}]*\bsellingSettings\b[^}]*\}\)/);
  });
});
