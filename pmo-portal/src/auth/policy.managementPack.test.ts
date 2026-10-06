import { describe, it, expect } from 'vitest';
import { can } from './policy';
import type { Role } from './AuthContext';

const ROLES: Role[] = ['Admin', 'Executive', 'Project Manager', 'Finance', 'Engineer'];

describe('AC-MMP-012 management pack policy (mirrors migration 0245)', () => {
  it('AC-MMP-012: the pack is visible to the revenue read set and not to Engineers', () => {
    expect(ROLES.filter((r) => can('view', 'managementPack', { realRole: r })))
      .toEqual(['Admin', 'Executive', 'Project Manager', 'Finance']);
  });

  it('AC-MMP-012: progress is recorded by Finance rank and above anywhere, by a PM only on their own project', () => {
    const own = { currentUserId: 'u-pm', record: { project_manager_id: 'u-pm' } };
    const other = { currentUserId: 'u-pm', record: { project_manager_id: 'u-other' } };
    for (const r of ['Admin', 'Executive', 'Finance'] as Role[]) expect(can('edit', 'projectProgress', { realRole: r, ...other })).toBe(true);
    expect(can('edit', 'projectProgress', { realRole: 'Project Manager', ...own })).toBe(true);
    expect(can('edit', 'projectProgress', { realRole: 'Project Manager', ...other })).toBe(false);
    expect(can('edit', 'projectProgress', { realRole: 'Engineer', currentUserId: 'u-e', record: { project_manager_id: 'u-e' } })).toBe(false);
  });
});
