import { describe, it, expect } from 'vitest';
import { projectManagerLabel, UNASSIGNED_PROJECT_MANAGER } from './projectManagerLabel';

const base = { unassignedLabel: 'Unassigned', unnamedUserLabel: 'Unnamed user' };

describe('projectManagerLabel', () => {
  it('AC-PRJUX-004: returns the trimmed full name for a named manager', () => {
    expect(
      projectManagerLabel({ managerId: 'u-1', fullName: '  Alice Manager  ', ...base }),
    ).toBe('Alice Manager');
  });

  it('AC-PRJUX-005: a null manager ID resolves to the unassigned label, never a name', () => {
    expect(projectManagerLabel({ managerId: null, fullName: 'ghost', ...base })).toBe('Unassigned');
  });

  it('AC-PRJUX-005: an undefined manager ID also resolves to the unassigned label', () => {
    expect(projectManagerLabel({ managerId: undefined, fullName: null, ...base })).toBe('Unassigned');
  });

  it('AC-PRJUX-004: a whitespace full name on an ASSIGNED profile becomes Unnamed user + short ID (never Unassigned)', () => {
    expect(
      projectManagerLabel({ managerId: 'aaaaaaaa-bbbb-cccc', fullName: '   ', ...base }),
    ).toBe('Unnamed user · aaaaaaaa');
  });

  it('AC-PRJUX-004: a missing profile name on an assigned profile becomes Unnamed user + short ID', () => {
    expect(
      projectManagerLabel({ managerId: '12345678-0000-0000', fullName: null, ...base }),
    ).toBe('Unnamed user · 12345678');
  });

  it('AC-PRJUX-004: an assigned blank-name profile can never return an empty string', () => {
    for (const name of ['', '   ', '\t\n']) {
      const label = projectManagerLabel({ managerId: 'abc12345-zz', fullName: name, ...base });
      expect(label.length).toBeGreaterThan(0);
    }
  });

  it('AC-PRJUX-005: the unassigned sentinel is distinct from All and any profile ID', () => {
    expect(UNASSIGNED_PROJECT_MANAGER).not.toBe('All');
    expect(UNASSIGNED_PROJECT_MANAGER).not.toBe('u-1');
    expect(UNASSIGNED_PROJECT_MANAGER).not.toBe('');
    expect(UNASSIGNED_PROJECT_MANAGER.includes('u-')).toBe(false);
    expect(typeof UNASSIGNED_PROJECT_MANAGER).toBe('string');
  });
});