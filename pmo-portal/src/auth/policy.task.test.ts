import { describe, expect, it } from 'vitest';
import { can } from './policy';

// Owner ruling 2026-10-23 (migration 0355): Finance is scoped on tasks exactly like an Engineer.
// UX gate only (ADR-0016) — RLS is the authority; this must never be looser than 0355's policies.
describe('can() — Finance task scope (AC-TASK-FIN-001)', () => {
  const me = 'fin-1';
  const other = 'user-2';

  it('AC-TASK-FIN-001 Finance may create a task', () => {
    expect(can('create', 'task', { realRole: 'Finance' })).toBe(true);
  });

  it('AC-TASK-FIN-001 Finance may edit a task it CREATED, and no other', () => {
    expect(can('edit', 'task', { realRole: 'Finance', currentUserId: me,
      record: { created_by: me, assignee_id: other } })).toBe(true);
    // Assignee only: no full edit (status control only), same as Engineer.
    expect(can('edit', 'task', { realRole: 'Finance', currentUserId: me,
      record: { created_by: other, assignee_id: me } })).toBe(false);
    expect(can('edit', 'task', { realRole: 'Finance', currentUserId: me,
      record: { created_by: other, assignee_id: other } })).toBe(false);
    // Role-level (no record) answer is no: Finance is not a manager.
    expect(can('edit', 'task', { realRole: 'Finance', currentUserId: me })).toBe(false);
  });

  it('AC-TASK-FIN-001 Finance may NOT delete or archive a task', () => {
    expect(can('delete', 'task', { realRole: 'Finance' })).toBe(false);
    expect(can('archive', 'task', { realRole: 'Finance' })).toBe(false);
  });

  it('AC-TASK-FIN-001 Finance may set the status of a task assigned to it, and no other', () => {
    expect(can('edit', 'taskStatus', { realRole: 'Finance', currentUserId: me,
      record: { assignee_id: me } })).toBe(true);
    expect(can('edit', 'taskStatus', { realRole: 'Finance', currentUserId: me,
      record: { assignee_id: other } })).toBe(false);
    expect(can('edit', 'taskStatus', { realRole: 'Finance', currentUserId: me })).toBe(false);
    expect(can('edit', 'taskStatus', { realRole: 'Finance', currentUserId: null,
      record: { assignee_id: null } })).toBe(false);
  });

  it('AC-TASK-FIN-001 Finance and Engineer get identical answers on every task gate', () => {
    const ctxs = [
      { currentUserId: me, record: { created_by: me, assignee_id: other } },
      { currentUserId: me, record: { created_by: other, assignee_id: me } },
      { currentUserId: me, record: { created_by: other, assignee_id: other } },
      { currentUserId: null, record: { created_by: me, assignee_id: me } },
      {},
    ];
    const gates = [
      ['create', 'task'], ['edit', 'task'], ['archive', 'task'], ['delete', 'task'], ['edit', 'taskStatus'],
    ] as const;
    for (const [action, entity] of gates) {
      for (const ctx of ctxs) {
        expect(can(action, entity, { realRole: 'Finance', ...ctx }))
          .toBe(can(action, entity, { realRole: 'Engineer', ...ctx }));
      }
    }
  });
});
