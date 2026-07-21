/**
 * feedErrorPolicy.test.ts (HIGH-A, Luna re-audit round 2) — which inbound-apply failures are a
 * TERMINAL, ack-and-skip outcome for ONE document, and which must halt the poll.
 *
 * Verify: cd pmo-portal && npx vitest run src/lib/adapterSeam/erpnext/feedErrorPolicy.test.ts
 */
import { describe, it, expect } from 'vitest';
import { AdapterError } from '../contract';
import { AppError } from '../../appError';
import { erpFeedApplyErrorPolicy } from './feedErrorPolicy';

describe('erpFeedApplyErrorPolicy (HIGH-A — one Desk-created doc must never wedge the sweep)', () => {
  it('a Desk-created Budget PMO must never adopt is SKIPPED (FR-BUD-140 — expected, terminal, ack-and-skip)', () => {
    expect(erpFeedApplyErrorPolicy(new AdapterError('commit-rejected', 'native-budget-not-adopted'))).toBe('skip');
  });

  it('a Desk-created Timesheet PMO must never adopt is SKIPPED (FR-TSP-082)', () => {
    expect(erpFeedApplyErrorPolicy(new AdapterError('commit-rejected', 'native-timesheet-not-adopted'))).toBe('skip');
  });

  it('a procurement inbound adopt with no PMO case link is SKIPPED (FR-ENA-083 lossy hint — the dispatch path owns it)', () => {
    expect(
      erpFeedApplyErrorPolicy(new AppError('adopt requires a PMO case link', 'procurement-inbound-adopt-no-case-link')),
    ).toBe('skip');
  });

  it('⚑ a transient DB/network fault HALTS — never skipped past by an advancing watermark', () => {
    expect(erpFeedApplyErrorPolicy(new AppError('connection terminated unexpectedly', '08006'))).toBe('halt');
    expect(erpFeedApplyErrorPolicy(new Error('fetch failed'))).toBe('halt');
    expect(erpFeedApplyErrorPolicy(undefined)).toBe('halt');
  });

  it('⚑ a generic commit-rejected (ERP refused a real write) HALTS — only the NAMED never-adopt classes skip', () => {
    expect(erpFeedApplyErrorPolicy(new AdapterError('commit-rejected', 'ERPNext rejected the document'))).toBe('halt');
  });
});
