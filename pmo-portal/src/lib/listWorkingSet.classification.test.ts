import { describe, expect, it } from 'vitest';
import { parseListWorkingSet, serializeListWorkingSet } from './listWorkingSet';
describe('AC-TAG-002 classification working sets', () => {
  it.each(['projects', 'sales'] as const)('%s round-trips every classification and retains foreign keys', (list) => {
    const fields = { serviceLine: 'Engineering', sector: 'Energy', location: 'Jawa Barat', awardType: 'tender', biddingEntity: 'consortium' };
    const query = new URLSearchParams({ ...fields, foreign: 'keep' });
    const parsed = parseListWorkingSet(list, query);
    expect(parsed).toMatchObject(fields);
    expect(Object.fromEntries(serializeListWorkingSet(list, query, parsed))).toMatchObject({ ...fields, foreign: 'keep' });
  });
  it('retains retired Unicode labels and removes invalid fixed choices', () => {
    const parsed = parseListWorkingSet('projects', '?serviceLine=Réhabilitation&awardType=other&biddingEntity=other');
    expect(parsed.serviceLine).toBe('Réhabilitation');
    expect(parsed.awardType).toBeUndefined(); expect(parsed.biddingEntity).toBeUndefined();
  });
});
