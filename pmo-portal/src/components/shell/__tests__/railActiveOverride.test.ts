import { describe, it, expect } from 'vitest';
import { deriveRailActiveOverride } from '../routeMatch';

/**
 * Unit test for the App-level derivation helper that maps (pathname, statusGroup)
 * → railActiveOverride value.
 *
 * Rules:
 *  - /projects/:id + pipeline|lost  → 'salesPipeline'
 *  - /projects/:id + onHand|internal → 'projects'
 *  - /projects/:id + undefined (pending caches) → null
 *  - any other route → null
 */
describe('deriveRailActiveOverride', () => {
  it('pre-win pipeline status → salesPipeline', () => {
    expect(deriveRailActiveOverride('/projects/abc', 'pipeline')).toBe('salesPipeline');
  });

  it('lost status → salesPipeline', () => {
    expect(deriveRailActiveOverride('/projects/abc', 'lost')).toBe('salesPipeline');
  });

  it('onHand status → projects', () => {
    expect(deriveRailActiveOverride('/projects/abc', 'onHand')).toBe('projects');
  });

  it('internal status → projects', () => {
    expect(deriveRailActiveOverride('/projects/abc', 'internal')).toBe('projects');
  });

  it('undefined statusGroup (caches pending) → null', () => {
    expect(deriveRailActiveOverride('/projects/abc', undefined)).toBeNull();
  });

  it('non-project route → null even with a status group', () => {
    expect(deriveRailActiveOverride('/sales', 'pipeline')).toBeNull();
    expect(deriveRailActiveOverride('/procurement/x', 'onHand')).toBeNull();
    expect(deriveRailActiveOverride('/projects', 'onHand')).toBeNull(); // index, not detail
  });

  it('/projects/:id/:tab also resolves correctly (deep-link with tab)', () => {
    expect(deriveRailActiveOverride('/projects/abc/budget', 'pipeline')).toBe('salesPipeline');
    expect(deriveRailActiveOverride('/projects/abc/tasks', 'onHand')).toBe('projects');
  });
});
