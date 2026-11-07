import { describe, expect, it } from 'vitest';
import { parseListWorkingSet, serializeListWorkingSet } from '@/src/lib/listWorkingSet';
import { UNASSIGNED_PROJECT_MANAGER } from '@/src/lib/projects/projectManagerLabel';
import {
  activeBuilderCount, matchesProjectBuilder, queryToPatch, workingSetToQuery,
} from './projectFilterQuery';

const parse = (search: string) => parseListWorkingSet('projects', search);

describe('Projects filter builder URL keys (#1983)', () => {
  it('round-trips status, date and amount ranges through the URL', () => {
    const ws = parse('?status=Ongoing+Project,On+Hold&startFrom=2026-01-01&startTo=2026-03-31&endFrom=2026-06-01&valueMin=1000&valueMax=5000.5');
    expect(ws.statuses).toEqual(['Ongoing Project', 'On Hold']);
    expect([ws.startFrom, ws.startTo, ws.endFrom, ws.endTo, ws.valueMin, ws.valueMax])
      .toEqual(['2026-01-01', '2026-03-31', '2026-06-01', undefined, '1000', '5000.5']);
    const again = parse(`?${serializeListWorkingSet('projects', '', ws, {}).toString()}`);
    expect(again).toEqual(ws);
  });

  it('drops hand-edited garbage instead of filtering on it', () => {
    const ws = parse('?status=Nope&startFrom=2026-13-40&valueMin=abc');
    expect(ws.statuses).toBeUndefined();
    expect(ws.startFrom).toBeUndefined();
    expect(ws.valueMin).toBeUndefined();
  });

  it('turns a working set into one rule per field and back', () => {
    const ws = parse('?status=On+Hold&pm=' + UNASSIGNED_PROJECT_MANAGER + '&startFrom=2026-01-01&valueMax=900&location=Bali');
    const query = workingSetToQuery(ws, true);
    expect(query.rules.map((r) => r.type === 'rule' && [r.path[0], r.operator])).toEqual([
      ['status', 'is_any_of'], ['pm', 'is'], ['location', 'contains'], ['startDate', 'is_on_or_after'], ['contractValue', 'lte'],
    ]);
    expect(queryToPatch(query)).toMatchObject({
      statuses: ['On Hold'], pm: UNASSIGNED_PROJECT_MANAGER, location: 'Bali', startFrom: '2026-01-01', valueMax: '900',
      client: 'All', valueMin: undefined, startTo: undefined,
    });
  });

  it('a removed rule clears its key', () => {
    const query = workingSetToQuery(parse('?status=On+Hold&valueMin=5'), true);
    const without = { ...query, rules: query.rules.filter((r) => r.type === 'rule' && r.path[0] !== 'status') };
    expect(queryToPatch(without).statuses).toBeUndefined();
    expect(queryToPatch(without).valueMin).toBe('5');
  });

  it('keeps the contract-value rule away from a viewer who cannot see money', () => {
    const ws = parse('?valueMin=1000');
    expect(workingSetToQuery(ws, false).rules).toHaveLength(0);
    expect(activeBuilderCount(ws, false)).toBe(0);
    expect(matchesProjectBuilder({ contract_value: 10 }, ws, false)).toBe(true);
    expect(matchesProjectBuilder({ contract_value: 10 }, ws, true)).toBe(false);
  });
});

describe('matchesProjectBuilder', () => {
  const base = { status: 'Ongoing Project', start_date: '2026-02-01', end_date: '2026-09-30', contract_value: 2500, project_manager_id: 'pm-1', client_id: 'c-1' };
  it.each([
    ['status in list', '?status=Ongoing+Project', true],
    ['status not in list', '?status=On+Hold', false],
    ['start inside range', '?startFrom=2026-01-01&startTo=2026-03-01', true],
    ['start before range', '?startFrom=2026-03-01', false],
    ['end bound is inclusive', '?endTo=2026-09-30', true],
    ['amount below min', '?valueMin=3000', false],
    ['amount in range', '?valueMin=2000&valueMax=3000', true],
    ['customer mismatch', '?client=00000000-0000-4000-8000-000000000001', false],
  ])('%s', (_name, search, expected) => {
    expect(matchesProjectBuilder(base, parse(search), true)).toBe(expected);
  });

  it('a set date bound excludes a project with no date, an unset one does not', () => {
    expect(matchesProjectBuilder({ ...base, start_date: null }, parse('?startFrom=2026-01-01'), true)).toBe(false);
    expect(matchesProjectBuilder({ ...base, start_date: null }, parse(''), true)).toBe(true);
  });

  it('Unassigned matches only a project with no manager', () => {
    const ws = parse('?pm=' + UNASSIGNED_PROJECT_MANAGER);
    expect(matchesProjectBuilder({ ...base, project_manager_id: null }, ws, true)).toBe(true);
    expect(matchesProjectBuilder(base, ws, true)).toBe(false);
  });
});
