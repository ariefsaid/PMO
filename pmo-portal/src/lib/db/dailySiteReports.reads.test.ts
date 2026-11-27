import { expect, it, vi } from 'vitest';
const h = vi.hoisted(() => ({ from: vi.fn(), selects: [] as string[] }));
vi.mock('@/src/lib/supabase/client', () => ({ supabase: { from: h.from } }));
import { getReport } from './dailySiteReports';
it('reads the project with the report in six requests and starts the five children together', async () => {
  const project = { id: 'p', name: 'Project', project_manager_id: 'pm', pm: { full_name: 'Manager' } };
  let resolveChildren!: () => void;
  const children = new Promise<void>(resolve => { resolveChildren = resolve; });
  h.from.mockImplementation((table: string) => {
    const builder = {
      select: (columns: string) => { h.selects.push(columns); return builder; },
      eq: () => builder, order: () => builder, range: () => builder,
      maybeSingle: () => Promise.resolve({ data: { id: 'report', project_id: 'p', project, work_orders: null }, error: null }),
      then: (resolve: (value: unknown) => void) => children.then(() => resolve({ data: [], error: null })),
    };
    expect(['daily_site_reports', 'dsr_progress_lines', 'dsr_idle_periods', 'dsr_consumables', 'dsr_photos', 'dsr_events']).toContain(table);
    return builder;
  });
  const pending = getReport('report');
  // Header resolution schedules all child requests without waiting for a sibling.
  await vi.waitFor(() => expect(h.from).toHaveBeenCalledTimes(6));
  expect(h.selects[0]).toContain('project:projects!daily_site_reports_project_id_fkey');
  resolveChildren();
  const result = await pending;
  expect(result?.project).toEqual(project);
  expect(result?.report).not.toHaveProperty('project');
  expect(h.from).toHaveBeenCalledTimes(6);
});
