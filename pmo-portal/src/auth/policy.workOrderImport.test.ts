import { describe, expect, it } from 'vitest';
import { can } from './policy';
import type { Role } from './AuthContext';

const context = (realRole: Role, currentUserId = 'u-1', projectManagerId?: string, viewOnly = false) => ({
  realRole,
  currentUserId,
  record: { project_manager_id: projectManagerId, viewOnly },
});

describe('work-order import policy (FR-WOI-005)', () => {
  it('AC-WOI-005 allows only Admin or the project’s assigned Project Manager', () => {
    expect(can('create', 'workOrderImport', context('Admin'))).toBe(true);
    expect(can('create', 'workOrderImport', context('Project Manager', 'pm-1', 'pm-1'))).toBe(true);
    expect(can('create', 'workOrderImport', context('Project Manager', 'pm-1', 'pm-2'))).toBe(false);
    expect(can('create', 'workOrderImport', context('Project Manager', 'pm-1'))).toBe(false);
    for (const role of ['Executive', 'Finance', 'Engineer'] as const) {
      expect(can('create', 'workOrderImport', context(role, 'u-1', 'u-1'))).toBe(false);
    }
  });

  it('AC-WOI-005 a view-as session cannot import', () => {
    expect(can('create', 'workOrderImport', context('Admin', 'u-1', undefined, true))).toBe(false);
    expect(can('create', 'workOrderImport', context('Project Manager', 'pm-1', 'pm-1', true))).toBe(false);
  });
});
