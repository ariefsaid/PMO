import { describe, it, expect } from 'vitest';
import { deriveRailActiveOverride } from '../routeMatch';

/**
 * Unit test for the App-level derivation helper that maps (pathname, statusGroup)
 * → railActiveOverride value.
 *
 * Project records have one canonical navigation home across every lifecycle stage and load state.
 */
describe('deriveRailActiveOverride', () => {
  it.each(['pipeline', 'lost', 'onHand', 'internal', undefined] as const)(
    '%s project status still resolves to Projects',
    (statusGroup) => {
      expect(deriveRailActiveOverride('/projects/abc', statusGroup)).toBe('projects');
    },
  );

  it('a project deep-link with any tab keeps Projects as its navigation home', () => {
    expect(deriveRailActiveOverride('/projects/abc/budget', 'pipeline')).toBe('projects');
    expect(deriveRailActiveOverride('/projects/abc/tasks', 'lost')).toBe('projects');
  });

  it('non-project route → null even with a status group', () => {
    expect(deriveRailActiveOverride('/sales', 'pipeline')).toBeNull();
    expect(deriveRailActiveOverride('/procurement/x', 'onHand')).toBeNull();
    expect(deriveRailActiveOverride('/projects', 'onHand')).toBeNull(); // index, not detail
  });

});
