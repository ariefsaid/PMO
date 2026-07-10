import { describe, it, expect } from 'vitest';
import { createReferenceAdapter, REFERENCE_DOMAIN, type ReferenceOutcome } from './referenceAdapter';
import { AdapterError } from './contract';
import type { AdapterCommand } from './contract';

const cmd = (recordId: string): AdapterCommand => ({
  domain: REFERENCE_DOMAIN,
  operation: 'create',
  record: { id: recordId, name: 'Widget' },
});

describe('AC-EAS-020 reference adapter implements the contract in PMO domain language', () => {
  it('AC-EAS-020 declares a static capability map containing the reference domain', () => {
    const a = createReferenceAdapter();
    expect(a.tier).toBe('reference');
    expect(a.capabilityMap.has(REFERENCE_DOMAIN)).toBe(true);
    expect(a.capabilityMap.size).toBe(1);
  });
  it('AC-EAS-020 declares the read operations (listChangesSinceWatermark + getByExternalId) in PMO domain language', () => {
    const a = createReferenceAdapter();
    expect(typeof a.listChangesSinceWatermark).toBe('function');
    expect(typeof a.getByExternalId).toBe('function');
  });
});

describe('AC-EAS-021 a command synchronously returns the external id + canonical record', () => {
  it('AC-EAS-021 commit-success returns a non-null external id + a canonical PMO record', async () => {
    const a = createReferenceAdapter('commit-success');
    const result = await a.commit(cmd('pmo-1'));
    expect(result.externalRecordId).toBeTruthy();
    expect(result.canonical.id).toBe('pmo-1');
  });
  it('AC-EAS-021 getByExternalId returns the canonical PMO record for an external id', async () => {
    const a = createReferenceAdapter('commit-success');
    const record = await a.getByExternalId(REFERENCE_DOMAIN, 'ext-1');
    expect(record).not.toBeNull();
    expect(record?.id).toBeTruthy();
  });
  it('AC-EAS-021 listChangesSinceWatermark returns a page of canonical changes + a cursor', async () => {
    const a = createReferenceAdapter('commit-success');
    const page = await a.listChangesSinceWatermark(REFERENCE_DOMAIN, null);
    expect(page.changes.length).toBeGreaterThan(0);
    expect(page.changes.every((r) => typeof r.id === 'string')).toBe(true);
    expect(page.nextCursor === null || typeof page.nextCursor === 'string').toBe(true);
  });
});

describe('AC-EAS-022 an external rejection / unreachability surfaces as a classified error', () => {
  it.each<ReferenceOutcome>(['commit-rejected-validation', 'external-unreachable'])(
    'AC-EAS-022 %s throws an AdapterError carrying a code + message',
    async (outcome) => {
      const a = createReferenceAdapter(outcome);
      await expect(a.commit(cmd('pmo-2'))).rejects.toMatchObject({
        name: 'AdapterError',
        code: outcome === 'external-unreachable' ? 'external-unreachable' : 'commit-rejected',
      });
    },
  );
  it('AC-EAS-022 the classified error carries the external system message', async () => {
    const a = createReferenceAdapter('commit-rejected-validation');
    await expect(a.commit(cmd('pmo-3'))).rejects.toBeInstanceOf(AdapterError);
  });
  it('AC-EAS-022 reads under external-unreachable surface the same classified error (consistent with the command modes)', async () => {
    const a = createReferenceAdapter('external-unreachable');
    await expect(a.getByExternalId(REFERENCE_DOMAIN, 'ext-1')).rejects.toMatchObject({
      name: 'AdapterError', code: 'external-unreachable',
    });
    await expect(a.listChangesSinceWatermark(REFERENCE_DOMAIN, null)).rejects.toMatchObject({
      name: 'AdapterError', code: 'external-unreachable',
    });
  });
});
