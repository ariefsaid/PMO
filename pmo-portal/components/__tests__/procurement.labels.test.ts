import { describe, it, expect } from 'vitest';
import {
  STATUS_LABEL,
  transitionVerb,
  stageLabelForStatus,
  toastStateLabel,
} from '../procurement';
import type { ProcurementStatus } from '@/src/lib/db/procurementLifecycle';

// ---------------------------------------------------------------------------
// AC-IXD-PROC-001 — one canonical label per state across button / badge / toast
// / stepper (IxD #13). The canonical label map is the single source of truth:
// the badge label, the toast state-label, and the button verb that reaches a
// state all resolve from the SAME per-status canonical noun — they cannot drift
// because they read one map (no inline literals).
// ---------------------------------------------------------------------------

const s = (v: string) => v as ProcurementStatus;

describe('AC-IXD-PROC-001: one canonical procurement label per state', () => {
  it('AC-IXD-PROC-001: every status has exactly one canonical user-facing label', () => {
    const statuses = [
      'Draft',
      'Requested',
      'Approved',
      'Vendor Quoted',
      'Quote Selected',
      'Ordered',
      'Received',
      'Vendor Invoiced',
      'Paid',
      'Rejected',
      'Cancelled',
    ] as const;
    for (const st of statuses) {
      expect(typeof STATUS_LABEL[st]).toBe('string');
      expect(STATUS_LABEL[st].length).toBeGreaterThan(0);
    }
  });

  it('AC-IXD-PROC-001: the badge label IS the canonical label for the state', () => {
    // The pill text the user reads is the one canonical noun for that state.
    expect(stageLabelForStatus(s('Requested'))).toBe(STATUS_LABEL.Requested);
    expect(stageLabelForStatus(s('Approved'))).toBe(STATUS_LABEL.Approved);
    expect(stageLabelForStatus(s('Vendor Quoted'))).toBe(STATUS_LABEL['Vendor Quoted']);
    expect(stageLabelForStatus(s('Quote Selected'))).toBe(STATUS_LABEL['Quote Selected']);
    expect(stageLabelForStatus(s('Ordered'))).toBe(STATUS_LABEL.Ordered);
    expect(stageLabelForStatus(s('Paid'))).toBe(STATUS_LABEL.Paid);
    expect(stageLabelForStatus(s('Rejected'))).toBe(STATUS_LABEL.Rejected);
  });

  it('AC-IXD-PROC-001: the success-toast state-label IS the canonical label', () => {
    // The toast that confirms "Moved to <state>" names the SAME noun the badge
    // will show — not the raw enum value (so badge + toast never disagree).
    expect(toastStateLabel(s('Requested'))).toBe(STATUS_LABEL.Requested);
    expect(toastStateLabel(s('Vendor Quoted'))).toBe(STATUS_LABEL['Vendor Quoted']);
    expect(toastStateLabel(s('Ordered'))).toBe(STATUS_LABEL.Ordered);
    expect(toastStateLabel(s('Paid'))).toBe(STATUS_LABEL.Paid);
  });

  it('AC-IXD-PROC-001: badge label === toast label for every reachable state (no drift)', () => {
    const reachable = [
      'Requested',
      'Approved',
      'Vendor Quoted',
      'Quote Selected',
      'Ordered',
      'Received',
      'Vendor Invoiced',
      'Paid',
    ] as const;
    for (const st of reachable) {
      expect(stageLabelForStatus(s(st))).toBe(toastStateLabel(s(st)));
    }
  });

  it('AC-IXD-PROC-001: the button verb to reach a state references that same canonical state', () => {
    // The imperative the user clicks names the state they will land in. The verb
    // for moving TO a status contains the canonical label of that status, so the
    // button → resulting badge → toast all name one state.
    expect(transitionVerb(s('Requested'))).toMatch(/Request/i);
    expect(transitionVerb(s('Approved'))).toMatch(/Approve/i);
    expect(transitionVerb(s('Vendor Quoted'))).toMatch(/Vendor Quote/i);
    expect(transitionVerb(s('Quote Selected'))).toMatch(/Select Quote/i);
    expect(transitionVerb(s('Ordered'))).toMatch(/Purchase Order/i);
    expect(transitionVerb(s('Received'))).toMatch(/Receipt/i);
    expect(transitionVerb(s('Vendor Invoiced'))).toMatch(/Vendor Invoice/i);
    expect(transitionVerb(s('Paid'))).toMatch(/Paid/i);
  });
});
