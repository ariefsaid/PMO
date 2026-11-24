import { describe, expect, it } from 'vitest';
import { can } from './policy';

describe('AC-SCH-016 scheduledReport policy', () => {
  it('allows Admin unconditionally (unless view-only)', () => {
    expect(can('view', 'scheduledReport', { realRole: 'Admin' })).toBe(true);
    expect(can('manage', 'scheduledReport', { realRole: 'Admin' })).toBe(true);
    expect(can('manage', 'scheduledReport', { realRole: 'Admin', record: { pcm_scheduled_reports_enabled: false } })).toBe(true);
    expect(can('manage', 'scheduledReport', { realRole: 'Admin', record: { viewOnly: true } })).toBe(false);
  });

  it('allows Project Control Manager only when pcm_scheduled_reports_enabled is true and not view-only', () => {
    const pcmOn = {
      realRole: 'Project Manager' as const,
      builtInRoleKey: 'project_control_manager',
      record: { pcm_scheduled_reports_enabled: true },
    };
    expect(can('view', 'scheduledReport', pcmOn)).toBe(true);
    expect(can('manage', 'scheduledReport', pcmOn)).toBe(true);

    expect(can('manage', 'scheduledReport', { ...pcmOn, record: { pcm_scheduled_reports_enabled: false } })).toBe(false);
    expect(can('manage', 'scheduledReport', { ...pcmOn, record: {} })).toBe(false);
    expect(can('manage', 'scheduledReport', { ...pcmOn, record: { pcm_scheduled_reports_enabled: true, viewOnly: true } })).toBe(false);
  });

  it('denies plain Project Manager, other job roles, Finance, Executive, and Engineer', () => {
    for (const ctx of [
      { realRole: 'Project Manager' as const, builtInRoleKey: null, record: { pcm_scheduled_reports_enabled: true } },
      { realRole: 'Project Manager' as const, builtInRoleKey: 'construction_manager', record: { pcm_scheduled_reports_enabled: true } },
      { realRole: 'Project Manager' as const, builtInRoleKey: 'project_manager', record: { pcm_scheduled_reports_enabled: true } },
      { realRole: 'Executive' as const, builtInRoleKey: 'executive', record: { pcm_scheduled_reports_enabled: true } },
      { realRole: 'Finance' as const, builtInRoleKey: 'finance_manager', record: { pcm_scheduled_reports_enabled: true } },
      { realRole: 'Engineer' as const, builtInRoleKey: 'planner', record: { pcm_scheduled_reports_enabled: true } },
      { realRole: 'Engineer' as const, builtInRoleKey: 'field_user', record: { pcm_scheduled_reports_enabled: true } },
    ]) {
      expect(can('view', 'scheduledReport', ctx)).toBe(false);
      expect(can('manage', 'scheduledReport', ctx)).toBe(false);
    }
  });

  it('keeps orgEmailNotifications Admin-only', () => {
    expect(can('manage', 'orgEmailNotifications', {
      realRole: 'Project Manager',
      builtInRoleKey: 'project_control_manager',
      record: { pcm_scheduled_reports_enabled: true },
    })).toBe(false);
    expect(can('manage', 'orgEmailNotifications', { realRole: 'Admin' })).toBe(true);
  });

  it('restricts row-level edit on Admin-created schedules for Project Control Manager', () => {
    const pcmCtx = { realRole: 'Project Manager' as const, builtInRoleKey: 'project_control_manager' };
    expect(can('edit', 'scheduledReport', {
      ...pcmCtx,
      record: { pcm_scheduled_reports_enabled: true, creatorRole: 'Project Manager', creatorBuiltInRole: 'project_control_manager' },
    })).toBe(true);
    expect(can('edit', 'scheduledReport', {
      ...pcmCtx,
      record: { pcm_scheduled_reports_enabled: true, creatorRole: 'Admin', creatorBuiltInRole: null },
    })).toBe(false);
    expect(can('edit', 'scheduledReport', {
      ...pcmCtx,
      record: { pcm_scheduled_reports_enabled: true, creatorRole: 'Admin', creatorBuiltInRole: 'project_control_manager' },
    })).toBe(false);
    expect(can('edit', 'scheduledReport', {
      realRole: 'Admin',
      record: { creatorRole: 'Project Manager', creatorBuiltInRole: 'project_control_manager' },
    })).toBe(true);
  });
});
