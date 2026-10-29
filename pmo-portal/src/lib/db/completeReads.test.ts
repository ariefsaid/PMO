import { describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => {
  const rows = Array.from({ length: 1005 }, (_, i) => ({
    id: String(i).padStart(4, '0'), project_id: String(i).padStart(4, '0'),
    name: 'Phase', title: 'Meeting', occurred_at: '2026-01-01', created_at: '2026-01-01',
    incident_date: '2026-01-01', granted_at: '2026-01-01', sort_order: 1,
    target_date: '2026-01-01', weight: 1, task_count: 0, calculated_pct: null,
    effective_pct: 0, delivery_pct: null, committed_spend: 0, budget: 0,
  }));
  function query() {
    let from = 0, to = 999;
    const orders: string[] = [];
    const q = {
      select: () => q, eq: () => q, is: () => q,
      order: (column: string) => { orders.push(column); return q; },
      range: (start: number, end: number) => { from = start; to = end; return q; },
      then: (resolve: (v: unknown) => void) => {
        const sorted = [...rows];
        // A stable unique order is needed to produce a complete set across pages.
        if (!orders.includes('id') && !orders.includes('project_id')) sorted.reverse();
        resolve({ data: sorted.slice(from, Math.min(to + 1, from + 1000)), error: null });
      },
    };
    return q;
  }
  return { from: vi.fn(query), rpc: vi.fn(query) };
});
vi.mock('@/src/lib/supabase/client', () => ({ supabase: h }));
import { listTasks, listTasksByMeeting } from './tasks';
import { listIncidents } from './incidents';
import { listMeetingsForContact, listMeetingAttendees, listMeetingGrants } from './meetings';
import { listMilestones, getProjectsDeliverySummary, getProjectsMilestoneDates } from './milestones';

describe('complete list reads', () => {
  it.each([
    ['project tasks', () => listTasks('p')], ['meeting tasks', () => listTasksByMeeting('m')],
    ['incidents', () => listIncidents()], ['contact meetings', () => listMeetingsForContact('c')],
    ['attendees', () => listMeetingAttendees('m')], ['grants', () => listMeetingGrants('m')],
    ['milestones', () => listMilestones('p')], ['calendar milestones', () => getProjectsMilestoneDates(['p'])],
  ])('%s returns all rows with ties across the server cap', async (_name, read) => {
    const rows = await read();
    expect(rows).toHaveLength(1005);
    expect(new Set(rows.map((r) => r.id)).size).toBe(1005);
    expect(rows[0].id).toBe('0000');
  });
  it('returns every project delivery summary, preserving a missing progress signal', async () => {
    const rows = await getProjectsDeliverySummary(['p']);
    expect(Object.keys(rows)).toHaveLength(1005);
    expect(rows['1004'].deliveryPct).toBeNull();
  });
});
