import { describe, it, expect } from 'vitest';
import { parseListWorkingSet, serializeListWorkingSet } from './listWorkingSet';

const END_ID = '75800000-0000-0000-0000-0000000000e1';

describe('ProjectsWorkingSet — end-customer filter (issue #758, AC-EC-003)', () => {
  it('AC-EC-003: parses a valid endClient UUID, lowercased', () => {
    const ws = parseListWorkingSet('projects', `?endClient=${END_ID}`);
    expect(ws.endClient).toBe(END_ID.toLowerCase());
  });

  it('AC-EC-003: normalizes an invalid endClient token to All', () => {
    for (const bad of ['not-a-uuid', '../x', `${END_ID}x`, 'All ']) {
      expect(parseListWorkingSet('projects', `?endClient=${encodeURIComponent(bad)}`).endClient).toBe('All');
    }
  });

  it('AC-EC-003: serializes endClient as endClient=<id> while retaining unrelated params', () => {
    const serialized = serializeListWorkingSet(
      'projects',
      '?campaign=spring',
      {
        filter: 'All',
        client: 'All',
        endClient: END_ID,
        pm: 'All',
        q: '',
        view: 'table',
      },
    ).toString();
    expect(serialized).toContain(`endClient=${END_ID}`);
    expect(serialized).toContain('campaign=spring');
  });

  it('AC-EC-003: omits endClient (default All) from the URL', () => {
    const serialized = serializeListWorkingSet(
      'projects',
      '',
      { filter: 'All', client: 'All', endClient: 'All', pm: 'All', q: '', view: 'table' },
    ).toString();
    expect(serialized).not.toContain('endClient');
  });

  it('AC-EC-003: clearing endClient serializes the default away', () => {
    const ws = parseListWorkingSet('projects', `?endClient=${END_ID}`);
    const cleared = { ...ws, endClient: 'All' as const };
    expect(serializeListWorkingSet('projects', `?endClient=${END_ID}`, cleared).get('endClient')).toBeNull();
  });
});