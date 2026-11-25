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
it('AC-WOF-004 PA creates and edits own Draft work-order documents only (no project-level, no delete)', () => {
  const pa = { realRole: 'Engineer' as const, builtInRoleKey: 'project_administrator', currentUserId: 'u1' };
  expect(can('create', 'document', { ...pa, record: { work_order_id: 'wo-1' } })).toBe(true);
  expect(can('edit', 'document', { ...pa, record: { work_order_id: 'wo-1', author_id: 'u1' } })).toBe(true);
  expect(can('edit', 'document', { ...pa, record: { work_order_id: 'wo-1', author_id: 'other' } })).toBe(false);
  expect(can('create', 'document', pa)).toBe(false);
  expect(can('delete', 'document', { ...pa, record: { work_order_id: 'wo-1', author_id: 'u1' } })).toBe(false);
  expect(can('create', 'document', { realRole: 'Engineer', builtInRoleKey: 'engineer', currentUserId: 'u1', record: { work_order_id: 'wo-1' } })).toBe(false);
});
