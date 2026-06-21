import { describe, it, expect } from 'vitest';
import { PR_STAGES, stageIndexForStatus, lifecycleSteps } from '../procurement';
import type { ProcurementStatus } from '@/src/lib/db/procurementLifecycle';

// ---------------------------------------------------------------------------
// AC-IXD-PROC-003 — selecting a quote must NOT pre-jump the badge/stepper to
// "Purchase Order" before a PO exists (IxD #11/#12). `Quote Selected` is folded
// into the vendor-quote node: it shares the SAME stage index as `Vendor Quoted`,
// and the PO node is only reached once a PO is genuinely generated (Ordered).
//
// AC-IXD-PROC-002 (owner directive 2026-06-21) — approval is a GATE, not a
// stage. There is NO standalone "Approved" node. Approving advances the bar:
// at Approved the PR node is `done` and the Vendor-Quote node is `current`
// (the bar moves on approval even though no quote exists yet — VQ is the next
// action). This REVERSES the prior PROC-002 "Approved is its own node" decision.
// ---------------------------------------------------------------------------

const s = (v: string) => v as ProcurementStatus;

describe('AC-IXD-PROC-003: Select Quote does not pre-jump the badge to Purchase Order', () => {
  it('AC-IXD-PROC-003: Quote Selected shares the vendor-quote stage index (not the PO stage)', () => {
    const vqIdx = stageIndexForStatus(s('Vendor Quoted'));
    const quoteSelectedIdx = stageIndexForStatus(s('Quote Selected'));
    expect(quoteSelectedIdx).toBe(vqIdx);
  });

  it('AC-IXD-PROC-003: the Purchase Order stage is only reached once Ordered', () => {
    const orderedIdx = stageIndexForStatus(s('Ordered'));
    const quoteSelectedIdx = stageIndexForStatus(s('Quote Selected'));
    // PO is strictly after the vendor-quote node …
    expect(orderedIdx).toBeGreaterThan(quoteSelectedIdx);
    // … and the stage Ordered lands in is the PO node.
    expect(PR_STAGES[orderedIdx].key).toBe('po');
    // Quote Selected lands in the VQ node, not the PO node.
    expect(PR_STAGES[quoteSelectedIdx].key).toBe('vq');
  });
});

describe('AC-IXD-PROC-002 (approval is a gate, not a stage): approving advances the bar', () => {
  it('AC-IXD-PROC-002: there is NO standalone "approved" stage in PR_STAGES', () => {
    expect(PR_STAGES.map((st) => st.key)).not.toContain('approved');
  });

  it('AC-IXD-PROC-002: Approved has a stage index strictly after Requested (the bar advanced)', () => {
    expect(stageIndexForStatus(s('Approved'))).toBeGreaterThan(
      stageIndexForStatus(s('Requested')),
    );
  });

  it('AC-IXD-PROC-002: approving lands on the Vendor-Quote node (PR done, VQ current — the next action)', () => {
    const approvedIdx = stageIndexForStatus(s('Approved'));
    expect(PR_STAGES[approvedIdx].key).toBe('vq');

    const steps = lifecycleSteps(s('Approved'));
    expect(steps[0].state).toBe('done'); // PR node done — approved
    expect(steps[1].state).toBe('current'); // VQ node current — the next action
    expect(steps[1].label).toBe('Vendor Quote'); // not mislabelled "Approved"
  });
});
