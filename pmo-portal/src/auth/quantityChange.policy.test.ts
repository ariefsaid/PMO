import { describe, expect, it } from 'vitest';
import { can } from './policy';

// #2578: can() only MIRRORS qcr_* (RLS and the functions decide). Roles per OD-QCR-2.
const rec = { author_id: 'author', editor_ids: ['author', 'editor'], submitted_by: 'submitter' };

describe('can() on quantityChange', () => {
  it('lets the author roles view, raise and record, and nobody else', () => {
    for (const realRole of ['Admin', 'Executive', 'Project Manager', 'Finance'] as const) {
      expect(can('view', 'quantityChange', { realRole })).toBe(true);
      expect(can('create', 'quantityChange', { realRole })).toBe(true);
      expect(can('decide', 'quantityChange', { realRole })).toBe(true);
    }
    expect(can('view', 'quantityChange', { realRole: 'Engineer' })).toBe(false);
    expect(can('create', 'quantityChange', { realRole: 'Engineer' })).toBe(false);
    expect(can('create', 'quantityChange', { realRole: null })).toBe(false);
  });

  it('AC-QCR-011/027 approve is for Admin, Executive and Finance, never the author, an editor or the submitter', () => {
    const ctx = (realRole: 'Admin' | 'Executive' | 'Finance' | 'Project Manager', currentUserId: string) => ({ realRole, currentUserId, record: rec });
    expect(can('approve', 'quantityChange', ctx('Finance', 'other'))).toBe(true);
    expect(can('approve', 'quantityChange', ctx('Admin', 'other'))).toBe(true);
    expect(can('approve', 'quantityChange', ctx('Finance', 'author'))).toBe(false);
    expect(can('approve', 'quantityChange', ctx('Finance', 'editor'))).toBe(false);
    expect(can('approve', 'quantityChange', ctx('Executive', 'submitter'))).toBe(false);
    expect(can('approve', 'quantityChange', ctx('Project Manager', 'other'))).toBe(false);
  });

  it('submit is for the author or an editor; withdraw adds the approver roles', () => {
    expect(can('act', 'quantityChange', { realRole: 'Project Manager', currentUserId: 'author', record: rec })).toBe(true);
    expect(can('act', 'quantityChange', { realRole: 'Finance', currentUserId: 'editor', record: rec })).toBe(true);
    expect(can('act', 'quantityChange', { realRole: 'Finance', currentUserId: 'other', record: rec })).toBe(false);
    expect(can('withdraw', 'quantityChange', { realRole: 'Finance', currentUserId: 'other', record: rec })).toBe(true);
    expect(can('withdraw', 'quantityChange', { realRole: 'Project Manager', currentUserId: 'other', record: rec })).toBe(false);
    expect(can('withdraw', 'quantityChange', { realRole: 'Project Manager', currentUserId: 'author', record: rec })).toBe(true);
  });

  it('a forecast is for Finance and above, or the project\'s own PM', () => {
    expect(can('request', 'quantityChange', { realRole: 'Finance' })).toBe(true);
    expect(can('request', 'quantityChange', { realRole: 'Project Manager', currentUserId: 'pm', record: { project_manager_id: 'pm' } })).toBe(true);
    expect(can('request', 'quantityChange', { realRole: 'Project Manager', currentUserId: 'pm', record: { project_manager_id: 'x' } })).toBe(false);
    expect(can('request', 'quantityChange', { realRole: 'Engineer' })).toBe(false);
  });

  it('the limit is Admin-only and impersonation is view-only', () => {
    expect(can('manage', 'quantityChange', { realRole: 'Admin' })).toBe(true);
    expect(can('manage', 'quantityChange', { realRole: 'Finance' })).toBe(false);
    expect(can('create', 'quantityChange', { realRole: 'Admin', record: { viewOnly: true } })).toBe(false);
    expect(can('approve', 'quantityChange', { realRole: 'Admin', currentUserId: 'other', record: { ...rec, viewOnly: true } })).toBe(false);
  });
});
