import { describe, expect, it } from 'vitest';
import { buildAgentSystemPrompt } from '../../../../supabase/functions/agent-chat/prompt';

describe('remind skill gating (#1639)', () => {
  it('AC-RMD-019 the tool line and the remind skill appear only when reminders are registered', () => {
    const on = buildAgentSystemPrompt(['projects'], 50, 'Project Manager', { remindersEnabled: true });
    expect(on).toMatch(/- remind_overdue — /);
    expect(on).toMatch(/### remind — Use when the user asks to remind, chase, nudge or follow up/);
    expect(on.indexOf('call `remind_overdue` (this wins')).toBeGreaterThan(-1);
    expect(on.indexOf('call `remind_overdue` (this wins')).toBeLessThan(on.indexOf('- "overdue", "late"'));
    const off = buildAgentSystemPrompt(['projects'], 50, 'Project Manager', { remindersEnabled: false });
    expect(off).not.toMatch(/remind_overdue/);
  });
});
