import { describe, it, expect, vi } from 'vitest';
import {
  PR_STAGES,
  stageIndexForStatus,
  lifecycleSteps,
  pillVariantForStatus,
  stageLabelForStatus,
  selectedQuotation,
  openPR,
} from './procurement';
import type { ProcurementStatus } from '@/src/lib/db/procurementLifecycle';

describe('procurement helper — lifecycle model (Issue 3)', () => {
  it('PR_STAGES is the seven-node PR→Approved→VQ→PO→GR→VI→Paid track in order', () => {
    // Wave-1 Area-5 (PROC-002/003): Approved is its own node; Quote Selected
    // folds into the VQ node (not PO).
    expect(PR_STAGES.map((s) => s.key)).toEqual(['pr', 'approved', 'vq', 'po', 'gr', 'vi', 'paid']);
  });

  it('maps in-flight statuses to their stage index (Approved its own node; Quote Selected → VQ)', () => {
    expect(stageIndexForStatus('Draft' as ProcurementStatus)).toBe(0);
    expect(stageIndexForStatus('Requested' as ProcurementStatus)).toBe(0);
    // PROC-002: Approved advances to its own node (was 0)
    expect(stageIndexForStatus('Approved' as ProcurementStatus)).toBe(1);
    expect(stageIndexForStatus('Vendor Quoted' as ProcurementStatus)).toBe(2);
    // PROC-003: Quote Selected shares the VQ node (was 2/PO) — no PO pre-jump
    expect(stageIndexForStatus('Quote Selected' as ProcurementStatus)).toBe(2);
    expect(stageIndexForStatus('Ordered' as ProcurementStatus)).toBe(3);
    expect(stageIndexForStatus('Received' as ProcurementStatus)).toBe(4);
    expect(stageIndexForStatus('Vendor Invoiced' as ProcurementStatus)).toBe(5);
    expect(stageIndexForStatus('Paid' as ProcurementStatus)).toBe(6);
  });

  it('terminal Rejected/Cancelled map to a sentinel (-1)', () => {
    expect(stageIndexForStatus('Rejected' as ProcurementStatus)).toBe(-1);
    expect(stageIndexForStatus('Cancelled' as ProcurementStatus)).toBe(-1);
  });

  it('I1: pill variant — Paid → won, Rejected/Cancelled → lost, Draft → draft, in-flight → progress (neutral, not blue)', () => {
    expect(pillVariantForStatus('Paid' as ProcurementStatus)).toBe('won');
    expect(pillVariantForStatus('Rejected' as ProcurementStatus)).toBe('lost');
    expect(pillVariantForStatus('Cancelled' as ProcurementStatus)).toBe('lost');
    expect(pillVariantForStatus('Draft' as ProcurementStatus)).toBe('draft');
    // The three look-alike in-flight statuses become the neutral `progress`
    // variant — distinct from each other by LABEL, distinct from the blue `open`
    // reading; removes the I1 "3 identical blue pills" tell and stays one-blue.
    expect(pillVariantForStatus('Requested' as ProcurementStatus)).toBe('progress');
    expect(pillVariantForStatus('Approved' as ProcurementStatus)).toBe('progress');
    expect(pillVariantForStatus('Vendor Quoted' as ProcurementStatus)).toBe('progress');
    expect(pillVariantForStatus('Quote Selected' as ProcurementStatus)).toBe('progress');
    expect(pillVariantForStatus('Ordered' as ProcurementStatus)).toBe('progress');
    expect(pillVariantForStatus('Received' as ProcurementStatus)).toBe('progress');
    expect(pillVariantForStatus('Vendor Invoiced' as ProcurementStatus)).toBe('progress');
  });

  it('stage label: Paid → "Paid", terminal → status, else the stage full name', () => {
    expect(stageLabelForStatus('Paid' as ProcurementStatus)).toBe('Paid');
    expect(stageLabelForStatus('Ordered' as ProcurementStatus)).toBe('Purchase Order');
    expect(stageLabelForStatus('Vendor Quoted' as ProcurementStatus)).toBe('Vendor Quote');
    expect(stageLabelForStatus('Rejected' as ProcurementStatus)).toBe('Rejected');
  });

  it('I1: Draft vs Requested are distinguished by LABEL (color-not-only) — both quiet, neither the blue open', () => {
    // Draft → `draft` variant + "Draft" label
    expect(stageLabelForStatus('Draft' as ProcurementStatus)).toBe('Draft');
    expect(pillVariantForStatus('Draft' as ProcurementStatus)).toBe('draft');
    // Requested → neutral `progress` variant + the distinct "Purchase Request"
    // label (no longer the blue `open` — the in-flight stages are quiet now,
    // differentiated from each other by label + the row's lifecycle pip stepper).
    expect(stageLabelForStatus('Requested' as ProcurementStatus)).toBe('Purchase Request');
    expect(pillVariantForStatus('Requested' as ProcurementStatus)).toBe('progress');
    // the two distinct labels are what carry the difference (AS-4)
    expect(stageLabelForStatus('Draft' as ProcurementStatus)).not.toBe(
      stageLabelForStatus('Requested' as ProcurementStatus),
    );
  });
});

