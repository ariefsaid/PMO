/**
 * feedErrorPolicy.test.ts (HIGH-A, Luna re-audit round 2) — which inbound-apply failures are a
 * TERMINAL, ack-and-skip outcome for ONE document, and which must halt the poll.
 *
 * Verify: cd pmo-portal && npx vitest run src/lib/adapterSeam/erpnext/feedErrorPolicy.test.ts
 */
import { describe, it, expect } from 'vitest';
import { AdapterError } from '../contract';
import { AppError } from '../../appError';
import { erpFeedApplyErrorPolicy, terminalApplyReason } from './feedErrorPolicy';

describe('erpFeedApplyErrorPolicy (HIGH-A — one Desk-created doc must never wedge the sweep)', () => {
  it('a Desk-created Budget PMO must never adopt is SKIPPED (FR-BUD-140 — expected, terminal, ack-and-skip)', () => {
    expect(erpFeedApplyErrorPolicy(new AppError('native-budget-not-adopted', 'native-budget-not-adopted'))).toBe('skip');
  });

  it('a Desk-created Timesheet PMO must never adopt is SKIPPED (FR-TSP-082)', () => {
    expect(erpFeedApplyErrorPolicy(new AppError('native-timesheet-not-adopted', 'native-timesheet-not-adopted'))).toBe('skip');
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

  // ⚑ LOW-2 (audit round 5). The classification decides an HTTP 200 ACK at the webhook ingress, and an
  // ACKed inbound event is DROPPED FOR GOOD (the poll is `modified >= cursor`, so it is never re-listed).
  // Matching on a message SUBSTRING meant any error that merely QUOTED one of the reasons — which is
  // exactly what a wrapper/re-throw does — silently acked a document that was never applied. The reason
  // must be carried as a real classified CODE; a message that merely mentions it proves nothing.
  it('⚑ LOW-2: a RETRYABLE fault whose message merely QUOTES a never-adopt reason still HALTS (no silent drop)', () => {
    const wrapped = new AppError(
      'apply failed while handling native-budget-not-adopted for BUDGET-00042: connection terminated unexpectedly',
      '08006',
    );
    expect(erpFeedApplyErrorPolicy(wrapped)).toBe('halt');
    expect(terminalApplyReason(wrapped)).toBeNull();
  });

  it('⚑ LOW-2: an UNCLASSIFIED Error quoting a never-adopt reason HALTS — only a real `code` skips', () => {
    expect(erpFeedApplyErrorPolicy(new Error('retry of native-timesheet-not-adopted failed: fetch failed'))).toBe('halt');
    expect(erpFeedApplyErrorPolicy(new AdapterError('external-unreachable', 'native-timesheet-not-adopted'))).toBe('halt');
  });
});

describe('terminalApplyReason (AC-TSP-040 — the webhook ingress needs the REASON, not just the verdict)', () => {
  it('names the classified never-adopt reason so the ingress can ACK it and say which rule applied', () => {
    expect(terminalApplyReason(new AppError('…', 'native-timesheet-not-adopted'))).toBe('native-timesheet-not-adopted');
    expect(terminalApplyReason(new AppError('…', 'native-budget-not-adopted'))).toBe('native-budget-not-adopted');
    expect(terminalApplyReason(new AppError('adopt requires a PMO case link', 'procurement-inbound-adopt-no-case-link'))).toBe(
      'procurement-inbound-adopt-no-case-link',
    );
  });

  it('is null for every non-terminal failure — the ingress must still surface those as failures', () => {
    expect(terminalApplyReason(new AppError('connection terminated unexpectedly', '08006'))).toBeNull();
    expect(terminalApplyReason(new Error('fetch failed'))).toBeNull();
    expect(terminalApplyReason(undefined)).toBeNull();
  });

  it('agrees with erpFeedApplyErrorPolicy on every input (one classification, two consumers)', () => {
    const cases: unknown[] = [
      new AppError('…', 'native-timesheet-not-adopted'),
      new AppError('boom', '08006'),
      new AppError('wrapped native-timesheet-not-adopted', '08006'),
      undefined,
    ];
    for (const err of cases) {
      expect(erpFeedApplyErrorPolicy(err)).toBe(terminalApplyReason(err) === null ? 'halt' : 'skip');
    }
  });
});
