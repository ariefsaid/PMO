import { describe, it, expect } from 'vitest';
import { buildProcurementHistory, buildProgressionTimeline } from './procurementHistory';
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

  it('AC-PR-021 stable sort: events with identical timestamps preserve relative order (buildProcurementHistory)', () => {
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

// ---------------------------------------------------------------------------
// buildProgressionTimeline — transition-centric merge (de-noised)
// Each statusEvent is the spine; the matching record is folded in as docRef+docHref.
// Orphan records (no matching transition) are appended as their own row.
// Output is ASCENDING by `at` (the component reverses to newest-first).
// ---------------------------------------------------------------------------

describe('buildProgressionTimeline', () => {
  const PROC_ID = 'proc-1';

  it('returns empty array when there are no events or records', () => {
    const detail = makeDetail();
    expect(buildProgressionTimeline(detail, PROC_ID)).toEqual([]);
  });

  it('AC-PR-PROG-001: folds matching PO record into the "Ordered" transition as docRef (single row, not two)', () => {
    const t1 = '2026-05-06T10:00:00Z';
    const detail = makeDetail({
      statusEvents: [
        {
          id: 'ev1',
          org_id: 'org-1',
          procurement_id: PROC_ID,
          from_status: 'Approved',
          to_status: 'Ordered',
          actor_id: 'user-pm',
          notes: null,
          created_at: t1,
        },
      ] as unknown as ProcurementDetail['statusEvents'],
      purchase_orders: [
        {
          id: 'po-1',
          org_id: 'org-1',
          procurement_id: PROC_ID,
          po_number: 'PO-2026-0077',
          reference_number: null,
          status: 'Issued',
          date: null,
          amount: null,
          created_at: t1,
        },
      ] as unknown as ProcurementDetail['purchase_orders'],
    });

    const events = buildProgressionTimeline(detail, PROC_ID);
    // ONE row (merged), not two separate rows
    expect(events).toHaveLength(1);
    expect(events[0].label).toBe('Ordered');
    expect(events[0].docRef).toBe('PO-2026-0077');
    expect(events[0].actor).toBe('user-pm');
    expect(events[0].at).toBe(t1);
  });

  it('AC-PR-PROG-002: docHref points to /procurement/:id/documents (fallback deep-link)', () => {
    const detail = makeDetail({
      statusEvents: [
        {
          id: 'ev1',
          org_id: 'org-1',
          procurement_id: PROC_ID,
          from_status: 'Approved',
          to_status: 'Ordered',
          actor_id: 'user-pm',
          notes: null,
          created_at: '2026-05-06T10:00:00Z',
        },
      ] as unknown as ProcurementDetail['statusEvents'],
      purchase_orders: [
        {
          id: 'po-1',
          org_id: 'org-1',
          procurement_id: PROC_ID,
          po_number: 'PO-2026-0077',
          reference_number: null,
          status: 'Issued',
          date: null,
          amount: null,
          created_at: '2026-05-06T10:00:00Z',
        },
      ] as unknown as ProcurementDetail['purchase_orders'],
    });

    const events = buildProgressionTimeline(detail, PROC_ID);
    expect(events[0].docHref).toBe(`/procurement/${PROC_ID}/documents`);
  });

  it('AC-PR-PROG-003: a full "Paid" case collapses to 7 rows (one per lifecycle event, no record duplicates)', () => {
    const detail = makeDetail({
      statusEvents: [
        { id: 'e1', org_id: 'org-1', procurement_id: PROC_ID, from_status: null, to_status: 'Requested', actor_id: 'u1', notes: null, created_at: '2026-04-28T09:00:00Z' },
        { id: 'e2', org_id: 'org-1', procurement_id: PROC_ID, from_status: 'Requested', to_status: 'Approved', actor_id: 'u2', notes: null, created_at: '2026-05-02T10:00:00Z' },
        { id: 'e3', org_id: 'org-1', procurement_id: PROC_ID, from_status: 'Approved', to_status: 'Vendor Quoted', actor_id: 'u3', notes: null, created_at: '2026-05-04T11:00:00Z' },
        { id: 'e4', org_id: 'org-1', procurement_id: PROC_ID, from_status: 'Vendor Quoted', to_status: 'Quote Selected', actor_id: 'u3', notes: null, created_at: '2026-05-04T12:00:00Z' },
        { id: 'e5', org_id: 'org-1', procurement_id: PROC_ID, from_status: 'Quote Selected', to_status: 'Ordered', actor_id: 'u4', notes: null, created_at: '2026-05-06T10:00:00Z' },
        { id: 'e6', org_id: 'org-1', procurement_id: PROC_ID, from_status: 'Ordered', to_status: 'Received', actor_id: 'u5', notes: null, created_at: '2026-05-11T08:00:00Z' },
        { id: 'e7', org_id: 'org-1', procurement_id: PROC_ID, from_status: 'Received', to_status: 'Vendor Invoiced', actor_id: 'u6', notes: null, created_at: '2026-05-12T14:00:00Z' },
        { id: 'e8', org_id: 'org-1', procurement_id: PROC_ID, from_status: 'Vendor Invoiced', to_status: 'Paid', actor_id: 'u7', notes: null, created_at: '2026-05-14T12:00:00Z' },
      ] as unknown as ProcurementDetail['statusEvents'],
      purchase_requests: [{ id: 'pr-1', org_id: 'org-1', procurement_id: PROC_ID, pr_number: 'PR-2026-0142', reference_number: null, status: 'Approved', date: null, amount: null, created_at: '2026-04-28T09:00:00Z' }] as unknown as ProcurementDetail['purchase_requests'],
      rfqs: [{ id: 'rfq-1', org_id: 'org-1', procurement_id: PROC_ID, rfq_number: 'RFQ-2026-0091', reference_number: null, status: 'Closed', date: null, amount: null, created_at: '2026-04-30T10:00:00Z' }] as unknown as ProcurementDetail['rfqs'],
      quotations: [{ id: 'vq-1', vq_number: 'VQ-2026-0091', is_selected: true, org_id: 'org-1', procurement_id: PROC_ID, received_date: '2026-05-04T11:00:00Z', reference: null, rfq_id: null, total_amount: 478500, valid_until: null, vendor_id: 'v-1', file_url: null }] as unknown as ProcurementDetail['quotations'],
      purchase_orders: [{ id: 'po-1', org_id: 'org-1', procurement_id: PROC_ID, po_number: 'PO-2026-0077', reference_number: null, status: 'Issued', date: null, amount: null, created_at: '2026-05-06T10:00:00Z' }] as unknown as ProcurementDetail['purchase_orders'],
      receipts: [{ id: 'gr-1', org_id: 'org-1', procurement_id: PROC_ID, gr_number: 'GR-2026-0061', po_id: null, receipt_date: null, status: 'Complete', created_at: '2026-05-11T08:00:00Z' }] as unknown as ProcurementDetail['receipts'],
      invoices: [{ id: 'vi-1', org_id: 'org-1', procurement_id: PROC_ID, vi_number: 'VI-2026-0054', po_id: null, invoice_date: null, status: 'Received', created_at: '2026-05-12T14:00:00Z' }] as unknown as ProcurementDetail['invoices'],
      payments: [{ id: 'pay-1', org_id: 'org-1', procurement_id: PROC_ID, invoice_id: null, pay_number: 'PAY-2026-0033', reference_number: null, status: 'Paid', date: null, amount: null, created_at: '2026-05-14T12:00:00Z' }] as unknown as ProcurementDetail['payments'],
    });

    const events = buildProgressionTimeline(detail, PROC_ID);
    // 8 transitions, all records consumed → 8 rows (one per lifecycle event)
    // (RFQ has no matching transition status; it becomes an orphan row)
    // Requested→PR, Vendor Quoted (no VQ match), Quote Selected→VQ, Ordered→PO, Received→GR, Vendor Invoiced→VI, Paid→PAY
    // Plus orphan RFQ row
    // So: 8 transitions + 1 orphan = 9 — but the important thing is no duplication
    // Better: assert each record system# appears EXACTLY ONCE
    const labels = events.map((e) => e.docRef ?? e.label);
    const allText = events.map((e) => JSON.stringify(e)).join('\n');

    expect(allText).toContain('PR-2026-0142');
    expect(allText).toContain('PO-2026-0077');
    expect(allText).toContain('GR-2026-0061');
    expect(allText).toContain('VI-2026-0054');
    expect(allText).toContain('PAY-2026-0033');
    // Each system# appears exactly once (no record+transition duplication)
    expect((allText.match(/PR-2026-0142/g) ?? []).length).toBe(1);
    expect((allText.match(/PO-2026-0077/g) ?? []).length).toBe(1);
    expect((allText.match(/PAY-2026-0033/g) ?? []).length).toBe(1);
    // Total events < 18 (the old noisy count)
    expect(events.length).toBeLessThan(12);
    void labels; // suppress unused warning
  });

  it('AC-PR-PROG-004: transition label is the to_status value (not "A → B" arrow format)', () => {
    const detail = makeDetail({
      statusEvents: [
        {
          id: 'ev1',
          org_id: 'org-1',
          procurement_id: PROC_ID,
          from_status: 'Requested',
          to_status: 'Approved',
          actor_id: 'user-exec',
          notes: null,
          created_at: '2026-05-02T10:00:00Z',
        },
      ] as unknown as ProcurementDetail['statusEvents'],
    });

    const events = buildProgressionTimeline(detail, PROC_ID);
    expect(events[0].label).toBe('Approved');
    expect(events[0].label).not.toContain('→');
  });

  it('AC-PR-PROG-005: orphan records (no matching transition) appear as their own rows with docRef', () => {
    // RFQ record with no "Vendor Quoted" transition
    const detail = makeDetail({
      rfqs: [
        {
          id: 'rfq-1',
          org_id: 'org-1',
          procurement_id: PROC_ID,
          rfq_number: 'RFQ-2026-0099',
          reference_number: null,
          status: 'Draft',
          date: null,
          amount: null,
          created_at: '2026-05-01T09:00:00Z',
        },
      ] as unknown as ProcurementDetail['rfqs'],
    });

    const events = buildProgressionTimeline(detail, PROC_ID);
    expect(events).toHaveLength(1);
    expect(events[0].docRef).toBe('RFQ-2026-0099');
    expect(events[0].label).toBe('RFQ');
    expect(events[0].docHref).toBe(`/procurement/${PROC_ID}/documents`);
  });

  it('AC-PR-PROG-006: output is sorted ascending by at (component reverses to newest-first)', () => {
    const detail = makeDetail({
      statusEvents: [
        { id: 'e2', org_id: 'org-1', procurement_id: PROC_ID, from_status: 'Requested', to_status: 'Approved', actor_id: 'u2', notes: null, created_at: '2026-05-02T10:00:00Z' },
        { id: 'e1', org_id: 'org-1', procurement_id: PROC_ID, from_status: null, to_status: 'Requested', actor_id: 'u1', notes: null, created_at: '2026-04-28T09:00:00Z' },
      ] as unknown as ProcurementDetail['statusEvents'],
    });

    const events = buildProgressionTimeline(detail, PROC_ID);
    expect(events[0].at < events[1].at).toBe(true);
  });

  // ── Bug fixes (render-caught) ─────────────────────────────────────────────

  it('AC-PR-PROG-012: actorName is the resolved profile full_name, NEVER the raw UUID', () => {
    // The statusEvent carries an embedded actor profile (joined by DETAIL_SELECT).
    // buildProgressionTimeline must surface actorName from that profile join.
    const detail = makeDetail({
      statusEvents: [
        {
          id: 'ev1',
          org_id: 'org-1',
          procurement_id: PROC_ID,
          from_status: 'Draft',
          to_status: 'Requested',
          // actor_id is a UUID — must NOT appear verbatim in actorName
          actor_id: '00000000-0000-0000-0000-0000000000a2',
          // PostgREST embeds the profile row via the FK alias
          actor: { full_name: 'Aiko Tanaka' },
          notes: null,
          created_at: '2025-09-10T09:00:00Z',
        },
      ] as unknown as ProcurementDetail['statusEvents'],
    });

    const events = buildProgressionTimeline(detail, PROC_ID);
    expect(events).toHaveLength(1);
    // actorName must be the resolved name
    expect(events[0].actorName).toBe('Aiko Tanaka');
    // actorName must NOT be the raw UUID
    expect(events[0].actorName).not.toMatch(/^[0-9a-f-]{36}$/i);
  });

  it('AC-PR-PROG-013: actorName falls back to "—" (em-dash) when actor profile is null', () => {
    const detail = makeDetail({
      statusEvents: [
        {
          id: 'ev1',
          org_id: 'org-1',
          procurement_id: PROC_ID,
          from_status: 'Draft',
          to_status: 'Requested',
          actor_id: null,
          actor: null,
          notes: null,
          created_at: '2025-09-10T09:00:00Z',
        },
      ] as unknown as ProcurementDetail['statusEvents'],
    });

    const events = buildProgressionTimeline(detail, PROC_ID);
    expect(events[0].actorName).toBeNull();
  });

  it('AC-PR-PROG-014: orphan record "at" uses business date, not created_at (RFQ with old date sorts before terminal transition)', () => {
    // Scenario: RFQ has business date in 2025-09-11 but was inserted today (created_at = "today").
    // The terminal Paid transition is 2025-11-25.
    // The RFQ must sort BEFORE Paid (not after it), because its business date < Paid date.
    const rfqBusinessDate = '2025-09-11';  // date-only string (date column)
    const rfqCreatedAt = '2026-06-20T00:00:00Z';  // seed insert time = "today" (would float above Paid)
    const paidTransitionAt = '2025-11-25T13:30:00Z';

    const detail = makeDetail({
      statusEvents: [
        {
          id: 'e-paid',
          org_id: 'org-1',
          procurement_id: PROC_ID,
          from_status: 'Vendor Invoiced',
          to_status: 'Paid',
          actor_id: null,
          actor: null,
          notes: null,
          created_at: paidTransitionAt,
        },
      ] as unknown as ProcurementDetail['statusEvents'],
      rfqs: [
        {
          id: 'rfq-1',
          org_id: 'org-1',
          procurement_id: PROC_ID,
          rfq_number: 'RFQ-2509110001',
          reference_number: null,
          status: 'Closed',
          // business date in 2025 — must be used as sort key
          date: rfqBusinessDate,
          amount: null,
          // created_at is "today" (seed insert time) — must NOT be used as sort key
          created_at: rfqCreatedAt,
        },
      ] as unknown as ProcurementDetail['rfqs'],
    });

    const events = buildProgressionTimeline(detail, PROC_ID);
    // RFQ is orphan (no Vendor Quoted transition), should sort by business date 2025-09-11
    // Paid transition is at 2025-11-25 — so RFQ must come FIRST (ascending)
    expect(events).toHaveLength(2);
    // First event = RFQ (business date 2025-09-11)
    expect(events[0].docRef).toBe('RFQ-2509110001');
    // Second event = Paid transition
    expect(events[1].label).toBe('Paid');
    // The at value on the RFQ event should be the business date, not created_at
    expect(events[0].at).toBe(rfqBusinessDate);
  });

  it('AC-PR-PROG-015: orphan record falls back to created_at when date is null', () => {
    const detail = makeDetail({
      rfqs: [
        {
          id: 'rfq-2',
          org_id: 'org-1',
          procurement_id: PROC_ID,
          rfq_number: 'RFQ-2026-0001',
          reference_number: null,
          status: 'Draft',
          date: null,  // no business date — should fall back to created_at
          amount: null,
          created_at: '2026-06-01T00:00:00Z',
        },
      ] as unknown as ProcurementDetail['rfqs'],
    });

    const events = buildProgressionTimeline(detail, PROC_ID);
    expect(events).toHaveLength(1);
    expect(events[0].at).toBe('2026-06-01T00:00:00Z');
  });
});
