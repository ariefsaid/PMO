import { describe, it, expect } from 'vitest';
import { PR_STAGES, stageIndexForStatus } from '../procurement';
import type { ProcurementStatus } from '@/src/lib/db/procurementLifecycle';

// ---------------------------------------------------------------------------
// AC-IXD-PROC-003 — selecting a quote must NOT pre-jump the badge/stepper to
// "Purchase Order" before a PO exists (IxD #11/#12). `Quote Selected` is folded
// into the vendor-quote node: it shares the SAME stage index as `Vendor Quoted`,
// and the PO node is only reached once a PO is genuinely generated (Ordered).
//
// AC-IXD-PROC-002 corollary (stage math) — Approve advances the visible stage:
// `Approved` has its own stage position AFTER `Requested`.
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

describe('AC-IXD-PROC-002 (stage math): Approve advances the visible stage', () => {
  it('AC-IXD-PROC-002: Approved has a stage index strictly after Requested', () => {
    expect(stageIndexForStatus(s('Approved'))).toBeGreaterThan(
      stageIndexForStatus(s('Requested')),
    );
  });

  it('AC-IXD-PROC-002: the Approved node is its own position in PR_STAGES', () => {
    const approvedIdx = stageIndexForStatus(s('Approved'));
    expect(PR_STAGES[approvedIdx].key).toBe('approved');
  });
});
