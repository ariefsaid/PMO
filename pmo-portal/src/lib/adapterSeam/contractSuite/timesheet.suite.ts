/**
 * timesheet.push (v1) — an approved timesheet reaches the ERP only when every link it points at resolves. The
 * ordering is the property: each refusal is classified and happens before any ERP call, because an ERP accepts a
 * nonexistent employee or project with a clean answer and would cost a week of hours to a phantom (AC-TSP-030).
 */
import { describe, expect, it } from 'vitest';
import type { ErpHarness, TimesheetPushScenario } from './harness.ts';

const DAY = '2026-01-05';
const entry = (project: TimesheetPushScenario['entries'][number]['project'], hours = '7.25') => ({ project, date: DAY, hours });
const base: TimesheetPushScenario = { employeeLink: 'confirmed', entries: [entry('a')], activityType: 'configured' };

export function timesheetPushSuite(h: ErpHarness): void {
  describe(`timesheet.push (${h.tier})`, () => {
    it('AC-TSP-030 resolves the confirmed employee and every entry project, with no ERP call while resolving', async () => {
      expect(await h.pushTimesheet(base)).toEqual({ outcome: 'accepted', erpCalls: 0 });
    });

    it('AC-TSP-030 rejects `employee-unlinked` with NO ERP call when no adopted employee exists', async () => {
      expect(await h.pushTimesheet({ ...base, employeeLink: 'none' })).toMatchObject({ outcome: 'refused', code: 'employee-unlinked', erpCalls: 0 });
    });

    it('AC-TSP-030 rejects a proposed (not yet Admin-confirmed) link: only a confirmed one authorizes a push', async () => {
      expect(await h.pushTimesheet({ ...base, employeeLink: 'proposed' })).toMatchObject({ outcome: 'refused', code: 'employee-unlinked', erpCalls: 0 });
    });

    it('AC-TSP-030 rejects an employee link belonging to ANOTHER tenant', async () => {
      expect(await h.pushTimesheet({ ...base, employeeLink: 'other-tenant' })).toMatchObject({ outcome: 'refused', code: 'employee-unlinked' });
    });

    it('AC-TSP-030 rejects a confirmed link with no ERP identity recorded', async () => {
      expect(await h.pushTimesheet({ ...base, employeeLink: 'confirmed-without-erp-id' })).toMatchObject({ outcome: 'refused', code: 'employee-unlinked', erpCalls: 0 });
    });

    it('AC-TSP-030 rejects `project-unmapped` rather than sending a row with no project dimension', async () => {
      expect(await h.pushTimesheet({ ...base, entries: [entry('unmapped', '4')] })).toMatchObject({ outcome: 'refused', code: 'project-unmapped', erpCalls: 0 });
    });

    it('AC-TSP-030 rejects `cross-org-link-rejected` for an entry whose project belongs to another tenant', async () => {
      expect(await h.pushTimesheet({ ...base, entries: [entry('other-tenant', '4')] })).toMatchObject({ outcome: 'refused', code: 'cross-org-link-rejected', erpCalls: 0 });
    });

    it('AC-TSP-030 rejects `activity-type-unconfigured` when no default activity type is set', async () => {
      expect(await h.pushTimesheet({ ...base, activityType: 'missing' })).toMatchObject({ outcome: 'refused', code: 'activity-type-unconfigured', erpCalls: 0 });
    });

    it('AC-TSP-030 rejects more than 24 hours on one day before any ERP call', async () => {
      const r = await h.pushTimesheet({ ...base, entries: [entry('a', '13'), entry('b', '13')] });
      expect(r).toMatchObject({ outcome: 'refused', code: 'commit-rejected', erpCalls: 0 });
      expect(r.message).toMatch(/daily-hours-exceed-24/);
    });
  });
}
