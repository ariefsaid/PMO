import { describe, expect, it } from 'vitest';
import { selectOverdueTaskCount } from './overdueTasks';

describe('selectOverdueTaskCount', () => {
  it('returns the same count for owner summaries and PM due rows', () => {
    const tasks: Array<{ project_id: string; status: 'To Do' | 'In Progress' | 'Blocked' | 'Done'; end_date: string | null }> = [
      { project_id: 'p1', status: 'To Do', end_date: '2026-11-10' },
      { project_id: 'p1', status: 'In Progress', end_date: '2026-11-09' },
      { project_id: 'p1', status: 'Blocked', end_date: '2026-11-01' },
      { project_id: 'p1', status: 'Done', end_date: '2026-11-01' },
      { project_id: 'p1', status: 'To Do', end_date: '2026-11-11' },
    ];
    expect(selectOverdueTaskCount(3, '2026-11-11')).toBe(3);
    expect(selectOverdueTaskCount(tasks, '2026-11-11', 'p1')).toBe(3);
  });

  it('keeps an unknown organization day unknown and omits other projects', () => {
    const task: Array<{ project_id: string; status: 'To Do'; end_date: string }> = [{ project_id: 'p2', status: 'To Do', end_date: '2026-11-10' }];
    expect(selectOverdueTaskCount(task, null, 'p1')).toBeNull();
    expect(selectOverdueTaskCount(task, '2026-11-11', 'p1')).toBe(0);
  });
});
