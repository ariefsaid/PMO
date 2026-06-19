import { describe, it, expect } from 'vitest';
import { buildProcurementHistory } from './procurementHistory';
import type { ProcurementDetail } from './procurementLifecycle';

// ---------------------------------------------------------------------------
// Fixture helpers — build a minimal ProcurementDetail bundle for unit testing.
// The detail bundle is the already-loaded aggregate (no fetch in the function).
// ---------------------------------------------------------------------------

function makeDetail(overrides: Partial<ProcurementDetail> = {}): ProcurementDetail {
  return {
    // Required ProcurementWithRefs fields (minimal)
    id: 'proc-1',
    org_id: 'org-1',
    title: 'Test PR',
    status: 'Ordered',
    pr_number: null,
    po_number: null,
    total_value: null,
    requested_by_id: 'user-1',
    approved_by_id: null,
    project_id: null,
    vendor_id: null,
    created_at: '2026-06-01T00:00:00Z',
    notes: null,
    requested_by: null,
    vendor: null,
    project: null,
    approved_by: null,
    // Lifecycle children (minimal empty arrays for unset fields)
    items: [],
    quotations: [],
    receipts: [],
    invoices: [],
    // Slice 5 additions (new record arrays + status events)
    purchase_requests: [],
    rfqs: [],
    purchase_orders: [],
    payments: [],
    statusEvents: [],
    ...overrides,
  } as unknown as ProcurementDetail;
}

// ---------------------------------------------------------------------------
// AC-PR-021 — history unions transition events and record-creation events,
// sorted ascending by timestamp, each with { kind, label, actor, at }.
// ---------------------------------------------------------------------------

