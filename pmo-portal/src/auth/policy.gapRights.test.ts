import { expect, it } from 'vitest';
import { can } from './policy';
it('AC-GR-001 Equipment Officer registers and edits assets without deleting', () => {
  const ctx = { realRole: 'Engineer' as const, builtInRoleKey: 'equipment_officer' };
  expect(can('create', 'equipmentAsset', ctx)).toBe(true);
  expect(can('edit', 'equipmentAsset', ctx)).toBe(true);
  expect(can('delete', 'equipmentAsset', ctx)).toBe(false);
  expect(can('create', 'equipmentAsset', { ...ctx, builtInRoleKey: 'engineer' })).toBe(false);
  expect(can('create', 'equipmentAsset', { ...ctx, record: { viewOnly: true } })).toBe(false);
});
it('AC-GR-002 PCM reads catalogue without gaining catalogue writes', () => {
  const ctx = { realRole: 'Engineer' as const, builtInRoleKey: 'project_control_manager' };
  expect(can('view', 'rateCatalogue', ctx)).toBe(true);
  expect(can('create', 'rateCatalogue', ctx)).toBe(false);
});
