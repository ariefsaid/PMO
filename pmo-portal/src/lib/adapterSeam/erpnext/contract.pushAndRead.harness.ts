/**
 * ERPNext's harness for the push preflights and reads of the shared suites (spec §6.2): drives the SHIPPED dispatch
 * factory and feed code with the transport mocked and answers in PMO terms. No behaviour lives here.
 */
import type { AdapterCommand } from '../contract.ts';
import type { ErpHarness, PreflightResult, TimesheetPushScenario } from '../contractSuite/harness.ts';
import { resolveErpDispatchAdapter, type DispatchServiceClient } from './dispatchFactory.ts';

type PushAndRead = Pick<ErpHarness, 'pushTimesheet' | 'pushProcurement' | 'pushRevenue' | 'pushBudgetVersion' | 'readActuals' | 'classifyPayment' | 'mirrorPurchases'>;

const notYet = (name: string) => () => { throw new Error(`erpnext harness ${name} is not wired yet`); };

/** Counts every call that reaches the (fake) ERP. */
function countingTransport() {
  const stats = { calls: 0 };
  const fetchImpl = (async () => { stats.calls += 1; return new Response('{}', { status: 200 }); }) as unknown as typeof fetch;
  return { stats, fetchImpl };
}

/** Resolve the dispatch adapter for a command; a refusal is the classified code, with the ERP calls it cost. */
async function preflight(serviceClient: DispatchServiceClient, orgId: string, command: AdapterCommand): Promise<PreflightResult> {
  const { stats, fetchImpl } = countingTransport();
  try {
    await resolveErpDispatchAdapter({ serviceClient, orgId, command, fetchImpl, apiKey: 'k', apiSecret: 's' });
    return { outcome: 'accepted', erpCalls: stats.calls };
  } catch (error) {
    const e = error as Error & { code?: string };
    return { outcome: 'refused', code: e.code, message: e.message, erpCalls: stats.calls };
  }
}

// --- timesheet.push -----------------------------------------------------------------------------------------------

const TIMESHEET_BINDING = {
  site_url: 'https://erp.example.com', version_major: 15, activated_at: '2026-07-20T00:00:00.000Z',
  config: {
    company: 'PMO Smoke Co', default_activity_type: 'Execution', timesheet_day_start: '09:00:00',
    project_map: { 'proj-a': 'PROJ-0001', 'proj-b': 'PROJ-0002' },
  },
};

interface TimesheetRows { binding: unknown; employee?: { id: string; org_id: string; profile_id: string; link_state: string; employee_number: string }; refs: Record<string, string> }

/** A table-aware fake that honours the query's OWN filters, so a refusal comes from the query, not an absent fixture. */
function timesheetClient(rows: TimesheetRows): DispatchServiceClient {
  return {
    from(table: string) {
      const filters: Record<string, string> = {};
      const builder = {
        eq(column: string, value: string) { filters[column] = value; return builder; },
        order: () => builder,
        limit: () => builder,
        async maybeSingle() {
          if (table === 'external_org_bindings') return { data: rows.binding, error: null };
          if (table === 'erp_employees') {
            const row = rows.employee;
            const match = row
              && (filters.org_id === undefined || row.org_id === filters.org_id)
              && (filters.profile_id === undefined || row.profile_id === filters.profile_id)
              && (filters.link_state === undefined || row.link_state === filters.link_state);
            return { data: match ? row : null, error: null };
          }
          if (table === 'external_refs') {
            const value = rows.refs[filters.pmo_record_id ?? ''];
            return { data: value ? { external_record_id: value } : null, error: null };
          }
          return { data: null, error: null };
        },
        then(onFulfilled: (v: { data: unknown; error: null }) => unknown) { return Promise.resolve({ data: [], error: null }).then(onFulfilled); },
      };
      return { select: () => builder };
    },
  } as unknown as DispatchServiceClient;
}

const TIMESHEET_PROJECT: Record<TimesheetPushScenario['entries'][number]['project'], { id: string; org: string }> = {
  'a': { id: 'proj-a', org: 'org-1' }, 'b': { id: 'proj-b', org: 'org-1' },
  'unmapped': { id: 'proj-unknown', org: 'org-1' }, 'other-tenant': { id: 'proj-a', org: 'org-2' },
};

function pushTimesheet(s: TimesheetPushScenario): Promise<PreflightResult> {
  const employee = s.employeeLink === 'none' ? undefined : {
    id: 'emp-row-1', employee_number: 'HR-EMP-00001', profile_id: 'user-1',
    org_id: s.employeeLink === 'other-tenant' ? 'org-2' : 'org-1',
    link_state: s.employeeLink === 'proposed' ? 'proposed' : 'confirmed',
  };
  const { default_activity_type: _kept, ...withoutActivity } = TIMESHEET_BINDING.config;
  const binding = { ...TIMESHEET_BINDING, config: s.activityType === 'configured' ? TIMESHEET_BINDING.config : withoutActivity };
  const refs: Record<string, string> = s.employeeLink === 'confirmed-without-erp-id' ? {} : { 'emp-row-1': 'Employee:HR-EMP-00001' };
  return preflight(timesheetClient({ binding, employee, refs }), 'org-1', {
    domain: 'timesheets', operation: 'create',
    record: {
      id: 'ts-1', erp_doc_kind: 'timesheet', user_id: 'user-1', approved_at: '2026-01-12T03:04:05Z',
      entries: s.entries.map((e) => ({ project_id: TIMESHEET_PROJECT[e.project].id, entry_date: e.date, hours: e.hours, project_org_id: TIMESHEET_PROJECT[e.project].org })),
    },
  });
}

export function createPushAndReadHarness(): PushAndRead {
  return {
    pushTimesheet,
    pushProcurement: notYet('pushProcurement'),
    pushRevenue: notYet('pushRevenue'),
    pushBudgetVersion: notYet('pushBudgetVersion'),
    readActuals: notYet('readActuals'),
    classifyPayment: notYet('classifyPayment'),
    mirrorPurchases: notYet('mirrorPurchases'),
  };
}
