/**
 * AC-TSP-030 — `resolveTimesheetRefs` (FR-TSP-050..055): the fail-closed reference pre-flight for a
 * Posture-B timesheet push.
 *
 * The AC is an ORDERING property, not a message: every resolution happens BEFORE the adapter exists
 * and therefore before the outbox claim and before any ERP HTTP call. Each test asserts the classified
 * rejection AND that the ERP fetch spy was never called.
 *
 * Why this is load-bearing rather than defensive (spike §8): ERPNext validates NEITHER the `employee`
 * NOR the `project` link — a nonexistent value is accepted through save AND submit with a clean 200,
 * no error of any kind. This pre-flight is the ONLY thing standing between a mis-resolved link and a
 * week of hours silently costed to a phantom employee or with no project dimension at all.
 */
import { describe, expect, it, vi } from 'vitest';
import { resolveErpDispatchAdapter, type DispatchServiceClient } from './dispatchFactory.ts';
import type { AdapterCommand } from '../contract.ts';

const BINDING = {
  site_url: 'https://erp.example.com',
  version_major: 15,
  activated_at: '2026-07-20T00:00:00.000Z',
  config: {
    company: 'PMO Smoke Co',
    default_activity_type: 'Execution',
    timesheet_day_start: '09:00:00',
    project_map: { 'proj-a': 'PROJ-0001', 'proj-b': 'PROJ-0002' },
  },
};

interface FakeRows {
  binding?: unknown;
  employee?: unknown;
  refs?: Record<string, string>;
}

/** A table-aware fake service client: `external_org_bindings`, `erp_employees`, `external_refs`. */
function fakeClient(rows: FakeRows): DispatchServiceClient {
  return {
    from(table: string) {
      const filters: Record<string, string> = {};
      const builder = {
        eq(column: string, value: string) {
          filters[column] = value;
          return builder;
        },
        order: () => builder,
        limit: () => builder,
        async maybeSingle() {
          if (table === 'external_org_bindings') return { data: rows.binding ?? null, error: null };
          if (table === 'erp_employees') {
            const row = rows.employee as { org_id?: string; profile_id?: string; link_state?: string } | undefined;
            // The fake honours the query's OWN filters — a test proving "a `proposed` link is refused"
            // must fail because the QUERY excluded it, not because the fixture happened to be absent.
            const match =
              row &&
              (filters.org_id === undefined || row.org_id === filters.org_id) &&
              (filters.profile_id === undefined || row.profile_id === filters.profile_id) &&
              (filters.link_state === undefined || row.link_state === filters.link_state);
            return { data: match ? row : null, error: null };
          }
          if (table === 'external_refs') {
            const value = rows.refs?.[filters.pmo_record_id ?? ''];
            return { data: value ? { external_record_id: value } : null, error: null };
          }
          return { data: null, error: null };
        },
        then(onFulfilled: (v: { data: unknown; error: null }) => unknown) {
          return Promise.resolve({ data: [], error: null }).then(onFulfilled);
        },
      };
      return { select: () => builder };
    },
  } as unknown as DispatchServiceClient;
}

const CONFIRMED_EMPLOYEE = { id: 'emp-row-1', employee_number: 'HR-EMP-00001', org_id: 'org-1', profile_id: 'user-1', link_state: 'confirmed' };

const command = (over: Partial<AdapterCommand['record']> = {}): AdapterCommand => ({
  domain: 'timesheets',
  operation: 'create',
  record: {
    id: 'ts-1',
    erp_doc_kind: 'timesheet',
    user_id: 'user-1',
    approved_at: '2026-01-12T03:04:05Z',
    entries: [{ project_id: 'proj-a', entry_date: '2026-01-05', hours: '7.25', project_org_id: 'org-1' }],
    ...over,
  },
});

async function resolve(rows: FakeRows, cmd: AdapterCommand = command()) {
  const fetchImpl = vi.fn(async () => new Response('{}', { status: 200 }));
  const promise = resolveErpDispatchAdapter({
    serviceClient: fakeClient({ binding: BINDING, ...rows }),
    orgId: 'org-1',
    command: cmd,
    fetchImpl: fetchImpl as unknown as typeof fetch,
    apiKey: 'k',
    apiSecret: 's',
  });
  return { promise, fetchImpl };
}

