/**
 * #1505 P6 (OQ-OPP-10, FR-OPP-070): every Odoo purchase command goes through the money outbox, like the ERPNext tier's, so one PMO record
 * mints at most one Odoo document and a doubtful recovery is held. Driven through the shipped `dispatchExternallyOwnedWrite`.
 */
import { describe, expect, it, vi } from 'vitest';
import { dispatchExternallyOwnedWrite } from '../dispatch.ts';
import type { AdapterCommand } from '../contract.ts';
import { createFakeOutbox } from './purchase/fakeOutbox.ts';

const COMMAND: AdapterCommand = {
  domain: 'procurement', operation: 'create', idempotencyKey: 'k-1',
  record: { id: 'dddddddd-dddd-4ddd-8ddd-000000001505', erp_doc_kind: 'payment' },
};

describe.each(['odoo', 'erpnext'])('the %s tier takes the money outbox path', (tier) => {
  const adapter = (commit: ReturnType<typeof vi.fn>) => ({ tier, capabilityMap: new Set(['procurement']), commit });
  const deps = (commit: ReturnType<typeof vi.fn>, money?: ReturnType<typeof createFakeOutbox>['deps']) =>
    ({ adapter: adapter(commit), command: COMMAND, writeReadModel: vi.fn(), recordExternalRef: vi.fn(), money }) as never;

  it('inserts and claims an outbox row before the adapter commits, and confirms it after', async () => {
    const outbox = createFakeOutbox(false, async () => null);
    const commit = vi.fn(async () => ({ externalRecordId: 'account.payment:1', canonical: { id: COMMAND.record.id } }));
    const result = await dispatchExternallyOwnedWrite(deps(commit, outbox.deps));
    expect(result.externalRecordId).toBe('account.payment:1');
    expect(outbox.rows.size).toBe(1);
    expect(outbox.state()).toBe('confirmed');
    expect(commit).toHaveBeenCalledTimes(1);
  });

  it('a retry of the confirmed command is answered from the outbox: the adapter is not called again', async () => {
    const outbox = createFakeOutbox(false, async () => null);
    const commit = vi.fn(async () => ({ externalRecordId: 'account.payment:1', canonical: { id: COMMAND.record.id } }));
    await dispatchExternallyOwnedWrite(deps(commit, outbox.deps));
    await dispatchExternallyOwnedWrite(deps(commit, outbox.deps));
    expect(commit).toHaveBeenCalledTimes(1);
  });

  it('a command dispatched without outbox deps is refused, not committed bare', async () => {
    const commit = vi.fn();
    await expect(dispatchExternallyOwnedWrite(deps(commit))).rejects.toThrow(/without outbox deps/);
    expect(commit).not.toHaveBeenCalled();
  });
});
