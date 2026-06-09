import { describe, it, expect } from 'vitest';
import { modulesForRole } from '../routeMatch';
import { UserRole } from '../../../../types';

/**
 * AC-W3-N3 — ⌘K Navigate items are filtered by the viewer's real role.
 *
 * The Rail already hides Sales / Procurement / Companies / Administration from
 * Engineer; ⌘K was listing ALL MODULES unfiltered — a RBAC leak. `modulesForRole`
 * returns only the modules visible to the given role.
 *
 * AC-W3-N4 — /my-tasks is reachable via ⌘K Navigate.
 *
 * My Tasks is the Engineer's primary destination but was absent from MODULES,
 * making it unreachable via ⌘K. It is added with roles [Engineer, Admin].
 */
describe('modulesForRole (AC-W3-N3 + AC-W3-N4)', () => {
  // ── AC-W3-N3 ─────────────────────────────────────────────────────────────

  it('AC-W3-N3: Engineer does NOT see Sales Pipeline in Navigate', () => {
    const items = modulesForRole(UserRole.Engineer);
    expect(items.map((m) => m.module)).not.toContain('sales');
  });

  it('AC-W3-N3: Engineer does NOT see Procurement in Navigate', () => {
    const items = modulesForRole(UserRole.Engineer);
    expect(items.map((m) => m.module)).not.toContain('procurement');
  });

  it('AC-W3-N3: Engineer does NOT see Companies in Navigate', () => {
    const items = modulesForRole(UserRole.Engineer);
    expect(items.map((m) => m.module)).not.toContain('companies');
  });

  it('AC-W3-N3: Engineer does NOT see Administration in Navigate', () => {
    const items = modulesForRole(UserRole.Engineer);
    expect(items.map((m) => m.module)).not.toContain('administration');
  });

  it('AC-W3-N3: Admin sees ALL modules (Sales, Procurement, Companies, Administration, My Tasks)', () => {
    const modules = modulesForRole(UserRole.Admin).map((m) => m.module);
    expect(modules).toContain('sales');
    expect(modules).toContain('procurement');
    expect(modules).toContain('companies');
    expect(modules).toContain('administration');
    expect(modules).toContain('my-tasks');
  });

  it('AC-W3-N3: PM sees Sales, Procurement, Companies but NOT My Tasks', () => {
    const modules = modulesForRole(UserRole.ProjectManager).map((m) => m.module);
    expect(modules).toContain('sales');
    expect(modules).toContain('procurement');
    expect(modules).toContain('companies');
    expect(modules).not.toContain('my-tasks');
  });

  it('AC-W3-N3: Finance sees Sales, Procurement, Companies but NOT My Tasks', () => {
    const modules = modulesForRole(UserRole.Finance).map((m) => m.module);
    expect(modules).toContain('sales');
    expect(modules).toContain('procurement');
    expect(modules).toContain('companies');
    expect(modules).not.toContain('my-tasks');
  });

  // ── AC-W3-N4 ─────────────────────────────────────────────────────────────

  it('AC-W3-N4: Engineer DOES see My Tasks in Navigate', () => {
    const items = modulesForRole(UserRole.Engineer);
    expect(items.map((m) => m.module)).toContain('my-tasks');
  });

  it('AC-W3-N4: Finance does NOT see My Tasks in Navigate (no IC tasks surface)', () => {
    const items = modulesForRole(UserRole.Finance);
    expect(items.map((m) => m.module)).not.toContain('my-tasks');
  });

  it('AC-W3-N4: Engineer sees Dashboard, Projects, Timesheets, Incidents and My Tasks (expected set)', () => {
    const modules = modulesForRole(UserRole.Engineer).map((m) => m.module);
    expect(modules).toContain('dashboard');
    expect(modules).toContain('projects');
    expect(modules).toContain('timesheets');
    expect(modules).toContain('incidents');
    expect(modules).toContain('my-tasks');
  });
});
