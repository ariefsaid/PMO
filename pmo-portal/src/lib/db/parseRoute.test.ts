import { describe, expect, it } from 'vitest';
import { AppError } from '@/src/lib/appError';
import { parseRoute } from './parseRoute';

describe('approval route wire contract', () => {
  const kinds = ['named'] as const;
  const blankName = { id: 'person-1', name: '  ', role: 'Admin' };
  const named = { id: 'person-1', name: ' Role holder ', role: 'Admin' };
  const legacyId = { ...named, id: ' ' };
  const payload = (approvers: unknown[]) => ({ route_kind: 'named', approvers });
  const malformed = () => new AppError('Malformed route', 'route-malformed');

  it.each([
    { name: 'accepts a blank name for the role fallback', mode: 'trim-name', entries: [blankName], expected: [{ ...blankName, name: '' }] },
    { name: 'keeps name spacing on a strict named route', mode: 'nonblank', entries: [named], expected: [named] },
    { name: 'keeps nonempty equipment IDs and requires a known role', mode: 'nonempty-id', entries: [legacyId], expected: [legacyId] },
    { name: 'keeps string fields and drops malformed site-cash entries', mode: 'strings', entries: [null, blankName, named], expected: [blankName, named] },
    { name: 'drops malformed or duplicate operational entries in order', mode: 'unique-nonblank', entries: [null, blankName, named, { ...named, name: 'Duplicate' }], expected: [named] },
  ] as const)('$name', ({ mode, entries, expected }) => {
    expect(parseRoute(payload([...entries]), kinds, { mode, malformed, roles: ['Admin'] })?.approvers).toEqual(expected);
  });

  it('rejects blank names on routes that require a named person', () => {
    expect(() => parseRoute(payload([blankName]), kinds, { mode: 'nonblank', malformed })).toThrow(malformed());
  });

  it('rejects equipment roles outside the database enum', () => {
    expect(() => parseRoute(payload([{ ...named, role: 'Unknown' }]), kinds, {
      mode: 'nonempty-id', roles: ['Admin'], malformed,
    })).toThrow(malformed());
  });
});
