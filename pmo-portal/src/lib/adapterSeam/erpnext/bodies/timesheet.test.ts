/**
 * AC-TSP-032 — `bodies/timesheet.ts` against the FROZEN spike map
 * (docs/spikes/2026-07-20-erpnext-timesheet-fields.md §9). No field name here is invented: every key
 * asserted below was captured from a live-bench request/response.
 *
 * The three properties that are security/costing-critical rather than cosmetic:
 *  - **no dimension is ever silently omitted** (Luna SF9): an unresolved employee/project/activity is a
 *    THROW, never a body missing that key — ERP validates NEITHER `employee` NOR `project` (spike §8),
 *    so an omitted/garbage dimension posts a clean 200 and mis-attributes a week of cost;
 *  - **no billing fields** (owner ruling — P3b is costing only). Asserted as key ABSENCE;
 *  - **no `hours`** on a row: both timestamps are sent, and ERP always recomputes `hours` from them
 *    (spike §1a), so sending it adds nothing and invites drift.
 */
import { describe, expect, it } from 'vitest';
import type { ErpCtx } from '../doctypeRegistry.ts';
import { tsToBody, tsFromDoc, TS_FROM_DOC_FIELDS } from './timesheet.ts';

const ctx = (over: Partial<ErpCtx> = {}): ErpCtx => ({
  refs: { employee: 'HR-EMP-00001', 'project:p-a': 'PROJ-0001', 'project:p-b': 'PROJ-0002' },
  config: { default_activity_type: 'Execution', timesheet_day_start: '09:00:00' },
  ...over,
});

const record = () => ({
  id: 'ts-1',
  entries: [
    { project_id: 'p-a', entry_date: '2026-07-20', hours: '2.5' },
    { project_id: 'p-b', entry_date: '2026-07-20', hours: '3' },
  ],
});

describe('erpnext/bodies/timesheet — tsToBody (spike §9)', () => {
  it('AC-TSP-032 sends employee + one time_logs row per entry with BOTH from_time and to_time, activity_type and project', () => {
    expect(tsToBody(record(), ctx())).toEqual({
      employee: 'HR-EMP-00001',
      time_logs: [
        { from_time: '2026-07-20 09:00:00', to_time: '2026-07-20 11:30:00', activity_type: 'Execution', project: 'PROJ-0001' },
        { from_time: '2026-07-20 11:30:00', to_time: '2026-07-20 14:30:00', activity_type: 'Execution', project: 'PROJ-0002' },
      ],
    });
  });

  it('AC-TSP-032 sends NO `hours` on a row (spike §1a: both timestamps present ⇒ ERP always recomputes it)', () => {
    const body = tsToBody(record(), ctx()) as { time_logs: Array<Record<string, unknown>> };
    for (const row of body.time_logs) expect(Object.keys(row)).not.toContain('hours');
  });

  it('AC-TSP-032 sends NO billing fields at all (owner ruling: costing only — assert ABSENCE, not value)', () => {
    const body = tsToBody(record(), ctx()) as { time_logs: Array<Record<string, unknown>>; [k: string]: unknown };
    for (const key of ['is_billable', 'billing_hours', 'billing_rate', 'sales_invoice']) {
      expect(Object.keys(body)).not.toContain(key);
      for (const row of body.time_logs) expect(Object.keys(row)).not.toContain(key);
    }
  });

  it('AC-TSP-032 never sends the anchor itself (`note` is stamped by the adapter, not the builder)', () => {
    expect(Object.keys(tsToBody(record(), ctx()) as Record<string, unknown>)).toEqual(['employee', 'time_logs']);
  });

  it('AC-TSP-032 defaults the day start to 09:00:00 when the binding config omits it', () => {
    const body = tsToBody(record(), ctx({ config: { default_activity_type: 'Execution' } })) as {
      time_logs: Array<{ from_time: string }>;
    };
    expect(body.time_logs[0].from_time).toBe('2026-07-20 09:00:00');
  });

  it('AC-TSP-032 THROWS rather than omitting an unresolved employee (ERP would accept a phantom — spike §8)', () => {
    expect(() => tsToBody(record(), ctx({ refs: { 'project:p-a': 'PROJ-0001', 'project:p-b': 'PROJ-0002' } }))).toThrow(
      /employee/,
    );
  });

  it('AC-TSP-032 THROWS rather than omitting an unresolved project dimension for any row', () => {
    expect(() => tsToBody(record(), ctx({ refs: { employee: 'HR-EMP-00001', 'project:p-a': 'PROJ-0001' } }))).toThrow(
      /project/,
    );
  });

  it('AC-TSP-032 THROWS when default_activity_type is unconfigured (mandatory whenever employee is set — spike §1b)', () => {
    expect(() => tsToBody(record(), ctx({ config: {} }))).toThrow(/activity/);
  });

  it('AC-TSP-032 propagates daily-hours-exceed-24 from the packer (no ERP cap exists — spike §7)', () => {
    const rec = {
      id: 'ts-1',
      entries: [
        { project_id: 'p-a', entry_date: '2026-07-20', hours: '13' },
        { project_id: 'p-b', entry_date: '2026-07-20', hours: '13' },
      ],
    };
    expect(() => tsToBody(rec, ctx())).toThrow('daily-hours-exceed-24');
  });
});

describe('erpnext/bodies/timesheet — tsFromDoc (spike §9)', () => {
  it('AC-TSP-034 mirrors ERP server-computed totals VERBATIM as the read-back oracle (ADR-0048), never recomputed', () => {
    expect(
      tsFromDoc({
        name: 'TS-2026-00011',
        total_hours: 7.25,
        total_costing_amount: 1234.5,
        docstatus: 1,
        modified: '2026-07-20 06:53:49.249217',
        amended_from: null,
      }),
    ).toEqual({
      id: 'TS-2026-00011',
      ts_number: 'TS-2026-00011',
      erp_total_hours: '7.25',
      erp_total_costing_amount: '1234.50',
      erp_docstatus: 1,
      erp_modified: '2026-07-20 06:53:49.249217',
      erp_amended_from: null,
    });
  });

  it('AC-TSP-034 maps an absent total to NULL, never 0 (a real zero must stay distinguishable)', () => {
    const rec = tsFromDoc({ name: 'TS-2026-00012', docstatus: 0, modified: 'm' });
    expect(rec.erp_total_hours).toBeNull();
    expect(rec.erp_total_costing_amount).toBeNull();
  });

  it('AC-TSP-034 TS_FROM_DOC_FIELDS lists exactly the fields tsFromDoc reads (the poll must not write NULLs)', () => {
    expect([...TS_FROM_DOC_FIELDS]).toEqual([
      'name',
      'modified',
      'docstatus',
      'amended_from',
      'total_hours',
      'total_costing_amount',
    ]);
  });
});