describe('procurement helper — lifecycleSteps (node + inline stepper)', () => {
  it('marks stages before current done, current current, later upcoming', () => {
    // PROC-003: Quote Selected is the VQ node (idx 2 of the 7-node track), so the
    // PR + Approved nodes are done and the badge has NOT pre-jumped to PO.
    const steps = lifecycleSteps('Quote Selected' as ProcurementStatus);
    expect(steps.map((s) => s.state)).toEqual([
      'done', // PR
      'done', // Approved
      'current', // VQ (Quote Selected at idx 2 — NOT PO)
      'upcoming', // PO
      'upcoming', // GR
      'upcoming', // VI
      'upcoming', // Paid
    ]);
  });

  it('PROC-001: at Quote Selected the current (VQ) node is labelled "Quote Selected" — ONE noun with the badge/toast', () => {
    // PROC-003 keeps the selection on the VQ node (no PO pre-jump); PROC-001 aligns the
    // user-facing noun, so the ACTIVE node names the same state the badge + toast show
    // ("Quote Selected"), not the generic macro-node name "Vendor Quote".
    const steps = lifecycleSteps('Quote Selected' as ProcurementStatus);
    const current = steps.find((s) => s.state === 'current')!;
    expect(current.label).toBe('Quote Selected');
    // The earlier (done) VQ-adjacent nodes keep their canonical names; only the active node renames.
    expect(steps[0].label).toBe('Purchase Request');
    expect(steps[1].label).toBe('Approved');
  });

  it('PROC-001: at Vendor Quoted the current node keeps its canonical "Vendor Quote" label', () => {
    const steps = lifecycleSteps('Vendor Quoted' as ProcurementStatus);
    const current = steps.find((s) => s.state === 'current')!;
    expect(current.label).toBe('Vendor Quote');
  });

  it('PROC-002: an Approved PR sits at the Approved node (later than Requested)', () => {
    const requested = lifecycleSteps('Requested' as ProcurementStatus);
    const approved = lifecycleSteps('Approved' as ProcurementStatus);
    expect(requested.findIndex((s) => s.state === 'current')).toBe(0); // PR node
    expect(approved.findIndex((s) => s.state === 'current')).toBe(1); // Approved node
  });

  it('a Paid procurement marks all done and the final node paid', () => {
    const steps = lifecycleSteps('Paid' as ProcurementStatus);
    expect(steps.map((s) => s.state)).toEqual([
      'done', 'done', 'done', 'done', 'done', 'done', 'paid',
    ]);
  });

  it('a Rejected procurement marks PR current and later stages skipped', () => {
    const steps = lifecycleSteps('Rejected' as ProcurementStatus);
    expect(steps[0].state).toBe('current');
    expect(steps.slice(1).every((s) => s.state === 'skipped')).toBe(true);
  });

  it('attaches doc refs to reached node steps from the procurement record', () => {
    // 7-node track: PR(0) · Approved(1, no doc) · VQ(2) · PO(3) · GR(4) · VI(5) · Paid(6)
    const steps = lifecycleSteps('Ordered' as ProcurementStatus, {
      pr_number: 'PR-2606040001',
      vq_number: 'VQ-2606040002',
      po_number: 'PO-2606040003',
    });
    expect(steps[0].ref).toBe('PR-2606040001'); // PR
    expect(steps[1].ref).toBeUndefined(); // Approved node — no minted doc ref
    expect(steps[2].ref).toBe('VQ-2606040002'); // VQ
    expect(steps[3].ref).toBe('PO-2606040003'); // PO
    expect(steps[4].ref).toBeUndefined(); // GR not yet reached
  });
});

