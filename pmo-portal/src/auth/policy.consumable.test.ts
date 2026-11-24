import { describe, it, expect } from 'vitest';
import { can } from './policy';

const roles = ['Admin', 'Executive', 'Finance', 'Project Manager', 'Engineer'] as const;

describe('usage standards policy (#2577, FR-CUS-015)', () => {
  it.each(roles)('AC-CUS-011 %s: standards follow stock master data (rank >= 20), archive never delete', (role) => {
    const ctx = { realRole: role };
    const writer = role !== 'Engineer';
    expect(can('view', 'usageStandard', ctx)).toBe(true);
    expect(can('create', 'usageStandard', ctx)).toBe(writer);
    expect(can('edit', 'usageStandard', ctx)).toBe(writer);
    expect(can('archive', 'usageStandard', ctx)).toBe(writer);
    expect(can('delete', 'usageStandard', ctx)).toBe(false);
  });
  it('view-as is view-only and a missing role is denied', () => {
    expect(can('create', 'usageStandard', { realRole: 'Admin', record: { viewOnly: true } })).toBe(false);
    expect(can('view', 'usageStandard', { realRole: null })).toBe(false);
  });
});

describe('consumable plan policy (#2577, FR-CUS-015)', () => {
  // The work order's PROJECT row is the record: a work order has no project_manager_id.
  const project = { project_manager_id: 'pm-own' };
  it.each(['Admin', 'Executive', 'Finance'] as const)('AC-CUS-011 %s may generate and adjust on any project', (role) => {
    const ctx = { realRole: role, currentUserId: 'u-other', record: project };
    expect(can('generate', 'consumablePlan', ctx)).toBe(true);
    expect(can('adjust', 'consumablePlan', ctx)).toBe(true);
  });
  it('AC-CUS-011 a Project Manager only on their own project', () => {
    expect(can('generate', 'consumablePlan', { realRole: 'Project Manager', currentUserId: 'pm-own', record: project })).toBe(true);
    expect(can('adjust', 'consumablePlan', { realRole: 'Project Manager', currentUserId: 'pm-own', record: project })).toBe(true);
    expect(can('generate', 'consumablePlan', { realRole: 'Project Manager', currentUserId: 'pm-other', record: project })).toBe(false);
    expect(can('adjust', 'consumablePlan', { realRole: 'Project Manager', currentUserId: 'pm-other', record: project })).toBe(false);
  });
  it('AC-CUS-011 an Engineer and the PCM can generate and edit; view-as stays read-only', () => {
    const engineer = { realRole: 'Engineer' as const, builtInRoleKey: 'engineer', currentUserId: 'eng', record: project };
    const pcm = { realRole: 'Project Manager' as const, builtInRoleKey: 'project_control_manager', currentUserId: 'pcm', record: project };
    expect(can('generate', 'consumablePlan', engineer)).toBe(true);
    expect(can('adjust', 'consumablePlan', engineer)).toBe(true);
    expect(can('generate', 'consumablePlan', pcm)).toBe(true);
    expect(can('adjust', 'consumablePlan', pcm)).toBe(true);
    expect(can('generate', 'consumablePlan', { ...pcm, record: { ...project, viewOnly: true } })).toBe(false);
    for (const role of roles) expect(can('view', 'consumablePlan', { realRole: role })).toBe(true);
    expect(can('generate', 'consumablePlan', { realRole: 'Admin', currentUserId: 'u', record: { ...project, viewOnly: true } })).toBe(false);
  });
  it('AC-PEO-003 approval follows author type and never lets the author approve', () => {
    const plan = (authorId: string, authorIsPcm: boolean) => ({ ...project, author_id: authorId, author_is_pcm: authorIsPcm });
    expect(can('approve', 'consumablePlan', { realRole: 'Engineer', builtInRoleKey: 'project_control_manager', currentUserId: 'pcm', record: plan('engineer', false) })).toBe(true);
    expect(can('approve', 'consumablePlan', { realRole: 'Project Manager', builtInRoleKey: 'project_control_manager', currentUserId: 'pcm', record: plan('pcm', false) })).toBe(false);
    expect(can('approve', 'consumablePlan', { realRole: 'Admin', currentUserId: 'admin', record: plan('pcm', true) })).toBe(true);
    expect(can('approve', 'consumablePlan', { realRole: 'Project Manager', currentUserId: 'pm-own', record: plan('pcm', true) })).toBe(true);
    expect(can('approve', 'consumablePlan', { realRole: 'Project Manager', currentUserId: 'pm-other', record: plan('pcm', true) })).toBe(false);
  });
});
