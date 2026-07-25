import { describe, it, expect, vi } from 'vitest';
import { dispatchExternallyOwnedWrite, toDispatchError } from './dispatch.ts';
import { createReferenceAdapter, REFERENCE_DOMAIN } from './referenceAdapter.ts';
import type { AdapterCommand } from './contract.ts';
import { AppError } from '../appError.ts';
import { executeWrite } from './router.ts';

const command: AdapterCommand = {
  domain: REFERENCE_DOMAIN,
  operation: 'create',
  record: { id: 'pmo-1', name: 'Widget' },
};

describe('AC-EAS-023 the adapter never receives org_id', () => {
  it('AC-EAS-023 the command passed to adapter.commit carries no org_id field', async () => {
    const adapter = createReferenceAdapter('commit-success');
    const seen: AdapterCommand[] = [];
    const wrappingAdapter = {
      tier: adapter.tier,
      capabilityMap: adapter.capabilityMap,
      async commit(c: AdapterCommand) {
        seen.push(c);
        return adapter.commit(c);
      },
    };
    await dispatchExternallyOwnedWrite({
      adapter: wrappingAdapter, command,
      writeReadModel: vi.fn(), recordExternalRef: vi.fn(),
    });
    expect(seen).toHaveLength(1);
    expect(seen[0]).not.toHaveProperty('org_id');
  });
});

describe('AC-EAS-033 synchronous write-through order: command → read-model → external_refs → return', () => {
  it('AC-EAS-033 commits in order and returns only after the external commit', async () => {
    const order: string[] = [];
    const adapter = {
      tier: 'reference',
      capabilityMap: new Set([REFERENCE_DOMAIN]),
      async commit() {
        order.push('commit');
        return { externalRecordId: 'ext-1', canonical: { id: 'pmo-1' } };
      },
    };
    await dispatchExternallyOwnedWrite({
      adapter, command,
      writeReadModel: vi.fn(async () => { order.push('readModel'); }),
      recordExternalRef: vi.fn(async () => { order.push('ref'); }),
    });
    expect(order).toEqual(['commit', 'readModel', 'ref']);
  });
});

describe('AC-EAS-034 external-unreachable ⇒ write fails honestly, read-model unchanged, PMO-owned domains unaffected', () => {
  it('AC-EAS-034 leaves the prior read-model state intact, a subsequent read returns that prior state, and a PMO-owned executeWrite still succeeds', async () => {
    const readModel = new Map<string, { id: string; name?: string; [k: string]: unknown }>([
      [command.record.id, { id: 'pmo-1', name: 'Before outage' }],
    ]);
    const readCurrent = () => readModel.get(command.record.id);
    const writeReadModel = vi.fn(async (canonical: { id: string; [k: string]: unknown }) => {
      readModel.set(canonical.id, canonical);
    });
    const recordExternalRef = vi.fn();

    await expect(
      dispatchExternallyOwnedWrite({
        adapter: createReferenceAdapter('external-unreachable'),
        command,
        writeReadModel,
        recordExternalRef,
      }),
    ).rejects.toMatchObject({
      name: 'AppError',
      code: 'external-unreachable',
      message: 'external system unreachable — try again',
    });

    expect(writeReadModel).not.toHaveBeenCalled();
    expect(recordExternalRef).not.toHaveBeenCalled();
    expect(readCurrent()).toEqual({ id: 'pmo-1', name: 'Before outage' });

    const directWrite = vi.fn(async (payload: string) => `direct:${payload}`);
    await expect(
      executeWrite({
        domain: 'tasks',
        ownershipMap: { reference: 'reference' },
        payload: 'still-works',
        directWrite,
        dispatchWrite: vi.fn(async () => 'dispatch-should-not-run'),
      }),
    ).resolves.toBe('direct:still-works');
    expect(directWrite).toHaveBeenCalledTimes(1);
  });

  it('AC-EAS-034 commit-rejected surfaces a commit-rejected AppError without writing', async () => {
    const writeReadModel = vi.fn();
    await expect(
      dispatchExternallyOwnedWrite({
        adapter: createReferenceAdapter('commit-rejected-validation'), command,
        writeReadModel, recordExternalRef: vi.fn(),
      }),
    ).rejects.toBeInstanceOf(AppError);
    expect(writeReadModel).not.toHaveBeenCalled();
  });

  it('a coded plain Error keeps its .code through the seam (never degraded to a bare 500)', async () => {
    // ⚑ The seam classifies a thrown value into an AppError. Its `Error` branch used to drop `.code`
    // entirely, so any error class that is NOT AppError/AdapterError — e.g. P3c's
    // `BudgetCategoryUnmappedError`, a plain `Error` subclass carrying
    // `code = 'budget-category-unmapped'` — arrived at the edge fn code-less and fell through the
    // status mapping to a bare 500. That turns a precise, NON-RETRYABLE, operator-actionable refusal
    // ("these budget categories have no ERP account") into an opaque server error a client may retry
    // forever. `appError.ts` already preserves a structural string `.code`; the seam must too.
    class CodedError extends Error {
      readonly code = 'budget-category-unmapped';
    }
    const throwingAdapter = {
      tier: createReferenceAdapter('commit-success').tier,
      capabilityMap: createReferenceAdapter('commit-success').capabilityMap,
      commit: async () => {
        throw new CodedError('budget categories have no ERP account mapping: Labour');
      },
    };
    await expect(
      dispatchExternallyOwnedWrite({
        adapter: throwingAdapter, command,
        writeReadModel: vi.fn(), recordExternalRef: vi.fn(),
      }),
    ).rejects.toMatchObject({ code: 'budget-category-unmapped' });
  });
});

