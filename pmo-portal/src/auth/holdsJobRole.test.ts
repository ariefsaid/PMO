import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Role } from './AuthContext';
import { BUILT_IN_ROLES, holdsJobRole } from './builtInRoles';

// The pgTAP file for holds_job_role (AC-RTD-001) holds the expected lists; this mirror must give the same answers.
const pgtap = readFileSync(resolve(__dirname, '../../../supabase/tests/roles_that_decide_function.test.sql'), 'utf8');
const expected = (level: string): string[] => {
  const re = new RegExp(`array\\[([^\\]]*)\\]\\),\\s*'AC-RTD-001 a no-job-role ${level} `);
  const list = re.exec(pgtap)?.[1] ?? '';
  return [...list.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort();
};
const fills = (role: Role, builtInRoleKey: string | null, active = true): string[] =>
  BUILT_IN_ROLES.filter((r) => holdsJobRole({ role, builtInRoleKey, active }, r.key)).map((r) => r.key).sort();

describe('AC-RTD-002 holdsJobRole mirrors holds_job_role (migration 1840)', () => {
  it.each([
    ['Executive', 'Executive'], ['Admin', 'Admin'], ['Project Manager', 'Project Manager'], ['Engineer', 'Engineer'], ['Finance', 'Finance person'],
  ] as const)('a person with no job role at %s fills the job roles built on it', (level, label) => {
    const want = expected(label);
    expect(want.length).toBeGreaterThan(0);
    expect(fills(level, null)).toEqual(want);
  });

  it('a holder fills its own job role only, not another one on the same access level', () => {
    expect(fills('Engineer', 'storekeeper')).toEqual(['storekeeper']);
    expect(holdsJobRole({ role: 'Engineer', builtInRoleKey: 'storekeeper' }, 'material_coordinator')).toBe(false);
  });

  it('an inactive person, a null key and an unknown key give false', () => {
    expect(fills('Engineer', 'storekeeper', false)).toEqual([]);
    expect(holdsJobRole({ role: 'Engineer', builtInRoleKey: null }, null)).toBe(false);
    expect(holdsJobRole({ role: 'Engineer', builtInRoleKey: null }, 'nope')).toBe(false);
  });
});
