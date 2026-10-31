import { describe, it, expect } from 'vitest';
import { can } from './policy';

const roles = ['Admin', 'Executive', 'Finance', 'Project Manager', 'Engineer'] as const;

describe('stock master data policy', () => {
  it.each(roles)('AC-STK-033 %s: stock master data matrix', (role) => {
    const ctx = { realRole: role };
    const writer = ['Admin', 'Executive', 'Finance', 'Project Manager'].includes(role);
    for (const e of ['stockItem', 'stockUnit', 'warehouse'] as const) {
      expect(can('view', e, ctx)).toBe(true);
      expect(can('create', e, ctx)).toBe(writer);
      expect(can('edit', e, ctx)).toBe(writer);
      expect(can('archive', e, ctx)).toBe(writer);
      expect(can('delete', e, ctx)).toBe(role === 'Admin');
    }
    expect(can('manage', 'warehouse', ctx)).toBe(role === 'Admin'); // keepers
  });

  it('AC-STK-033 deny by default and view-as is view-only', () => {
    expect(can('create', 'stockItem', { realRole: null })).toBe(false);
    expect(can('view', 'stockItem', { realRole: null })).toBe(false);
    expect(can('create', 'stockItem', { realRole: 'Admin', record: { viewOnly: true } })).toBe(false);
    expect(can('manage', 'warehouse', { realRole: 'Admin', record: { viewOnly: true } })).toBe(false);
  });
});