describe('AC-EAS-042 a successful write-through records the external_refs mapping', () => {
  it('AC-EAS-042 recordExternalRef is called with pmo id ↔ external id + owning tier + domain', async () => {
    const recordExternalRef = vi.fn(async () => {});
    await dispatchExternallyOwnedWrite({
      adapter: createReferenceAdapter('commit-success'), command,
      writeReadModel: vi.fn(), recordExternalRef,
    });
    expect(recordExternalRef).toHaveBeenCalledWith({
      pmoRecordId: 'pmo-1',
      externalTier: 'reference',
      externalRecordId: 'ext-pmo-1',
      domain: REFERENCE_DOMAIN,
    });
  });
});

describe('AC-CUA-038 delete-aware dispatch: tombstone the read-model, keep the external_refs mapping', () => {
  const deleteCommand: AdapterCommand = {
    domain: REFERENCE_DOMAIN,
    operation: 'delete',
    record: { id: 'pmo-1' },
  };

  it('AC-CUA-038 a successful delete commit calls tombstoneReadModel(pmoRecordId), never writeReadModel, and keeps the mapping', async () => {
    const adapter = {
      tier: 'reference',
      capabilityMap: new Set([REFERENCE_DOMAIN]),
      async commit() {
        return { externalRecordId: 'ext-pmo-1', canonical: { id: 'pmo-1' } };
      },
    };
    const writeReadModel = vi.fn();
    const recordExternalRef = vi.fn();
    const tombstoneReadModel = vi.fn(async () => {});

    const result = await dispatchExternallyOwnedWrite({
      adapter,
      command: deleteCommand,
      writeReadModel,
      recordExternalRef,
      tombstoneReadModel,
    });

    expect(tombstoneReadModel).toHaveBeenCalledWith('pmo-1');
    expect(writeReadModel).not.toHaveBeenCalled();
    // the mapping is kept as-is — delete never re-records or removes external_refs.
    expect(recordExternalRef).not.toHaveBeenCalled();
    expect(result).toEqual({ externalRecordId: 'ext-pmo-1', canonical: { id: 'pmo-1' } });
  });

  it('AC-CUA-038 create/update/transition keep the P0 upsert+record order (delete-aware path does not affect them)', async () => {
    const order: string[] = [];
    const adapter = {
      tier: 'reference',
      capabilityMap: new Set([REFERENCE_DOMAIN]),
      async commit() {
        order.push('commit');
        return { externalRecordId: 'ext-1', canonical: { id: 'pmo-1' } };
      },
    };
    await dispatchExternallyOwnedWrite({
      adapter,
      command, // operation: 'create' (the file-level fixture)
      writeReadModel: vi.fn(async () => { order.push('readModel'); }),
      recordExternalRef: vi.fn(async () => { order.push('ref'); }),
      tombstoneReadModel: vi.fn(async () => { order.push('tombstone'); }),
    });
    expect(order).toEqual(['commit', 'readModel', 'ref']);
  });
});

/**
 * ⚑ LOW-1 (audit round 5) — ONE classification of a thrown value for BOTH served-fn exits.
 *
 * `adapter-dispatch`'s ADAPTER-SELECT catch built `new AppError(err.message)` by hand, with no `.code`.
 * That was harmless while adapter select only threw `AppError`s — but `resolveBudgetRefs` now runs the
 * real `resolveBudgetAccounts` pre-flight INSIDE adapter select (AC-BUD-011's zero-ERP-calls contract),
 * and that throws `BudgetCategoryUnmappedError`: a plain `Error` SUBCLASS carrying
 * `code = 'budget-category-unmapped'`. Hand-rolling the conversion dropped the code, so the operator got
 * a bare 400 / `ADAPTER_SELECT_FAILED` instead of the 422 naming the unmapped categories — the same
 * class of bug already fixed once in the dispatch exit. Exported so the served fn uses the ONE rule.
 */
describe('toDispatchError (LOW-1 — the shared thrown-value classification)', () => {
  class BudgetCategoryUnmappedErrorFake extends Error {
    readonly code = 'budget-category-unmapped';
    constructor(readonly unmappedCategories: string[]) {
      super(`budget categories have no ERP account mapping: ${unmappedCategories.join(', ')}`);
      this.name = 'BudgetCategoryUnmappedError';
    }
  }

  it('LOW-1 preserves the `.code` of a plain-Error SUBCLASS (BudgetCategoryUnmappedError) — never a bare, code-less AppError', () => {
    const classified = toDispatchError(new BudgetCategoryUnmappedErrorFake(['Travel', 'Software']));
    expect(classified).toBeInstanceOf(AppError);
    expect(classified.code).toBe('budget-category-unmapped');
    expect(classified.message).toContain('Travel');
    expect(classified.message).toContain('Software');
  });

  it('LOW-1 passes an AppError through unchanged and leaves an unclassified throw code-less', () => {
    const appErr = new AppError('binding is not activated', 'config-rejected');
    expect(toDispatchError(appErr)).toBe(appErr);
    expect(toDispatchError(new Error('boom')).code).toBeUndefined();
    expect(toDispatchError('boom')).toBeInstanceOf(AppError);
  });
});
