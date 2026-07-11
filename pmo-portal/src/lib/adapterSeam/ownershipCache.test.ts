import { describe, it, expect, beforeEach } from 'vitest';
import { setTaskOwnership, clearOwnershipCache, routeTaskWrite } from './ownershipCache.ts';

/**
 * ADR-0056 — the FE routing cache (fail-closed to 'pmo'). Session lifetime, own-org only.
 */
describe('ADR-0056 ownershipCache — fail-closed task-write routing', () => {
  beforeEach(() => clearOwnershipCache());

  it('a never-loaded (null) cache routes to pmo (cold start)', () => {
    expect(routeTaskWrite()).toBe('pmo');
  });

  it('a loaded cache that does NOT assert tasks routes to pmo (loaded-but-absent)', () => {
    setTaskOwnership([{ domain: 'reference', externalTier: 'reference' }]);
    expect(routeTaskWrite()).toBe('pmo');
  });

  it('a loaded cache asserting tasks→clickup routes to external', () => {
    setTaskOwnership([{ domain: 'tasks', externalTier: 'clickup' }]);
    expect(routeTaskWrite()).toBe('external');
  });

  it('an empty rows array loads a present-but-empty map — still pmo', () => {
    setTaskOwnership([]);
    expect(routeTaskWrite()).toBe('pmo');
  });

  it('clearOwnershipCache resets a loaded cache back to fail-closed pmo', () => {
    setTaskOwnership([{ domain: 'tasks', externalTier: 'clickup' }]);
    expect(routeTaskWrite()).toBe('external');
    clearOwnershipCache();
    expect(routeTaskWrite()).toBe('pmo');
  });
});
