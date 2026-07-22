import { describe, it, expect, beforeEach } from 'vitest';
import {
  setTaskOwnership,
  setDomainOwnership,
  clearOwnershipCache,
  routeTaskWrite,
  routeDomainWrite,
  setProjectBindings,
} from './ownershipCache.ts';

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

  it('a loaded cache asserting tasks→clickup still requires a bound project', () => {
    setTaskOwnership([{ domain: 'tasks', externalTier: 'clickup' }]);
    expect(routeTaskWrite('project-bound')).toBe('pmo');
  });

  it('an empty rows array loads a present-but-empty map — still pmo', () => {
    setTaskOwnership([]);
    expect(routeTaskWrite()).toBe('pmo');
  });

  it('AC-CUA-105 bound and unbound projects in one org route independently', () => {
    setTaskOwnership([{ domain: 'tasks', externalTier: 'clickup' }]);
    setProjectBindings([{ projectId: 'project-bound', externalTier: 'clickup' }]);
    expect(routeTaskWrite('project-bound')).toBe('external');
    expect(routeTaskWrite('project-unbound')).toBe('pmo');
  });

  it('AC-CUA-105 a cold or unknown project fails closed, even with org ownership', () => {
    setTaskOwnership([{ domain: 'tasks', externalTier: 'clickup' }]);
    expect(routeTaskWrite('project-bound')).toBe('pmo');
    setProjectBindings([{ projectId: 'project-bound', externalTier: 'clickup' }]);
    clearOwnershipCache();
    expect(routeTaskWrite('project-bound')).toBe('pmo');
    expect(routeTaskWrite()).toBe('pmo');
  });

  it('AC-CUA-105 ignores an org ownership row for an unbound project', () => {
    setTaskOwnership([{ domain: 'tasks', externalTier: 'clickup' }]);
    setProjectBindings([{ projectId: 'another-project', externalTier: 'clickup' }]);
    expect(routeTaskWrite('project-unbound')).toBe('pmo');
  });
});

/**
 * FR-ENA-005 — the P2 generalization: any domain (not just `tasks`) routes off the SAME domain-keyed
 * cache. A cold/absent map fails closed to 'pmo' for every domain (AC-ENA-001's foundation).
 */
describe('ADR-0056/FR-ENA-005 routeDomainWrite — generalized per-domain routing, still fail-closed', () => {
  beforeEach(() => clearOwnershipCache());

  it('a never-loaded (null) cache routes procurement/companies to pmo (cold start, fail-closed)', () => {
    expect(routeDomainWrite('procurement')).toBe('pmo');
    expect(routeDomainWrite('companies')).toBe('pmo');
  });

  it('a loaded cache that does NOT assert procurement routes it to pmo (loaded-but-absent)', () => {
    setDomainOwnership([{ domain: 'tasks', externalTier: 'clickup' }]);
    expect(routeDomainWrite('procurement')).toBe('pmo');
  });

  it('a loaded cache asserting procurement→erpnext routes it to external', () => {
    setDomainOwnership([{ domain: 'procurement', externalTier: 'erpnext' }]);
    expect(routeDomainWrite('procurement')).toBe('external');
  });

  it('a loaded cache asserting companies→erpnext routes it to external', () => {
    setDomainOwnership([{ domain: 'companies', externalTier: 'erpnext' }]);
    expect(routeDomainWrite('companies')).toBe('external');
  });

  it('one seed covers every domain it asserts — no extra load needed (the map is domain-keyed)', () => {
    setDomainOwnership([
      { domain: 'tasks', externalTier: 'clickup' },
      { domain: 'procurement', externalTier: 'erpnext' },
    ]);
    setProjectBindings([{ projectId: 'project-1', externalTier: 'clickup' }]);
    expect(routeDomainWrite('tasks')).toBe('external');
    expect(routeDomainWrite('procurement')).toBe('external');
    expect(routeDomainWrite('companies')).toBe('pmo');
    // Task routing is project-aware; an unknown project remains fail-closed.
    expect(routeTaskWrite()).toBe('pmo');
  });

  it('setTaskOwnership (the P1 name) is the same seed as setDomainOwnership (alias, identical body)', () => {
    setTaskOwnership([{ domain: 'procurement', externalTier: 'erpnext' }]);
    expect(routeDomainWrite('procurement')).toBe('external');
  });
});
