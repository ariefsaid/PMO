// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import {
  materializeSessionView,
  parseListWorkingSet,
  serializeListWorkingSet,
  type ProcurementWorkingSet,
  type SalesWorkingSet,
  type ProjectsWorkingSet,
  type ContactsWorkingSet,
  type MeetingsWorkingSet,
} from './listWorkingSet';
import { ProcurementStatus } from '../../types';
import { DEFAULT_PROJECT_VIEW, PROJECT_VIEWS } from '../hooks/useProjectView';
import { DEFAULT_PIPELINE_VIEW, PIPELINE_VIEWS } from '../hooks/usePipelineView';
import { DEFAULT_PROCUREMENT_VIEW, PROCUREMENT_VIEWS } from '../hooks/useProcurementView';
import { UNASSIGNED_PROJECT_MANAGER } from './projects/projectManagerLabel';

// Referenced filter values are stable row IDs (UUIDs), shaped like real ones.
const CLIENT_ID = '3f2b8c1e-5a6d-4e7f-9a0b-1c2d3e4f5a6b';
const PM_ID = '7c9d0e1f-2a3b-4c5d-8e6f-7a8b9c0d1e2f';
const COMPANY_ID = '0a1b2c3d-4e5f-4a6b-9c7d-8e9f0a1b2c3d';
const PROJECT_ID = 'b1c2d3e4-f5a6-4b7c-8d9e-0f1a2b3c4d5e';

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

  it('AC-LRC-001 (#683 carry-over): an explicit default-valued filter survives an unrelated edit', () => {
    // An Engineer's `?filter=My+Projects` equals the role default, so a search write must NOT
    // drop it (that would silently widen the list back to All). An absent default stays omitted.
    expect(
      String(
        serializeListWorkingSet(
          'projects',
          '?filter=My+Projects',
          parseListWorkingSet('projects', '?filter=My+Projects', {
            projectsDefaultFilter: 'My Projects',
          }),
          { projectsDefaultFilter: 'My Projects' },
        ),
      ),
    ).toBe('filter=My+Projects');
    // The same default derived from no URL key is omitted (clean URL).
    expect(
      String(
        serializeListWorkingSet(
          'projects',
          '',
          parseListWorkingSet('projects', '', { projectsDefaultFilter: 'My Projects' }),
          { projectsDefaultFilter: 'My Projects' },
        ),
      ),
    ).toBe('');
  });

  it('AC-LRC-001/002: round-trips all enum choices and dashboard drill tokens', () => {
    const projectParams = new URLSearchParams(
      `?filter=at-risk&client=${CLIENT_ID}&pm=${PM_ID}&q=review&view=calendar`,
    );
    const projects = parseListWorkingSet('projects', projectParams);
    expect(projects).toEqual({
      filter: 'at-risk',
      client: CLIENT_ID,
      pm: PM_ID,
      q: 'review',
      view: 'calendar',
    });
    expect(serializeListWorkingSet('projects', projectParams, projects).toString()).toBe(
      `filter=at-risk&client=${CLIENT_ID}&pm=${PM_ID}&q=review&view=calendar`,
    );

    const procurementParams = new URLSearchParams('?status=Vendor+Invoiced&q=invoice&view=board');
    const procurement: ProcurementWorkingSet = parseListWorkingSet('procurement', procurementParams);
    expect(procurement.status).toBe('Vendor Invoiced');
    expect(serializeListWorkingSet('procurement', procurementParams, procurement).toString()).toBe(
      'status=Vendor+Invoiced&q=invoice&view=board',
    );

    expect(parseListWorkingSet('companies', '?type=Vendor').type).toBe('Vendor');
    expect(parseListWorkingSet('contacts', `?company=${COMPANY_ID}`).company).toBe(COMPANY_ID);
    expect(parseListWorkingSet('meetings', `?project=${PROJECT_ID}`).project).toBe(PROJECT_ID);
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
      `?company=${COMPANY_ID}&q=ops`,
    );
    expect(contacts).toEqual({ company: COMPANY_ID, q: 'ops' });
    const contactsSerialized = serializeListWorkingSet(
      'contacts',
      '?campaign=winter',
      contacts,
    );
    expect(contactsSerialized.get('company')).toBe(COMPANY_ID);
    expect(contactsSerialized.get('q')).toBe('ops');
    expect(contactsSerialized.get('campaign')).toBe('winter');

    const meetings: MeetingsWorkingSet = parseListWorkingSet(
      'meetings',
      `?project=${PROJECT_ID}&q=review`,
    );
    expect(meetings).toEqual({ project: PROJECT_ID, q: 'review' });
    const meetingsSerialized = serializeListWorkingSet(
      'meetings',
      '?campaign=winter',
      meetings,
    );
    expect(meetingsSerialized.get('project')).toBe(PROJECT_ID);
    expect(meetingsSerialized.get('q')).toBe('review');
    expect(meetingsSerialized.get('campaign')).toBe('winter');
  });

  it('AC-LRC-002: rejects control-character identifiers while retaining unrelated keys', () => {
    const seeded = new URLSearchParams(
      `?client=${CLIENT_ID}%00&pm=${PM_ID}&company=evil%01co&project=ok-proj&campaign=autumn`,
    );
    const projects: ProjectsWorkingSet = parseListWorkingSet('projects', seeded);
    expect(projects.client).toBe('All');
    expect(projects.pm).toBe(PM_ID);
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

    // Serializing a contradictory Lost + open stage omits scope (Open is the default), so the URL
    // and the controls both read Open + Leads.
    const lostQuery = serializeListWorkingSet('sales', '?campaign=fall', {
      scope: 'Lost',
      status: 'Leads',
      q: '',
      view: 'kanban',
    });
    expect(lostQuery.toString()).toBe('campaign=fall&status=Leads');
    expect(parseListWorkingSet('sales', lostQuery)).toMatchObject({ scope: 'Open', status: 'Leads' });
    // Lost without a stage is not contradictory and is written as-is.
    expect(
      serializeListWorkingSet('sales', '', { scope: 'Lost', status: '', q: '', view: 'kanban' })
        .toString(),
    ).toBe('scope=Lost');

    // Round-trips: Needs attention + stage survives serialization.
    const roundTrip = parseListWorkingSet(
      'sales',
      serializeListWorkingSet('sales', '', attention),
    );
    expect(roundTrip).toMatchObject({ scope: 'Needs attention', status: 'Leads' });
  });

  it('AC-LRC-002: falls back from invalid enums without discarding valid referenced IDs or unrelated keys', () => {
    const params = new URLSearchParams(
      `?filter=bogus&client=${CLIENT_ID}&pm=${PM_ID}&view=map&q=%E2%9C%93&campaign=autumn`,
    );
    expect(parseListWorkingSet('projects', params)).toEqual({
      filter: 'All',
      client: CLIENT_ID,
      pm: PM_ID,
      q: '✓',
      view: 'table',
    });
    expect(
      serializeListWorkingSet(
        'projects',
        params,
        parseListWorkingSet('projects', params),
      ).toString(),
    ).toBe(`client=${CLIENT_ID}&pm=${PM_ID}&q=%E2%9C%93&campaign=autumn`);
  });

  it('AC-LRC-002: accepts only UUID references (plus the Unassigned PM sentinel), else falls back to All', () => {
    const params = new URLSearchParams(
      `?client=client-1&pm=${UNASSIGNED_PROJECT_MANAGER}&campaign=autumn`,
    );
    const projects = parseListWorkingSet('projects', params);
    expect(projects).toMatchObject({ client: 'All', pm: UNASSIGNED_PROJECT_MANAGER });
    expect(serializeListWorkingSet('projects', params, projects).toString()).toBe(
      `pm=${UNASSIGNED_PROJECT_MANAGER}&campaign=autumn`,
    );
    // The sentinel belongs to the PM filter only.
    expect(parseListWorkingSet('projects', `?client=${UNASSIGNED_PROJECT_MANAGER}`).client).toBe('All');
    expect(parseListWorkingSet('contacts', `?company=${UNASSIGNED_PROJECT_MANAGER}`).company).toBe('All');
    for (const invalid of [
      'not-a-user',
      '../companies',
      '/companies',
      'https://outside.example',
      `${PM_ID}x`,
      `x${PM_ID}`,
      PM_ID.replace(/-/g, ''),
      '<script>',
      'All ',
    ]) {
      const value = encodeURIComponent(invalid);
      expect(parseListWorkingSet('projects', `?pm=${value}&client=${value}`), invalid).toMatchObject({
        client: 'All',
        pm: 'All',
      });
      expect(parseListWorkingSet('contacts', `?company=${value}`).company, invalid).toBe('All');
      expect(parseListWorkingSet('meetings', `?project=${value}`).project, invalid).toBe('All');
    }
    // A syntactically valid ID stays selected in its lowercase canonical form, even when unknown.
    expect(parseListWorkingSet('meetings', `?project=${PROJECT_ID.toUpperCase()}`).project).toBe(
      PROJECT_ID,
    );
  });

  it('AC-LRC-002: strips control characters from search while keeping Unicode text', () => {
    expect(parseListWorkingSet('companies', '?q=ab%00c%07d%0A%09%7F%C2%85e').q).toBe('abcde');
    expect(parseListWorkingSet('projects', '?q=Caf%C3%A9+%E6%9D%B1%E4%BA%AC+%F0%9F%9A%A2').q).toBe(
      'Café 東京 🚢',
    );
    const sales = parseListWorkingSet('sales', '?q=%00%01&campaign=spring');
    expect(sales.q).toBe('');
    // A search that was only control characters serializes as absent; unrelated keys survive.
    expect(serializeListWorkingSet('sales', '?q=%00%01&campaign=spring', sales).toString()).toBe(
      'campaign=spring',
    );
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
    const options = { sessionView: 'calendar' };
    const value = parseListWorkingSet('projects', stored, options);
    expect(value.view).toBe('calendar');
    const search = serializeListWorkingSet('projects', stored, value, options);
    expect(search.get('view')).toBe('calendar');
    expect(search.get('campaign')).toBe('fall');

    expect(parseListWorkingSet('projects', '?view=kanban', options).view).toBe('kanban');
    expect(parseListWorkingSet('projects', '', { sessionView: 'unknown' }).view).toBe('table');
  });

  it('AC-LRC-002: a view enum rejects through the projects codec with the canonical serialization', () => {
    const source = new URLSearchParams('?view=map&campaign=winter');
    expect(parseListWorkingSet('projects', source).view).toBe('table');
    // The canonical URL drops the invalid view token (table is the omitted default) but
    // retains unrelated keys.
    const canonical = serializeListWorkingSet(
      'projects',
      source,
      parseListWorkingSet('projects', source),
    );
    expect(canonical.get('view')).toBeNull();
    expect(canonical.get('campaign')).toBe('winter');
  });

  it('AC-LRC-001: each codec round-trips every view its hook module declares, defaulting to the hook default', () => {
    const cases = [
      { list: 'projects', views: PROJECT_VIEWS, fallback: DEFAULT_PROJECT_VIEW },
      { list: 'sales', views: PIPELINE_VIEWS, fallback: DEFAULT_PIPELINE_VIEW },
      { list: 'procurement', views: PROCUREMENT_VIEWS, fallback: DEFAULT_PROCUREMENT_VIEW },
    ] as const;
    for (const { list, views, fallback } of cases) {
      expect(views.length, list).toBeGreaterThan(1);
      expect(parseListWorkingSet(list, '').view, list).toBe(fallback);
      for (const view of views) {
        const parsed = parseListWorkingSet(list, `?view=${view}&campaign=fall`);
        expect(parsed.view, `${list}:${view}`).toBe(view);
        const query = serializeListWorkingSet(list, '?campaign=fall', parsed);
        expect(query.get('view'), `${list}:${view}`).toBe(view === fallback ? null : view);
        expect(parseListWorkingSet(list, query).view, `${list}:${view}`).toBe(view);
        expect(query.get('campaign')).toBe('fall');
      }
    }
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
