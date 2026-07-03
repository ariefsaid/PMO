/**
 * dispatcher.schedule.test.ts — cron matching (AC-AAN-021 support) + due-schedule selection
 * (AC-AAN-021). [REC-1]: logic lives in supabase/functions/agent-dispatch/*, tests live here per
 * the repo's existing handler-unit-test convention (no Vitest project rooted in supabase/).
 */
import { describe, it, expect, vi } from 'vitest';
import { cronMatches } from '../../../../../supabase/functions/agent-dispatch/cron';
import { selectDueSchedules } from '../../../../../supabase/functions/agent-dispatch/dispatcher';

describe('cronMatches', () => {
  it('matches every minute for "* * * * *"', () => {
    expect(cronMatches('* * * * *', new Date('2026-07-06T08:00:00Z'))).toBe(true);
  });

  it('matches a specific minute/hour/day-of-week', () => {
    // 2026-07-06 is a Monday.
    expect(cronMatches('0 8 * * 1', new Date('2026-07-06T08:00:00Z'))).toBe(true);
  });

  it('does not match the wrong minute/hour', () => {
    expect(cronMatches('0 8 * * 1', new Date('2026-07-06T09:00:00Z'))).toBe(false);
  });

  it('does not match the wrong day-of-week', () => {
    expect(cronMatches('0 8 * * 2', new Date('2026-07-06T08:00:00Z'))).toBe(false);
  });
});

describe('selectDueSchedules', () => {
  it('AC-AAN-021 cron selection fires due schedules only', async () => {
    const rows = [
      { id: 'a1', kind: 'schedule', schedule: '* * * * *', owner_id: 'u1', prompt: 'p1', enabled: true, archived_at: null },
      { id: 'a2', kind: 'schedule', schedule: '0 9 * * *', owner_id: 'u1', prompt: 'p2', enabled: true, archived_at: null },
      { id: 'a3', kind: 'schedule', schedule: '0 10 * * *', owner_id: 'u1', prompt: 'p3', enabled: true, archived_at: null },
    ];

    const isMock = vi.fn().mockResolvedValue({ data: rows, error: null });
    const eqEnabledMock = vi.fn().mockReturnValue({ is: isMock });
    const eqKindMock = vi.fn().mockReturnValue({ eq: eqEnabledMock });
    // .eq('kind','schedule').eq('enabled',true).is('archived_at',null)
    const selectMock = vi.fn().mockReturnValue({ eq: eqKindMock });
    const fromMock = vi.fn().mockReturnValue({ select: selectMock });
    const serviceClient = { from: fromMock };

    const now = new Date('2026-07-06T08:00:00Z');
    const due = await selectDueSchedules(serviceClient as never, now);

    expect(due).toHaveLength(1);
    expect(due[0].id).toBe('a1');
    expect(fromMock).toHaveBeenCalledWith('agent_automations');
    expect(eqKindMock).toHaveBeenCalledWith('kind', 'schedule');
    expect(eqEnabledMock).toHaveBeenCalledWith('enabled', true);
    expect(isMock).toHaveBeenCalledWith('archived_at', null);
  });
});