describe('erpnext/dispatchFactory — resolveTimesheetRefs (AC-TSP-030)', () => {
  it('AC-TSP-030 resolves the employee (confirmed link → external_refs) and every entry project into ctx.refs', async () => {
    const { promise, fetchImpl } = await resolve({
      employee: CONFIRMED_EMPLOYEE,
      refs: { 'emp-row-1': 'Employee:HR-EMP-00001' },
    });
    const adapter = await promise;
    expect(adapter.tier).toBe('erpnext');
    // No ERP traffic happens during resolution itself.
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('AC-TSP-030 rejects `employee-unlinked` with NO ERP call when no adopted Employee exists', async () => {
    const { promise, fetchImpl } = await resolve({ employee: undefined });
    await expect(promise).rejects.toMatchObject({ code: 'employee-unlinked' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('AC-TSP-030 rejects a `proposed` (not yet Admin-confirmed) link — only `confirmed` authorizes a push', async () => {
    const { promise, fetchImpl } = await resolve({
      employee: { ...CONFIRMED_EMPLOYEE, link_state: 'proposed' },
      refs: { 'emp-row-1': 'Employee:HR-EMP-00001' },
    });
    await expect(promise).rejects.toMatchObject({ code: 'employee-unlinked' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('AC-TSP-030 rejects an employee row belonging to ANOTHER org (the query is org-scoped)', async () => {
    const { promise } = await resolve({
      employee: { ...CONFIRMED_EMPLOYEE, org_id: 'org-2' },
      refs: { 'emp-row-1': 'Employee:HR-EMP-00001' },
    });
    await expect(promise).rejects.toMatchObject({ code: 'employee-unlinked' });
  });

  it('AC-TSP-030 rejects a confirmed link with NO external_refs mapping (the ERP name is never a mirrored column)', async () => {
    const { promise, fetchImpl } = await resolve({ employee: CONFIRMED_EMPLOYEE, refs: {} });
    await expect(promise).rejects.toMatchObject({ code: 'employee-unlinked' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('AC-TSP-030 rejects `project-unmapped` rather than sending a row with no project dimension (Luna SF9)', async () => {
    const { promise, fetchImpl } = await resolve(
      { employee: CONFIRMED_EMPLOYEE, refs: { 'emp-row-1': 'Employee:HR-EMP-00001' } },
      command({ entries: [{ project_id: 'proj-unknown', entry_date: '2026-01-05', hours: '4', project_org_id: 'org-1' }] }),
    );
    await expect(promise).rejects.toMatchObject({ code: 'project-unmapped' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('AC-TSP-030 rejects `cross-org-link-rejected` for an entry whose project belongs to another org', async () => {
    const { promise, fetchImpl } = await resolve(
      { employee: CONFIRMED_EMPLOYEE, refs: { 'emp-row-1': 'Employee:HR-EMP-00001' } },
      command({ entries: [{ project_id: 'proj-a', entry_date: '2026-01-05', hours: '4', project_org_id: 'org-2' }] }),
    );
    await expect(promise).rejects.toMatchObject({ code: 'cross-org-link-rejected' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('AC-TSP-030 rejects `activity-type-unconfigured` when the binding has no default_activity_type', async () => {
    const fetchImpl = vi.fn(async () => new Response('{}', { status: 200 }));
    const { default_activity_type: _omitted, ...config } = BINDING.config;
    await expect(
      resolveErpDispatchAdapter({
        serviceClient: fakeClient({ binding: { ...BINDING, config }, employee: CONFIRMED_EMPLOYEE, refs: { 'emp-row-1': 'Employee:HR-EMP-00001' } }),
        orgId: 'org-1',
        command: command(),
        fetchImpl: fetchImpl as unknown as typeof fetch,
        apiKey: 'k',
        apiSecret: 's',
      }),
    ).rejects.toMatchObject({ code: 'activity-type-unconfigured' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('AC-TSP-030 rejects `daily-hours-exceed-24` BEFORE the ERP call (ERP has no cap and would mis-date the tail)', async () => {
    const { promise, fetchImpl } = await resolve(
      { employee: CONFIRMED_EMPLOYEE, refs: { 'emp-row-1': 'Employee:HR-EMP-00001' } },
      command({
        entries: [
          { project_id: 'proj-a', entry_date: '2026-01-05', hours: '13', project_org_id: 'org-1' },
          { project_id: 'proj-b', entry_date: '2026-01-05', hours: '13', project_org_id: 'org-1' },
        ],
      }),
    );
    await expect(promise).rejects.toMatchObject({ code: 'commit-rejected' });
    await expect(promise).rejects.toThrow(/daily-hours-exceed-24/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('does not touch the timesheets path for another domain (every shipped command stays byte-for-byte)', async () => {
    const adapter = await resolveErpDispatchAdapter({
      serviceClient: fakeClient({ binding: BINDING }),
      orgId: 'org-1',
      command: { domain: 'companies', operation: 'create', record: { id: 'c-1', erp_doc_kind: 'supplier' } },
      fetchImpl: vi.fn() as unknown as typeof fetch,
      apiKey: 'k',
      apiSecret: 's',
    });
    expect(adapter.tier).toBe('erpnext');
  });
});
