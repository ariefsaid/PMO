import { describe, it, expect, vi } from 'vitest';
import {
  PR_STAGES,
  stageIndexForStatus,
  lifecycleSteps,
  pillVariantForStatus,
  stageLabelForStatus,
  openPR,
} from './procurement';
import type { ProcurementStatus } from '@/src/lib/db/procurementLifecycle';

describe('procurement helper — lifecycle model (Issue 3)', () => {
  it('PR_STAGES is the six-node PR→VQ→PO→GR→VI→Paid track in order', () => {
    expect(PR_STAGES.map((s) => s.key)).toEqual(['pr', 'vq', 'po', 'gr', 'vi', 'paid']);
  });

  it('maps in-flight statuses to their stage index', () => {
    expect(stageIndexForStatus('Draft' as ProcurementStatus)).toBe(0);
    expect(stageIndexForStatus('Requested' as ProcurementStatus)).toBe(0);
    expect(stageIndexForStatus('Approved' as ProcurementStatus)).toBe(0);
    expect(stageIndexForStatus('Vendor Quoted' as ProcurementStatus)).toBe(1);
    expect(stageIndexForStatus('Quote Selected' as ProcurementStatus)).toBe(2);
    expect(stageIndexForStatus('Ordered' as ProcurementStatus)).toBe(2);
    expect(stageIndexForStatus('Received' as ProcurementStatus)).toBe(3);
    expect(stageIndexForStatus('Vendor Invoiced' as ProcurementStatus)).toBe(4);
    expect(stageIndexForStatus('Paid' as ProcurementStatus)).toBe(5);
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
    const steps = lifecycleSteps('Quote Selected' as ProcurementStatus);
    expect(steps.map((s) => s.state)).toEqual([
      'done', // PR
      'done', // VQ
      'current', // PO (Quote Selected at idx 2)
      'upcoming', // GR
      'upcoming', // VI
      'upcoming', // Paid
    ]);
  });

  it('a Paid procurement marks all done and the final node paid', () => {
    const steps = lifecycleSteps('Paid' as ProcurementStatus);
    expect(steps.map((s) => s.state)).toEqual(['done', 'done', 'done', 'done', 'done', 'paid']);
  });

  it('a Rejected procurement marks PR current and later stages skipped', () => {
    const steps = lifecycleSteps('Rejected' as ProcurementStatus);
    expect(steps[0].state).toBe('current');
    expect(steps.slice(1).every((s) => s.state === 'skipped')).toBe(true);
  });

  it('attaches doc refs to reached node steps from the procurement record', () => {
    const steps = lifecycleSteps('Ordered' as ProcurementStatus, {
      pr_number: 'PR-2606040001',
      vq_number: 'VQ-2606040002',
      po_number: 'PO-2606040003',
    });
    expect(steps[0].ref).toBe('PR-2606040001');
    expect(steps[1].ref).toBe('VQ-2606040002');
    expect(steps[2].ref).toBe('PO-2606040003');
    expect(steps[3].ref).toBeUndefined(); // GR not yet reached
  });
});

describe('procurement helper — openPR opens a record tab with the human label', () => {
  it('calls ws.openRecord with the PR ref code + title label', () => {
    const openRecord = vi.fn();
    openPR(
      { openRecord },
      { id: 'proc-1', title: 'Structural steel', code: 'PR-2606040001' },
    );
    expect(openRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'procurement:proc-1',
        kind: 'record',
        path: '/procurement/proc-1',
        icon: 'cart',
        label: 'Structural steel',
        code: 'PR-2606040001',
        module: 'procurement',
      }),
    );
  });

  it('falls back to the short id when no code is set', () => {
    const openRecord = vi.fn();
    openPR({ openRecord }, { id: 'proc-abcdef12', title: 'Crane hire', code: null });
    expect(openRecord).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'proc-ab' }),
    );
  });
});