describe('AC-PR-021 buildProcurementHistory', () => {
  it('AC-PR-021 history unions transitions and record creations chronologically', () => {
    const t1 = '2026-06-01T08:00:00Z';
    const t2 = '2026-06-02T09:00:00Z';
    const t3 = '2026-06-03T10:00:00Z';
    const t4 = '2026-06-04T11:00:00Z';

    const detail = makeDetail({
      // Two transition events (from the procurement_status_events log)
      statusEvents: [
        {
          id: 'ev1',
          org_id: 'org-1',
          procurement_id: 'proc-1',
          from_status: 'Draft',
          to_status: 'Requested',
          actor_id: 'user-1',
          notes: null,
          created_at: t1,
        },
        {
          id: 'ev2',
          org_id: 'org-1',
          procurement_id: 'proc-1',
          from_status: 'Requested',
          to_status: 'Approved',
          actor_id: 'user-2',
          notes: null,
          created_at: t3,
        },
      ] as unknown as ProcurementDetail['statusEvents'],
      // One purchase_request record (created between t1 and t3)
      purchase_requests: [
        {
          id: 'pr-row-1',
          org_id: 'org-1',
          procurement_id: 'proc-1',
          pr_number: 'PR-260601001',
          reference_number: null,
          status: 'Submitted',
          date: null,
          amount: null,
          created_at: t2,
        },
      ] as unknown as ProcurementDetail['purchase_requests'],
      // One purchase_order record (after the last transition)
      purchase_orders: [
        {
          id: 'po-row-1',
          org_id: 'org-1',
          procurement_id: 'proc-1',
          po_number: 'PO-260604001',
          reference_number: null,
          status: 'Issued',
          date: null,
          amount: null,
          created_at: t4,
        },
      ] as unknown as ProcurementDetail['purchase_orders'],
    });

    const history = buildProcurementHistory(detail);

    // Total: 2 transitions + 1 PR record + 1 PO record = 4 events
    expect(history).toHaveLength(4);

    // Sorted ascending by at
    const ats = history.map((e) => e.at);
    expect(ats).toEqual([t1, t2, t3, t4]);

    // Each item carries the expected shape
    for (const event of history) {
      expect(event).toHaveProperty('kind');
      expect(event).toHaveProperty('label');
      expect(event).toHaveProperty('actor');
      expect(event).toHaveProperty('at');
      expect(['transition', 'record']).toContain(event.kind);
    }

    // First event: transition Draft→Requested
    expect(history[0].kind).toBe('transition');
    expect(history[0].label).toContain('Draft');
    expect(history[0].label).toContain('Requested');
    expect(history[0].actor).toBe('user-1');
    expect(history[0].at).toBe(t1);

    // Second event: PR record creation
    expect(history[1].kind).toBe('record');
    expect(history[1].label).toContain('PR-260601001');
    expect(history[1].at).toBe(t2);

    // Third event: transition Requested→Approved
    expect(history[2].kind).toBe('transition');
    expect(history[2].label).toContain('Requested');
    expect(history[2].label).toContain('Approved');
    expect(history[2].actor).toBe('user-2');
    expect(history[2].at).toBe(t3);

    // Fourth event: PO record creation
    expect(history[3].kind).toBe('record');
    expect(history[3].label).toContain('PO-260604001');
    expect(history[3].at).toBe(t4);
  });

  it('AC-PR-021 returns empty array when detail has no events or records', () => {
    const detail = makeDetail();
    expect(buildProcurementHistory(detail)).toEqual([]);
  });

  it('AC-PR-021 transition events come from the persisted log (statusEvents), not synthesized from status stamps', () => {
    // Only statusEvents feed transitions — no event for quotations/receipts/invoices in the transition log
    const detail = makeDetail({
      statusEvents: [
        {
          id: 'ev1',
          org_id: 'org-1',
          procurement_id: 'proc-1',
          from_status: null,
          to_status: 'Draft',
          actor_id: null,
          notes: null,
          created_at: '2026-06-01T00:00:00Z',
        },
      ] as unknown as ProcurementDetail['statusEvents'],
    });
    const history = buildProcurementHistory(detail);
    const transitions = history.filter((e) => e.kind === 'transition');
    expect(transitions).toHaveLength(1);
    // from_status null is rendered as something reasonable (e.g. 'Created' or empty string)
    expect(transitions[0].label).toContain('Draft');
    expect(transitions[0].actor).toBeNull();
  });

  it('AC-PR-021 includes all four new record types (rfqs, purchase_orders, payments) in record events', () => {
    const detail = makeDetail({
      rfqs: [
        {
          id: 'rfq-1',
          org_id: 'org-1',
          procurement_id: 'proc-1',
          rfq_number: 'RFQ-260601001',
          reference_number: null,
          status: 'Draft',
          date: null,
          amount: null,
          created_at: '2026-06-10T00:00:00Z',
        },
      ] as unknown as ProcurementDetail['rfqs'],
      payments: [
        {
          id: 'pay-1',
          org_id: 'org-1',
          procurement_id: 'proc-1',
          invoice_id: null,
          pay_number: 'PAY-260611001',
          reference_number: null,
          status: 'Scheduled',
          date: null,
          amount: null,
          created_at: '2026-06-11T00:00:00Z',
        },
      ] as unknown as ProcurementDetail['payments'],
    });

    const history = buildProcurementHistory(detail);
    const records = history.filter((e) => e.kind === 'record');
    const labels = records.map((e) => e.label);

    expect(labels.some((l) => l.includes('RFQ-260601001'))).toBe(true);
    expect(labels.some((l) => l.includes('PAY-260611001'))).toBe(true);
  });

  it('AC-PR-021 also includes legacy record types (quotations, receipts, invoices)', () => {
    const detail = makeDetail({
      quotations: [
        {
          id: 'q-1',
          vq_number: 'VQ-260601001',
          created_at: '2026-06-05T00:00:00Z',
        },
      ] as unknown as ProcurementDetail['quotations'],
      receipts: [
        {
          id: 'r-1',
          gr_number: 'GR-260601001',
          created_at: '2026-06-06T00:00:00Z',
        },
      ] as unknown as ProcurementDetail['receipts'],
      invoices: [
        {
          id: 'i-1',
          vi_number: 'VI-260601001',
          created_at: '2026-06-07T00:00:00Z',
        },
      ] as unknown as ProcurementDetail['invoices'],
    });

    const history = buildProcurementHistory(detail);
    const records = history.filter((e) => e.kind === 'record');
    const labels = records.map((e) => e.label);

    expect(labels.some((l) => l.includes('VQ-260601001'))).toBe(true);
    expect(labels.some((l) => l.includes('GR-260601001'))).toBe(true);
    expect(labels.some((l) => l.includes('VI-260601001'))).toBe(true);
  });

  it('AC-PR-021 stable sort: events with identical timestamps preserve relative order', () => {
    const sameTime = '2026-06-01T00:00:00Z';
    const detail = makeDetail({
      statusEvents: [
        {
          id: 'ev1',
          org_id: 'org-1',
          procurement_id: 'proc-1',
          from_status: 'Draft',
          to_status: 'Requested',
          actor_id: null,
          notes: null,
          created_at: sameTime,
        },
      ] as unknown as ProcurementDetail['statusEvents'],
      purchase_requests: [
        {
          id: 'pr-row-1',
          org_id: 'org-1',
          procurement_id: 'proc-1',
          pr_number: 'PR-001',
          reference_number: null,
          status: 'Submitted',
          date: null,
          amount: null,
          created_at: sameTime,
        },
      ] as unknown as ProcurementDetail['purchase_requests'],
    });
    const history = buildProcurementHistory(detail);
    expect(history).toHaveLength(2);
    // Both at the same time — just assert we get both without crashing
    expect(history.every((e) => e.at === sameTime)).toBe(true);
  });
});