describe('procurement helper — selectedQuotation (PROC-004 selected-quote binding)', () => {
  // The chosen quotation that backs the "Selected quote" tile + the row "Selected"
  // pill. Must bind from the `Quote Selected` state onward through Paid — not only
  // at Ordered/Paid — so the operator sees which quote (and amount) they committed
  // to immediately after selecting it.
  const q = (over: Partial<{ id: string; is_selected: boolean; total_amount: number; vendor_id: string | null }>) => ({
    id: 'q-x',
    procurement_id: 'proc-1',
    vendor_id: null,
    total_amount: 0,
    vq_number: null,
    is_selected: false,
    reference: null,
    received_date: '2026-01-01',
    file_url: null,
    org_id: 'org-1',
    created_at: '2026-01-01T00:00:00Z',
    ...over,
  });

  it('PROC-004: prefers the quotation flagged is_selected (set by the select-quote RPC)', () => {
    const chosen = q({ id: 'q-sel', is_selected: true, total_amount: 148000 });
    const other = q({ id: 'q-other', is_selected: false, total_amount: 152000 });
    const sel = selectedQuotation('Quote Selected' as ProcurementStatus, [other, chosen], {
      total_value: 148000,
      vendor_id: 'v-1',
    });
    expect(sel?.id).toBe('q-sel');
  });

  it('PROC-004: binds from Quote Selected onward — a Quote-Selected PR with a flagged quote resolves it', () => {
    const chosen = q({ id: 'q-sel', is_selected: true, total_amount: 99000 });
    const sel = selectedQuotation('Quote Selected' as ProcurementStatus, [chosen], {
      total_value: 99000,
      vendor_id: 'v-2',
    });
    expect(sel?.id).toBe('q-sel');
    expect(sel?.total_amount).toBe(99000);
  });

  it('PROC-004: at-or-past Quote Selected with NO flag set falls back to the header-matching quote (flag-drift resilient)', () => {
    // A PR forced to Quote Selected without the flag (e.g. legacy/seed/aborted flow):
    // the synced header total + vendor still identify the committed quote, so the
    // tile binds instead of reverting to "Pending".
    const a = q({ id: 'q-a', is_selected: false, total_amount: 152000, vendor_id: 'v-9' });
    const b = q({ id: 'q-b', is_selected: false, total_amount: 148000, vendor_id: 'v-5' });
    const sel = selectedQuotation('Ordered' as ProcurementStatus, [a, b], {
      total_value: 148000,
      vendor_id: 'v-5',
    });
    expect(sel?.id).toBe('q-b');
  });

  it('PROC-004: before Quote Selected (Vendor Quoted, no flag) there is NO selected quote', () => {
    const a = q({ id: 'q-a', is_selected: false, total_amount: 152000 });
    const b = q({ id: 'q-b', is_selected: false, total_amount: 148000 });
    const sel = selectedQuotation('Vendor Quoted' as ProcurementStatus, [a, b], {
      total_value: 150000,
      vendor_id: null,
    });
    expect(sel).toBeUndefined();
  });

  it('PROC-004: no quotations → undefined (tile stays "Pending")', () => {
    expect(
      selectedQuotation('Quote Selected' as ProcurementStatus, [], { total_value: 0, vendor_id: null }),
    ).toBeUndefined();
  });
});

describe('procurement helper — openPR navigates to the detail route (AC-NAV-006)', () => {
  it('AC-NAV-006: navigates to /procurement/:id (no tab)', () => {
    const navigate = vi.fn();
    openPR(navigate, { id: 'proc-1' });
    expect(navigate).toHaveBeenCalledWith('/procurement/proc-1');
  });

  it('AC-NAV-006: navigates by id (the full record row carries more fields; only id is read)', () => {
    const navigate = vi.fn();
    const row = { id: 'proc-abcdef12', title: 'Crane hire', code: null };
    openPR(navigate, row);
    expect(navigate).toHaveBeenCalledWith('/procurement/proc-abcdef12');
  });
});
