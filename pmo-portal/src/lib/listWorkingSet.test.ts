// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import {
  materializeSessionView,
  parseListWorkingSet,
  resolveListWorkingSet,
  serializeListWorkingSet,
  type ProcurementWorkingSet,
  type SalesWorkingSet,
  type ProjectsWorkingSet,
  type ContactsWorkingSet,
  type MeetingsWorkingSet,
} from './listWorkingSet';
import { ProcurementStatus } from '../../types';

describe('list working-set URL codec', () => {
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

  it('AC-LRC-002: uses the role default for Projects while preserving the Engineer’s My Projects meaning', () => {
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
    const procurement: ProcurementWorkingSet = parseListWorkingSet('procurement', procurementParams);
    expect(procurement.status).toBe('Vendor Invoiced');
    expect(serializeListWorkingSet('procurement', procurementParams, procurement).toString()).toBe(
      'status=Vendor+Invoiced&q=invoice&view=board',
    );

    expect(parseListWorkingSet('companies', '?type=Vendor').type).toBe('Vendor');
    expect(parseListWorkingSet('contacts', '?company=company-404').company).toBe('company-404');
    expect(parseListWorkingSet('meetings', '?project=project-404').project).toBe('project-404');
  });

  it('AC-LRC-002: every lifecycle status stays a reachable exact drill unless a segment is identical', () => {
    for (const status of Object.values(ProcurementStatus)) {
      const source = new URLSearchParams({ status, campaign: 'fall' });
      const parsed = parseListWorkingSet('procurement', source);
      expect(parsed.status, `${status} drill should remain the selected status`).toBe(status);

      // Vendor Invoiced / Paid parse as their semantically identical group segment (their plain
      // token, no group: prefix). Every other lifecycle status stays an exact drill.
      const exact = status !== 'Vendor Invoiced' && status !== 'Paid';
      expect(parsed.statusMode).toBe(exact ? 'exact' : 'group');

      const roundTrip = serializeListWorkingSet('procurement', source, parsed);
      expect(roundTrip.get('status')).toBe(status);
      expect(roundTrip.get('campaign')).toBe('fall');
    }
  });

  it('AC-LRC-002: separates exact dashboard Ordered from the broader Ordered group filter', () => {
    const exact = parseListWorkingSet('procurement', '?status=Ordered');
    expect(exact).toMatchObject({ status: 'Ordered', statusMode: 'exact' });

    const grouped: ProcurementWorkingSet = {
      status: 'Ordered',
      statusMode: 'group',
      q: '',
      view: 'table',
    };
    const query = serializeListWorkingSet('procurement', '?campaign=fall', grouped);
    expect(query.get('status')).toBe('group:Ordered');
    expect(query.get('campaign')).toBe('fall');
    expect(parseListWorkingSet('procurement', query)).toMatchObject({
      status: 'Ordered',
      statusMode: 'group',
    });
  });

  it('AC-LRC-002: group-mode round-trips for Ordered, Vendor Invoiced, and Paid stay their segment', () => {
    for (const status of ['Ordered', 'Vendor Invoiced', 'Paid'] as const) {
      const grouped: ProcurementWorkingSet = {
        status,
        statusMode: 'group',
        q: 'crane',
        view: 'board',
      };
      const query = serializeListWorkingSet('procurement', '?campaign=summer', grouped);
      // Only Ordered needs the group: prefix; Vendor Invoiced and Paid are plain tokens.
      expect(query.get('status')).toBe(status === 'Ordered' ? 'group:Ordered' : status);
      const roundTrip = parseListWorkingSet('procurement', query);
      expect(roundTrip).toMatchObject({ status, statusMode: 'group', q: 'crane', view: 'board' });
      expect(query.get('campaign')).toBe('summer');
    }
  });

  it('AC-LRC-002: rejects a bogus group token without discarding unrelated keys', () => {
    const query = new URLSearchParams('?status=group:bogus&campaign=fall');
    expect(parseListWorkingSet('procurement', query)).toMatchObject({
      status: 'All',
      statusMode: 'group',
    });
    expect(parseListWorkingSet('procurement', query).statusMode).toBe('group');
  });

  it('AC-LRC-001/002: rejects invalid Sales scope, stage, and view as appropriate defaults', () => {
    const sales: SalesWorkingSet = parseListWorkingSet(
      'sales',
      '?scope=bogus&status=Not+A+stage&view=crazy&q=review',
    );
    expect(sales).toEqual({ scope: 'Open', status: '', q: 'review', view: 'kanban' });
  });

  it('AC-LRC-001/002: round-trips Contacts and Meetings identifiers and search', () => {
    const contacts: ContactsWorkingSet = parseListWorkingSet(
      'contacts',
      '?company=harbor-co&q=ops',
    );
    expect(contacts).toEqual({ company: 'harbor-co', q: 'ops' });
    const contactsSerialized = serializeListWorkingSet(
      'contacts',
      '?campaign=winter',
      contacts,
    );
    expect(contactsSerialized.get('company')).toBe('harbor-co');
    expect(contactsSerialized.get('q')).toBe('ops');
    expect(contactsSerialized.get('campaign')).toBe('winter');

    const meetings: MeetingsWorkingSet = parseListWorkingSet(
      'meetings',
      '?project=refinery&q=review',
    );
    expect(meetings).toEqual({ project: 'refinery', q: 'review' });
    const meetingsSerialized = serializeListWorkingSet(
      'meetings',
      '?campaign=winter',
      meetings,
    );
    expect(meetingsSerialized.get('project')).toBe('refinery');
    expect(meetingsSerialized.get('q')).toBe('review');
    expect(meetingsSerialized.get('campaign')).toBe('winter');
  });

  it('AC-LRC-002: rejects control-character identifiers while retaining unrelated keys', () => {
    const seeded = new URLSearchParams(
      '?client=bad%00pm&pm=ok-pm&company=evil%01co&project=ok-proj&campaign=autumn',
    );
    const projects: ProjectsWorkingSet = parseListWorkingSet('projects', seeded);
    expect(projects.client).toBe('All');
    expect(projects.pm).toBe('ok-pm');
    expect(
      serializeListWorkingSet('projects', seeded, projects).get('campaign'),
    ).toBe('autumn');

    const contacts = parseListWorkingSet('contacts', '?company=evil%01co&q=search');
    expect(contacts.company).toBe('All');
    const meetings = parseListWorkingSet('meetings', '?project=bad%0Aproj');
    expect(meetings.project).toBe('All');
  });

  it('AC-LRC-001/002: keeps a Needs-attention scope with an open funnel stage and forces Open only for Lost', () => {
    const attention: SalesWorkingSet = parseListWorkingSet(
      'sales',
      '?scope=Needs+attention&status=Leads',
    );
    expect(attention).toMatchObject({ scope: 'Needs attention', status: 'Leads' });

    const lostWithStage: SalesWorkingSet = parseListWorkingSet('sales', '?scope=Lost&status=Leads');
    expect(lostWithStage).toMatchObject({ scope: 'Open', status: 'Leads' });

    const lostAlone: SalesWorkingSet = parseListWorkingSet('sales', '?scope=Lost');
    expect(lostAlone).toMatchObject({ scope: 'Lost', status: '' });

    // Round-trips: Needs attention + stage survives serialization.
    const roundTrip = parseListWorkingSet(
      'sales',
      serializeListWorkingSet('sales', '', attention),
    );
    expect(roundTrip).toMatchObject({ scope: 'Needs attention', status: 'Leads' });
  });

  it('AC-LRC-002: falls back from invalid enums without discarding valid referenced IDs or unrelated keys', () => {
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

  it('AC-LRC-002: uses a valid session view only as a fallback and materializes a nondefault effective view', () => {
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

  it('AC-LRC-002: a view enum rejects through the projects codec with the canonical serialization', () => {
    const source = new URLSearchParams('?view=map&campaign=winter');
    expect(parseListWorkingSet('projects', source).view).toBe('table');
    // The canonical URL drops the invalid view token (table is the omitted default) but
    // retains unrelated keys.
    const canonical = resolveListWorkingSet('projects', source);
    expect(canonical.search.get('view')).toBeNull();
    expect(canonical.search.get('campaign')).toBe('winter');
  });

  it('AC-LRC-001: omits default and empty values and never introduces a sort parameter', () => {
    const query = serializeListWorkingSet(
      'projects',
      '?campaign=spring&sort=legacy',
      {
        filter: 'All',
        client: 'All',
        pm: 'All',
        q: '',
        view: 'table',
      } satisfies ProjectsWorkingSet,
    );
    expect(query.toString()).toBe('campaign=spring&sort=legacy');
  });

  it('AC-LRC-001: writes view explicitly whenever it differs from the effective stored view', () => {
    const base = { filter: 'All', client: 'All', pm: 'All', q: '' } as const;
    // Default view over a nondefault session view must be explicit, or the fallback snaps back.
    expect(
      serializeListWorkingSet('projects', '', { ...base, view: 'table' }, { sessionView: 'calendar' })
        .get('view'),
    ).toBe('table');
    // A nondefault effective view is materialized even when it equals the stored view.
    expect(
      serializeListWorkingSet('projects', '', { ...base, view: 'calendar' }, { sessionView: 'calendar' })
        .get('view'),
    ).toBe('calendar');
    // Default over a default (or invalid) stored view stays omitted.
    expect(
      serializeListWorkingSet('projects', '', { ...base, view: 'table' }, { sessionView: 'bogus' })
        .get('view'),
    ).toBeNull();
    expect(
      serializeListWorkingSet(
        'sales',
        '',
        { scope: 'Open', status: '', q: '', view: 'kanban' },
        { sessionView: 'table' },
      ).get('view'),
    ).toBe('kanban');
    expect(
      serializeListWorkingSet(
        'procurement',
        '',
        { status: 'All', statusMode: 'group', q: '', view: 'table' },
        { sessionView: 'board' },
      ).get('view'),
    ).toBe('table');
  });

  it('AC-LRC-002: materializeSessionView adds only a missing nondefault view and leaves every other token as written', () => {
    expect(materializeSessionView('projects', '?filter=My+Projects', 'calendar')).toBe(
      '?filter=My+Projects&view=calendar',
    );
    // Nothing to write: the exact input string is returned (no re-encoding, no canonicalization).
    expect(materializeSessionView('projects', '?filter=All&q=a%20b', 'table')).toBe(
      '?filter=All&q=a%20b',
    );
    expect(materializeSessionView('projects', '?view=map', 'calendar')).toBe('?view=map');
    expect(materializeSessionView('projects', '', 'unknown')).toBe('');
    expect(materializeSessionView('sales', '?status=Leads', 'table')).toBe(
      '?status=Leads&view=table',
    );
    expect(materializeSessionView('procurement', '', 'board')).toBe('?view=board');
    expect(materializeSessionView('companies', '?type=Client', 'calendar')).toBe('?type=Client');
  });
});
