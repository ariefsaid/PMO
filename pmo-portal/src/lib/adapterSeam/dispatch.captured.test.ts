import { describe, expect, it, vi } from 'vitest';
import { dispatchMoneyWrite, type DispatchMoneyOutboxDeps, type OutboxRow } from './dispatch.ts';
import { AppError } from '../appError.ts';
import { ErpError } from './erpnext/client.ts';

const command = { domain: 'procurement', operation: 'create' as const, idempotencyKey: 'intent', record: { id: 'payment', erp_doc_kind: 'payment', capturedInvoiceDocumentId: 'doc' } };
function setup(commit = vi.fn(async () => ({ externalRecordId: 'PAY-1', canonical: { id: 'payment' } }))) {
  let row: OutboxRow = { id: 'outbox', domain: 'procurement', pmoRecordId: 'payment', idempotencyKey: 'intent', state: 'pending', externalRecordId: null, canonical: null, claimGeneration: 0, payloadDigest: null };
  const money: DispatchMoneyOutboxDeps = {
    readOutbox: vi.fn(async () => row), insertOutboxPending: vi.fn(async () => row),
    claimOutboxForCommit: vi.fn(async () => { row = { ...row, state: 'committing', claimGeneration: row.claimGeneration + 1 }; return row; }),
    quarantineCommitting: vi.fn(async () => null),
    markOutboxCommitted: vi.fn(async (_id, externalRecordId, canonical) => { row = { ...row, state: 'committed', externalRecordId, canonical }; return 1; }),
    recordOutboxRef: vi.fn(async () => 1), confirmOutbox: vi.fn(async () => { row.state = 'confirmed'; return 1; }),
    markOutboxHeld: vi.fn(async () => 1), markOutboxFailed: vi.fn(async (_id, lastError) => { row.state = 'failed'; row.lastError = lastError; return 1; }),
    reissueOnInconclusiveAbsence: false, probeByRemarksKey: vi.fn(async () => null), backoff: vi.fn(async () => {}),
  };
  const run = () => dispatchMoneyWrite({ adapter: { tier: 'erpnext', capabilityMap: new Set(['procurement']), commit }, command, money, writeReadModel: vi.fn(), recordExternalRef: vi.fn() });
  return { money, commit, run, getRow: () => row };
}
describe('captured payment dispatch', () => {
  it('authorizes the claimed generation before sending and the first claim never probes to adopt', async () => {
    const s = setup();
    s.money.authorizeClaimedWrite = vi.fn(async (claimed) => { expect(claimed.state).toBe('committing'); expect(claimed.claimGeneration).toBe(1); });
    expect((await s.run()).externalRecordId).toBe('PAY-1');
    expect(s.money.authorizeClaimedWrite).toHaveBeenCalledTimes(1);
    expect(s.money.probeByRemarksKey).not.toHaveBeenCalled();
    expect(s.commit).toHaveBeenCalledTimes(1);
    expect(s.getRow().state).toBe('confirmed');
  });
  it('a post-claim refusal records failure and never sends', async () => {
    const s = setup();
    s.money.authorizeClaimedWrite = vi.fn(async (claimed) => {
      await s.money.markOutboxFailed(claimed.id, 'captured_replay_authorization_refused', claimed.claimGeneration);
      throw new AppError('not authorized', 'commit-rejected');
    });
    await expect(s.run()).rejects.toMatchObject({ message: 'not authorized' });
    expect(s.money.markOutboxFailed).toHaveBeenCalledWith('outbox', 'captured_replay_authorization_refused', 1);
    expect(s.getRow().state).toBe('failed');
    expect(s.commit).not.toHaveBeenCalled();
  });
  it('a deterministic allocation rejection spends the terminal budget and stays terminal on replay', async () => {
    const commit = vi.fn(async () => { throw new ErpError(422, 'commit-rejected', 'private detail'); });
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const s = setup(commit);
      await expect(s.run()).rejects.toMatchObject({ message: 'captured_invoice_payment_rejected' });
      expect(s.money.markOutboxFailed).toHaveBeenCalledWith('outbox', 'captured_invoice_payment_rejected', 1, true);
      await expect(s.run()).rejects.toMatchObject({ message: 'captured_invoice_payment_rejected' });
      expect(commit).toHaveBeenCalledTimes(1);
    } finally { log.mockRestore(); }
  });
  it.each([408, 500])('an ambiguous HTTP %s remains in-flight rather than failed', async (status) => {
    const commit = vi.fn(async () => { throw new ErpError(status, 'external-unreachable', 'unavailable'); });
    const s = setup(commit);
    await expect(s.run()).rejects.toMatchObject({ code: 'external-unreachable' });
    expect(s.money.markOutboxFailed).not.toHaveBeenCalled();
    expect(s.getRow().state).toBe('committing');
    expect(commit).toHaveBeenCalledTimes(1);
  });
});
