import { describe, it, expect } from 'vitest';
import { can } from '../policy';

/**
 * A-7 document.edit author predicate (AC-W2-RBAC-013, rbac-visibility §H):
 *   Edit a document = ◆ author — a master-data write-role (Admin·Exec·PM·Finance) who AUTHORED
 *   it, OR Admin (break-glass; edit is not an SoD axis, reading-rule 4). A non-author manager
 *   does NOT get Edit; an Engineer never has document write.
 *
 * Pushed into policy.ts so the gate is declarative + testable (mirrors the taskStatus
 * record-scoped predicate). RLS is the authority; this is FE clarity.
 */
describe('can(edit, document) — author-scoped (A-7, AC-W2-RBAC-013)', () => {
  const me = 'u-self';
  const other = 'u-other';

  it('AC-W2-RBAC-013: the AUTHOR (PM) may edit their own document', () => {
    expect(
      can('edit', 'document', {
        realRole: 'Project Manager',
        currentUserId: me,
        record: { author_id: me },
      }),
    ).toBe(true);
  });

  it('AC-W2-RBAC-013: a NON-author PM may NOT edit (author rule)', () => {
    expect(
      can('edit', 'document', {
        realRole: 'Project Manager',
        currentUserId: me,
        record: { author_id: other },
      }),
    ).toBe(false);
  });

  it('AC-W2-RBAC-013: Admin may edit a document they did NOT author (break-glass)', () => {
    expect(
      can('edit', 'document', {
        realRole: 'Admin',
        currentUserId: me,
        record: { author_id: other },
      }),
    ).toBe(true);
  });

  it('AC-W2-RBAC-013: an Engineer never has document edit', () => {
    expect(
      can('edit', 'document', {
        realRole: 'Engineer',
        currentUserId: me,
        record: { author_id: me },
      }),
    ).toBe(false);
  });

  it('AC-W2-RBAC-013: a master-data author (Finance) may edit their own document', () => {
    expect(
      can('edit', 'document', {
        realRole: 'Finance',
        currentUserId: me,
        record: { author_id: me },
      }),
    ).toBe(true);
  });

  it('AC-W2-RBAC-013: with no record context, a non-Admin master-data role is denied (deny-by-default authorship)', () => {
    // No author_id to compare → only Admin (break-glass) passes; others need proven authorship.
    expect(can('edit', 'document', { realRole: 'Project Manager', currentUserId: me })).toBe(false);
    expect(can('edit', 'document', { realRole: 'Admin', currentUserId: me })).toBe(true);
  });
});
