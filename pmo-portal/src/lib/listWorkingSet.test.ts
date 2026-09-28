// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import {
  LIST_VIEW_STORAGE_KEY,
  parseListWorkingSet,
  readListViewPreference,
  resolveListWorkingSet,
  serializeListWorkingSet,
  type ListName,
} from './listWorkingSet';

describe('list working-set URL codec', () => {
  afterEach(() => sessionStorage.clear());

  it('AC-LRC-001: supplies each list schema’s safe defaults', () => {
    expect(parseListWorkingSet('projects', '')).toEqual({
      filter: 'All',
      client: 'All',
      pm: 'All',
      q: '',
      view: 'table',
    });
    expect(parseListWorkingSet('sales', '')).toEqual({
      scope: 'Open',
      status: '',
      q: '',
      view: 'kanban',
    });
    expect(parseListWorkingSet('procurement', '')).toEqual({
      status: 'All',
      statusMode: 'group',
      q: '',
      view: 'table',
    });
    expect(parseListWorkingSet('companies', '')).toEqual({ type: 'All', q: '' });
    expect(parseListWorkingSet('contacts', '')).toEqual({ company: 'All', q: '' });
    expect(parseListWorkingSet('meetings', '')).toEqual({ project: 'All', q: '' });
  });

  it('uses the role default for Projects while preserving the Engineer’s My Projects meaning', () => {
    expect(
      parseListWorkingSet('projects', '', { projectsDefaultFilter: 'My Projects' }).filter,
    ).toBe('My Projects');
    expect(
      parseListWorkingSet('projects', '?filter=at-risk', { projectsDefaultFilter: 'My Projects' })
        .filter,
    ).toBe('at-risk');
  });

  it('AC-LRC-001/002: round-trips all enum choices and dashboard drill tokens', () => {
    const projectParams = new URLSearchParams(
      '?filter=at-risk&client=client-1&pm=pm-1&q=review&view=calendar',
    );
    const projects = parseListWorkingSet('projects', projectParams);
    expect(projects).toEqual({
      filter: 'at-risk',
      client: 'client-1',
      pm: 'pm-1',
      q: 'review',
      view: 'calendar',
    });
    expect(serializeListWorkingSet('projects', projectParams, projects).toString()).toBe(
      'filter=at-risk&client=client-1&pm=pm-1&q=review&view=calendar',
    );

    const procurementParams = new URLSearchParams('?status=Vendor+Invoiced&q=invoice&view=board');
    const procurement = parseListWorkingSet('procurement', procurementParams);
    expect(procurement.status).toBe('Vendor Invoiced');
    expect(serializeListWorkingSet('procurement', procurementParams, procurement).toString()).toBe(
      'status=Vendor+Invoiced&q=invoice&view=board',
    );

    expect(parseListWorkingSet('companies', '?type=Vendor').type).toBe('Vendor');
    expect(parseListWorkingSet('contacts', '?company=company-404').company).toBe('company-404');
    expect(parseListWorkingSet('meetings', '?project=project-404').project).toBe('project-404');

    const enumChoices: Array<{ list: ListName; key: string; values: string[] }> = [
      {
        list: 'projects',
        key: 'filter',
        values: ['All', 'My Projects', 'Ongoing', 'Completed', 'at-risk'],
      },
      { list: 'projects', key: 'view', values: ['table', 'cards', 'calendar', 'kanban'] },
      { list: 'sales', key: 'scope', values: ['Open', 'Lost', 'Needs attention'] },
      {
        list: 'sales',
        key: 'status',
        values: [
          '',
          'Leads',
          'PQ Submitted',
          'Quotation Submitted',
          'Tender Submitted',
          'Negotiation',
        ],
      },
      { list: 'sales', key: 'view', values: ['kanban', 'table'] },
      {
        list: 'procurement',
        key: 'status',
        values: ['All', 'Needs approval', 'Open', 'Ordered', 'Vendor Invoiced', 'Paid'],
      },
      { list: 'procurement', key: 'view', values: ['table', 'board'] },
      { list: 'companies', key: 'type', values: ['All', 'Internal', 'Client', 'Vendor'] },
    ];
    for (const { list, key, values } of enumChoices) {
      for (const value of values) {
        const source = new URLSearchParams();
        if (value !== '') source.set(key, value);
        const parsed = parseListWorkingSet(list, source);
        const parsedFields = parsed as unknown as Record<string, string>;
        expect(parsedFields[key], `${list}.${key} should accept ${JSON.stringify(value)}`).toBe(
          value,
        );
        const roundTrip = serializeListWorkingSet(list, source, parsed);
        expect(
          (parseListWorkingSet(list, roundTrip) as unknown as Record<string, string>)[key],
        ).toBe(value);
      }
    }
  });

  it('AC-LRC-002: preserves exact dashboard lifecycle statuses and unrelated query keys', () => {
    const dashboardStatuses = [
      'Draft',
      'Requested',
      'Approved',
      'Vendor Quoted',
      'Quote Selected',
      'Ordered',
      'Received',
      'Vendor Invoiced',
      'Paid',
      'Rejected',
      'Cancelled',
    ];

    for (const status of dashboardStatuses) {
      const source = new URLSearchParams({ status, campaign: 'fall' });
      const parsed = parseListWorkingSet('procurement', source);
      expect(parsed.status, `${status} drill should remain the exact selected status`).toBe(status);
      expect((parsed as unknown as { statusMode?: string }).statusMode).toBe('exact');

      const roundTrip = serializeListWorkingSet('procurement', source, parsed);
      expect(roundTrip.get('status')).toBe(status);
      expect(roundTrip.get('campaign')).toBe('fall');
    }
  });

  it('AC-LRC-002: separates exact dashboard Ordered from the broader Ordered group filter', () => {
    const exact = parseListWorkingSet('procurement', '?status=Ordered');
    expect(exact).toMatchObject({ status: 'Ordered', statusMode: 'exact' });

    const grouped = {
      ...parseListWorkingSet('procurement', ''),
      status: 'Ordered' as const,
      statusMode: 'group' as const,
    };
    const query = serializeListWorkingSet('procurement', '?campaign=fall', grouped);
    expect(query.get('status')).toBe('group:Ordered');
    expect(query.get('campaign')).toBe('fall');
    expect(parseListWorkingSet('procurement', query)).toMatchObject({
      status: 'Ordered',
      statusMode: 'group',
    });
  });

  it('falls back from invalid enums without discarding valid referenced IDs or unrelated keys', () => {
    const params = new URLSearchParams(
      '?filter=bogus&client=company-404&pm=not-a-user&view=map&q=%E2%9C%93&campaign=autumn',
    );
    expect(parseListWorkingSet('projects', params)).toEqual({
      filter: 'All',
      client: 'company-404',
      pm: 'not-a-user',
      q: '✓',
      view: 'table',
    });
    expect(
      serializeListWorkingSet(
        'projects',
        params,
        parseListWorkingSet('projects', params),
      ).toString(),
    ).toBe('client=company-404&pm=not-a-user&q=%E2%9C%93&campaign=autumn');
  });

  it('AC-LRC-001: round-trips Unicode search and preserves unrelated query keys', () => {
    const current = new URLSearchParams('?q=Caf%C3%A9+東京&campaign=spring&source=dashboard');
    const state = { type: 'Client' as const, q: 'Café 東京' };
    const result = serializeListWorkingSet('companies', current, state);
    expect(result.get('q')).toBe('Café 東京');
    expect(result.get('type')).toBe('Client');
    expect(result.get('campaign')).toBe('spring');
    expect(result.get('source')).toBe('dashboard');
  });

  it('keeps Sales stage drill links in Open scope when Lost conflicts with an open stage', () => {
    expect(parseListWorkingSet('sales', '?scope=Lost&status=Leads')).toMatchObject({
      scope: 'Open',
      status: 'Leads',
    });
    expect(parseListWorkingSet('sales', '?scope=Lost')).toMatchObject({
      scope: 'Lost',
      status: '',
    });
  });

  it('uses a valid session view only as a fallback and materializes a nondefault effective view', () => {
    const stored = new URLSearchParams('?campaign=fall');
    const resolved = resolveListWorkingSet('projects', stored, { sessionView: 'calendar' });
    expect(resolved.value.view).toBe('calendar');
    expect(resolved.search.get('view')).toBe('calendar');
    expect(resolved.search.get('campaign')).toBe('fall');

    expect(
      resolveListWorkingSet('projects', '?view=kanban', { sessionView: 'calendar' }).value.view,
    ).toBe('kanban');
    expect(resolveListWorkingSet('projects', '', { sessionView: 'unknown' }).value.view).toBe(
      'table',
    );
  });

  it('reads only the matching session-stored view preference and ignores corrupt storage', () => {
    sessionStorage.setItem(
      LIST_VIEW_STORAGE_KEY,
      JSON.stringify({ project: 'calendar', pipeline: 'table', procurement: 'board' }),
    );
    expect(readListViewPreference('projects')).toBe('calendar');
    expect(readListViewPreference('sales')).toBe('table');
    expect(readListViewPreference('procurement')).toBe('board');
    sessionStorage.setItem(LIST_VIEW_STORAGE_KEY, '{');
    expect(readListViewPreference('projects')).toBeUndefined();
  });

  it('omits default and empty values and never introduces a sort parameter', () => {
    const query = serializeListWorkingSet('projects', '?campaign=spring&sort=legacy', {
      filter: 'All',
      client: 'All',
      pm: 'All',
      q: '',
      view: 'table',
    });
    expect(query.toString()).toBe('campaign=spring&sort=legacy');
  });
});
