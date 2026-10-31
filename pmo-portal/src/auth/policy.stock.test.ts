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

describe('stock document policy', () => {
  const doc = (over: Record<string, unknown>) => ({ ...over });
  it.each(roles)('AC-STK-033 %s: receive, transfer, issue and return need a kept warehouse, Admin is exempt', (role) => {
    for (const kind of ['receive', 'transfer', 'issue', 'return']) {
      for (const isKeeper of [true, false]) {
        const ctx = { realRole: role, currentUserId: 'u1', record: doc({ kind, isKeeper }) };
        const want = isKeeper || role === 'Admin';
        expect(can('create', 'stockDocument', ctx)).toBe(want);
        expect(can('post', 'stockDocument', ctx)).toBe(want);
      }
    }
  });
  it.each(roles)('AC-STK-033 %s: a write-off is posted by master data rank and never by its author', (role) => {
    const writer = ['Admin', 'Executive', 'Finance', 'Project Manager'].includes(role);
    for (const kind of ['adjustment', 'count']) {
      expect(can('post', 'stockDocument', { realRole: role, currentUserId: 'u1', record: doc({ kind, created_by: 'u2' }) })).toBe(writer);
      expect(can('post', 'stockDocument', { realRole: role, currentUserId: 'u1', record: doc({ kind, created_by: 'u1' }) })).toBe(false);
    }
  });
  it.each(roles)('AC-STK-033 %s: adjustment and count x {author, other} x {real, view-as}', (role) => {
    const writer = ['Admin', 'Executive', 'Finance', 'Project Manager'].includes(role);
    for (const kind of ['adjustment', 'count']) {
      for (const viewOnly of [false, true]) {
        for (const createdBy of ['u1', 'u2']) {
          for (const isKeeper of [true, false]) {
            const ctx = { realRole: role, currentUserId: 'u1', record: doc({ kind, created_by: createdBy, isKeeper, status: 'Draft', viewOnly }) };
            expect(can('create', 'stockDocument', ctx)).toBe(!viewOnly && (isKeeper || role === 'Admin')); // PQ-1: authors keep the site
            expect(can('post', 'stockDocument', ctx)).toBe(!viewOnly && writer && createdBy !== 'u1'); // FR-STK-062: no keeper needed, never the author
          }
        }
      }
    }
  });
  it.each(roles)('AC-STK-033 %s: everyone can view; a view-as session can do nothing', (role) => {
    expect(can('view', 'stockDocument', { realRole: role })).toBe(true);
    const v = { realRole: role, currentUserId: 'u1', record: doc({ viewOnly: true, isKeeper: true, kind: 'issue', status: 'Draft', created_by: 'u1' }) };
    for (const a of ['create', 'post', 'withdraw'] as const) expect(can(a, 'stockDocument', v)).toBe(false);
  });
  it('AC-STK-033 only a Draft is cancelled, by its author or an Admin', () => {
    const rec = (status: string, by: string) => ({ status, created_by: by });
    expect(can('withdraw', 'stockDocument', { realRole: 'Engineer', currentUserId: 'u1', record: rec('Draft', 'u1') })).toBe(true);
    expect(can('withdraw', 'stockDocument', { realRole: 'Engineer', currentUserId: 'u1', record: rec('Draft', 'u2') })).toBe(false);
    expect(can('withdraw', 'stockDocument', { realRole: 'Admin', currentUserId: 'u1', record: rec('Draft', 'u2') })).toBe(true);
    expect(can('withdraw', 'stockDocument', { realRole: 'Admin', currentUserId: 'u1', record: rec('Posted', 'u1') })).toBe(false);
  });
});

describe('material allowance policy (S5)', () => {
  it.each(roles)('AC-STK-033 %s: everyone views; Finance rank and above set any allowance; a PM only on their own project', (role) => {
    expect(can('view', 'materialAllowance', { realRole: role })).toBe(true);
    const money = ['Admin', 'Executive', 'Finance'].includes(role);
    for (const own of [true, false]) {
      const ctx = { realRole: role, currentUserId: 'u1', record: { project_manager_id: own ? 'u1' : 'u2' } };
      const want = money || (role === 'Project Manager' && own);
      for (const a of ['create', 'edit', 'delete'] as const) expect(can(a, 'materialAllowance', ctx)).toBe(want);
    }
  });
  it('AC-STK-033 a view-as session sets no allowance', () => {
    expect(can('edit', 'materialAllowance', { realRole: 'Admin', currentUserId: 'u1', record: { viewOnly: true, project_manager_id: 'u1' } })).toBe(false);
  });
});
