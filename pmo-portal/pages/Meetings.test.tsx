import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { resetActiveLocale, setActiveLocale } from '@/src/lib/locale/activeLocale';
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router';
import React from 'react';
import type { Role } from '@/src/auth/AuthContext';
import { ToastProvider } from '@/src/components/ui';

// ── Repository-seam-backed hooks are mocked; the page is the unit under test. ──
const { listState, mutations, useMeetingsSpy } = vi.hoisted(() => ({
  listState: {
    data: [] as unknown[],
    isPending: false,
    isError: false,
    isPlaceholderData: false,
    /** When true, the UNFILTERED query answers with react-query's kept-previous `[]` placeholder
     *  (a refetch still in flight after Clear filters). */
    unfilteredPlaceholder: false,
    refetch: vi.fn(),
  },
  mutations: {
    create: { mutateAsync: vi.fn(), isPending: false },
    update: { mutateAsync: vi.fn(), isPending: false },
    archive: { mutateAsync: vi.fn(), isPending: false },
    remove: { mutateAsync: vi.fn(), isPending: false },
    addAttendee: { mutateAsync: vi.fn(), isPending: false },
    removeAttendee: { mutateAsync: vi.fn(), isPending: false },
    addGrant: { mutateAsync: vi.fn(), isPending: false },
    revokeGrant: { mutateAsync: vi.fn(), isPending: false },
    createActionItem: { mutateAsync: vi.fn(), isPending: false },
  },
  useMeetingsSpy: vi.fn(),
}));

vi.mock('@/src/components/meetings/MinutesEditor', async () => {
  const React = await import('react');
  const EditorStub = ({ onReady, onChange }: { onReady: (blocks: never[]) => void; onChange: (blocks: never[]) => void }) => {
    React.useEffect(() => onReady([]), [onReady]);
    return <button type="button" onClick={() => onChange([])}>Minutes editor</button>;
  };
  return { default: EditorStub };
});

vi.mock('@/src/hooks/useMeetings', () => ({
  useMeetings: (params: { projectId?: string; search?: string } = {}) => {
    useMeetingsSpy(params);
    // list-working-set-return (#683): Meetings' search/project narrowing is a SERVER query
    // (DD-MTG-5) — simulate that here so an AC-LRC-012 zero-match/clear-filters case is
    // observable through the page, not just as a spy call.
    const narrowed = Boolean(params.projectId || params.search);
    if (!narrowed && listState.unfilteredPlaceholder) {
      return { ...listState, data: [], isPlaceholderData: true };
    }
    return { ...listState, data: narrowed ? [] : listState.data };
  },
  useMeetingMutations: () => mutations,
}));

vi.mock('@/src/hooks/useProjects', () => ({
  useProjects: () => ({ data: [{ id: '33333333-3333-4333-8333-333333333333', name: 'Harbour Upgrade', short_name: 'North Terminal' }], isPending: false }),
}));

vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'u1', org_id: 'org-1' } }),
}));

// list-working-set-return (#683): the page writes real router navigation for its `project`/`q`
// URL state and for record-open return context, so `react-router` stays UNMOCKED — a LocationProbe
// sibling (below) reads the real `useLocation()` to assert the resulting URL/state.

let realRole: Role = 'Admin';
vi.mock('@/src/auth/impersonation', () => ({
  useEffectiveRole: () => ({ realRole, effectiveRole: realRole }),
}));

import Meetings from './Meetings';
import MeetingCreate from './MeetingCreate';

const seed = [
  {
    id: 'm1',
    title: 'Kickoff with Acme',
    occurred_at: '2026-08-20T09:00:00Z',
    location: 'Site office',
    project_id: '33333333-3333-4333-8333-333333333333',
    project: { id: '33333333-3333-4333-8333-333333333333', name: 'Harbour Upgrade', project_manager_id: null, pm: null },
    created_by_id: 'u1',
    archived_at: null,
    is_template: false,
    notes: [],
  },
  {
    id: 'm2',
    title: 'Supplier dispute call',
    occurred_at: '2026-08-22T13:00:00Z',
    location: null,
    project_id: null,
    project: null,
    created_by_id: 'u9',
    archived_at: null,
    is_template: false,
    notes: [],
  },
];

// list-working-set-return (#683): reads the REAL router location so tests can assert the URL
// (filter/search round-trip) and the record-open return-context `location.state`.
const RouteContent: React.FC = () => {
  const location = useLocation();
  return location.pathname === '/meetings/new' ? <MeetingCreate /> : <Meetings />;
};

const LocationProbe: React.FC = () => {
  const location = useLocation();
  return (
    <div
      data-testid="location-probe"
      data-pathname={location.pathname}
      data-search={location.search}
    >
      {JSON.stringify(location.state ?? null)}
    </div>
  );
};

const renderPage = (role: Role = 'Admin', initialPath = '/meetings') => {
  realRole = role;
  return render(
    <ToastProvider>
      <MemoryRouter initialEntries={[initialPath]}>
        <LocationProbe />
        <RouteContent />
      </MemoryRouter>
    </ToastProvider>,
  );
};

/** The shell's scroll container, sized so a restore has a real range to land in (jsdom has no layout). */
const sizeMainScroll = (): HTMLElement => {
  const main = document.querySelector<HTMLElement>('.main-scroll')!;
  Object.defineProperties(main, {
    scrollHeight: { configurable: true, value: 2000 },
    clientHeight: { configurable: true, value: 400 },
  });
  return main;
};

beforeEach(() => {
  listState.data = seed;
  listState.isPending = false;
  listState.isError = false;
  listState.isPlaceholderData = false;
  listState.unfilteredPlaceholder = false;
  listState.refetch.mockClear();
  Object.values(mutations).forEach((m) => {
    m.mutateAsync.mockReset();
    m.mutateAsync.mockResolvedValue(undefined);
    m.isPending = false;
  });
  mutations.create.mutateAsync.mockResolvedValue({ id: 'm-new' });
  useMeetingsSpy.mockClear();
  realRole = 'Admin';
});

describe('Meetings index — list (FR-MTG-028/029)', () => {
  it('renders the seeded meetings with title, project, and location', () => {
    renderPage();
    expect(screen.getByText('Kickoff with Acme')).toBeInTheDocument();
    expect(screen.getByText('Supplier dispute call')).toBeInTheDocument();
    // 'Harbour Upgrade' also appears as a project-filter option — scope to the row.
    const row = screen.getByText('Kickoff with Acme').closest('tr')!;
    expect(within(row).getByText('Harbour Upgrade')).toBeInTheDocument();
    expect(within(row).getByText('Site office')).toBeInTheDocument();
  });

  it('AC-002 #1325: the project column keeps the short and contractual names readable', () => {
    const original = listState.data;
    listState.data = [{ ...(seed[0] as object), project: { id: '33333333-3333-4333-8333-333333333333', name: 'Harbour Upgrade', short_name: 'Harbour', project_manager_id: null, pm: null } }];
    renderPage();
    const row = screen.getByText('Kickoff with Acme').closest('tr')!;
    expect(within(row).getByText('Harbour')).toBeVisible();
    expect(within(row).getByText('Harbour Upgrade')).toBeVisible();
    listState.data = original;
  });

  it('a row activates into the /meetings/:id detail route', async () => {
    renderPage();
    await userEvent.click(screen.getByText('Kickoff with Acme'));
    expect(screen.getByTestId('location-probe').dataset.pathname).toBe('/meetings/m1');
  });

  it('R-038/R-039: puts project identity before the dated group and names the active timezone', () => {
    renderPage();
    const headers = screen.getAllByRole('columnheader').map((header) => header.textContent?.trim());
    expect(headers.indexOf('Project')).toBeLessThan(headers.indexOf('When'));
    expect(screen.getByTestId('meetings-timezone')).toHaveTextContent(/UTC|Asia\//);
  });

  it('AC-WORK-MTG-01: lists the latest meeting first and keeps search, project, sort and create ordered', () => {
    renderPage();
    const rows = screen.getAllByRole('row').slice(1);
    expect(rows.map((row) => row.querySelector('td')?.textContent?.trim())).toEqual([
      'Supplier dispute call',
      'Kickoff with Acme',
    ]);
    const toolbar = screen.getByTestId('list-page-toolbar');
    const controls = [
      screen.getByRole('searchbox', { name: /Search meetings/i }),
      screen.getByLabelText(/Filter by project/i),
      screen.getByLabelText(/Sort meetings/i),
      screen.getByRole('button', { name: /New meeting/i }),
    ];
    expect(controls.every((control) => toolbar.contains(control))).toBe(true);
    for (let index = 1; index < controls.length; index += 1) {
      expect(Boolean(controls[index - 1].compareDocumentPosition(controls[index]) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
    }
  });

  it('AC-WORK-MTG-01: changing date order is stored in the list URL', async () => {
    renderPage();
    await userEvent.selectOptions(screen.getByLabelText(/Sort meetings/i), 'date-asc');
    expect(new URLSearchParams(screen.getByTestId('location-probe').getAttribute('data-search') ?? '').get('sort')).toBe('date-asc');
    const rows = screen.getAllByRole('row').slice(1);
    expect(rows.map((row) => row.querySelector('td')?.textContent?.trim())).toEqual([
      'Kickoff with Acme',
      'Supplier dispute call',
    ]);
  });

  it('the search box drives the SERVER query (DD-MTG-5 — notes are the find mechanism)', async () => {
    renderPage();
    await userEvent.type(screen.getByLabelText(/Search meetings/i), 'pipeline');
    expect(useMeetingsSpy).toHaveBeenLastCalledWith(
      expect.objectContaining({ search: 'pipeline' }),
    );
  });
});

describe('Meetings — create affordance (OD-MTG-1: EVERY role, Engineer included)', () => {
  it.each(['Admin', 'Executive', 'Project Manager', 'Finance', 'Engineer'] as Role[])(
    '%s sees the New meeting button',
    (role) => {
      renderPage(role);
      expect(screen.getByRole('button', { name: /New meeting/ })).toBeInTheDocument();
    },
  );
});

describe('Meetings — row menu gating', () => {
  it('Admin gets Archive + Delete in the row menu', async () => {
    renderPage('Admin');
    const row = screen.getByText('Supplier dispute call').closest('tr')!;
    await userEvent.click(within(row).getByRole('button', { name: 'Row actions' }));
    expect(screen.getByRole('menuitem', { name: 'Archive' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Delete' })).toBeInTheDocument();
  });

  it('AC-MTG-029: an Engineer author may archive own row but not a non-authored row', async () => {
    renderPage('Engineer');
    const ownRow = screen.getByText('Kickoff with Acme').closest('tr')!;
    await userEvent.click(within(ownRow).getByRole('button', { name: 'Row actions' }));
    expect(screen.getByRole('menuitem', { name: 'Archive' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Delete' })).not.toBeInTheDocument();

    const nonAuthoredRow = screen.getByText('Supplier dispute call').closest('tr')!;
    await userEvent.click(within(nonAuthoredRow).getByRole('button', { name: 'Row actions' }));
    expect(screen.queryByRole('menuitem', { name: 'Archive' })).not.toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Delete' })).not.toBeInTheDocument();
  });
});

describe('Meetings — states', () => {
  it('R-037: empty guidance does not duplicate the toolbar creation action', () => {
    listState.data = [];
    renderPage();
    expect(screen.getByText('No meetings yet')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'New meeting' })).toHaveLength(1);
  });

  it('error state renders with retry', async () => {
    listState.isError = true;
    listState.data = [] as never;
    renderPage();
    expect(screen.getByText("Couldn't load meetings")).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Try again|Retry/i }));
    expect(listState.refetch).toHaveBeenCalled();
  });

  it('loading state renders the skeleton', () => {
    listState.isPending = true;
    renderPage();
    expect(screen.queryByText('Kickoff with Acme')).not.toBeInTheDocument();
  });
});

describe('AC-PLC-005: meeting occurrence follows the profile timezone', () => {
  afterEach(() => resetActiveLocale());

  it('shows the occurrence wall time and day in the viewer timezone', () => {
    listState.data = [{ ...seed[0], occurred_at: '2026-06-14T23:30:00Z' }];
    setActiveLocale({ locale: 'en', numberLocale: 'en-US', timezone: 'UTC' });
    const { unmount } = renderPage();
    expect(screen.getByText(/Jun 14, 2026, 11:30\sPM/)).toBeInTheDocument();
    unmount();

    setActiveLocale({ locale: 'en', numberLocale: 'en-US', timezone: 'Asia/Jakarta' });
    renderPage();
    expect(screen.getByText(/Jun 15, 2026, 06:30\sAM/)).toBeInTheDocument();
  });
});

describe('AC-PLC-005/006 (#684): New-meeting "When" prefill and submit follow the PROFILE timezone, not the device zone', () => {
  const originalTz = process.env.TZ;
  const PINNED_NOW = new Date('2026-06-14T14:15:00Z'); // 21:15 Asia/Jakarta, 07:15 America/Los_Angeles

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(PINNED_NOW);
    // Simulate a device/browser zone that DIFFERS from the resolved profile timezone (#684's
    // reported scenario: profile Asia/Jakarta, browser America/Los_Angeles).
    process.env.TZ = 'America/Los_Angeles';
    setActiveLocale({ locale: 'en', numberLocale: 'en-US', timezone: 'Asia/Jakarta' });
  });

  afterEach(() => {
    vi.useRealTimers();
    process.env.TZ = originalTz;
    resetActiveLocale();
  });

  it('prefills "When" with the current wall time in the profile timezone (not the device zone)', async () => {
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: /New meeting/ }));
    const when = screen.getByLabelText(/When/i) as HTMLInputElement;
    expect(when.value).toBe('2026-06-14T21:15');
  });

  it('submitting the unedited default keeps the same instant', async () => {
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: /New meeting/ }));
    await userEvent.type(screen.getByLabelText(/Title/), 'Standup');
    await userEvent.click(screen.getByRole('button', { name: /Save meeting/ }));
    await waitFor(() => expect(mutations.create.mutateAsync).toHaveBeenCalled());
    const [input] = mutations.create.mutateAsync.mock.calls[0];
    expect(input.occurred_at).toBe('2026-06-14T14:15:00.000Z');
  });

  it('clearing "When" blocks the create with a visible error (a meeting time is required)', async () => {
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: /New meeting/ }));
    await userEvent.type(screen.getByLabelText(/Title/i), 'Standup');
    const when = screen.getByLabelText(/When/i, { selector: 'input, select, textarea' }) as HTMLInputElement;
    when.focus();
    await userEvent.clear(when);
    await userEvent.click(screen.getByRole('button', { name: /Save meeting/ }));
    // The field error is shown inline.
    expect((await screen.findAllByText(/valid date and time/i)).length).toBeGreaterThan(0);
    expect(mutations.create.mutateAsync).not.toHaveBeenCalled();
  });
});

// list-working-set-return (#683, AC-LRC-008): `project`/`q` round-trip through the URL, and
// opening a row stamps a validated Meetings return context onto the navigation's router state.
// The existing deferred SERVER search + newest-first query are unchanged (see Meetings.tsx).
describe('Meetings index — list working set + return context (AC-LRC-008)', () => {
  it('AC-002 #1325: project filter offers the short name only (no contractual suffix) on the stable UUID', () => {
    renderPage('Admin');
    expect(screen.getByRole('option', { name: 'North Terminal' })).toHaveValue('33333333-3333-4333-8333-333333333333');
  });

  it('AC-LRC-001: a direct URL with ?project= restores the selected filter and queries the server for it', () => {
    renderPage('Admin', '/meetings?project=33333333-3333-4333-8333-333333333333');
    expect(useMeetingsSpy).toHaveBeenLastCalledWith(
      expect.objectContaining({ projectId: '33333333-3333-4333-8333-333333333333' }),
    );
  });

  it('AC-LRC-001: choosing a project filter writes ?project= to the URL', async () => {
    renderPage('Admin');
    await userEvent.selectOptions(
      screen.getByLabelText(/Filter by project/i),
      '33333333-3333-4333-8333-333333333333',
    );
    await waitFor(() =>
      expect(screen.getByTestId('location-probe').dataset.search).toBe(
        '?project=33333333-3333-4333-8333-333333333333',
      ),
    );
  });

  it('AC-LRC-008: opening a row stamps a validated Meetings return context onto the navigation state', async () => {
    renderPage('Admin');
    await userEvent.click(screen.getByText('Supplier dispute call'));
    await waitFor(() => {
      const probe = screen.getByTestId('location-probe');
      expect(probe.dataset.pathname).toBe('/meetings/m2');
      const state = JSON.parse(probe.textContent || 'null');
      expect(state.pmoListReturn).toMatchObject({ list: 'meetings', path: '/meetings' });
    });
  });

  // Supporting case; AC-LRC-012's owning proof is pages/__tests__/listWorkingSet.emptyStates.test.tsx.
  it('a zero-match server filter offers Clear filters, which restores the rows', async () => {
    renderPage('Admin');
    await userEvent.selectOptions(
      screen.getByLabelText(/Filter by project/i),
      '33333333-3333-4333-8333-333333333333',
    );
    expect(await screen.findByText(/No meetings match/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Clear filters/i }));
    expect(await screen.findByText('Kickoff with Acme')).toBeInTheDocument();
    expect(screen.getByText('Supplier dispute call')).toBeInTheDocument();
  });

  it('AC-LRC-001: a direct URL with ?q= fills the search box and sends that term to the SERVER query', () => {
    renderPage('Admin', '/meetings?q=pipeline');
    expect(screen.getByLabelText(/Search meetings/i)).toHaveValue('pipeline');
    expect(useMeetingsSpy).toHaveBeenLastCalledWith(expect.objectContaining({ search: 'pipeline' }));
  });

  it('FR-LRC-007: after Clear filters, the kept-previous empty result reads as loading — never "No meetings yet"', async () => {
    renderPage('Admin', '/meetings?project=33333333-3333-4333-8333-333333333333');
    expect(await screen.findByText(/No meetings match/i)).toBeInTheDocument();

    // The unfiltered refetch is still in flight: react-query keeps the previous `[]` as placeholder.
    listState.unfilteredPlaceholder = true;
    await userEvent.click(screen.getByRole('button', { name: /Clear filters/i }));
    await waitFor(() => expect(screen.getByTestId('location-probe').dataset.search).toBe(''));
    expect(screen.queryByText('No meetings yet')).not.toBeInTheDocument();
    expect(screen.queryByText(/No meetings match/i)).not.toBeInTheDocument();
    expect(screen.getByTestId('liststate-loading')).toBeInTheDocument();
    // The toolbar stays mounted through the refetch (the search box keeps its focus/text).
    expect(screen.getByLabelText(/Search meetings/i)).toBeInTheDocument();
  });

  it('AC-LRC-001: an unavailable ?project= stays the active, clearable choice (control agrees with the URL)', async () => {
    const GONE = '99999999-9999-4999-8999-999999999999';
    renderPage('Admin', `/meetings?project=${GONE}`);
    const select = screen.getByLabelText(/Filter by project/i);
    expect(select).toHaveValue(GONE);
    expect(screen.getByRole('option', { name: 'Unavailable project', selected: true })).toBeInTheDocument();
    expect(useMeetingsSpy).toHaveBeenLastCalledWith(expect.objectContaining({ projectId: GONE }));
    expect(screen.getByText(/No meetings match/i)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /Clear filters/i }));
    await waitFor(() => expect(screen.getByTestId('location-probe').dataset.search).toBe(''));
    expect(screen.getByLabelText(/Filter by project/i)).toHaveValue('All');
    expect(screen.queryByRole('option', { name: 'Unavailable project' })).not.toBeInTheDocument();
  });

  it('AC-LRC-008: a meeting created from a filtered list opens with that list as its return context', async () => {
    mutations.create.mutateAsync.mockResolvedValue({ id: 'm-new' });
    renderPage('Admin', '/meetings?q=kickoff');
    await userEvent.click(screen.getByRole('button', { name: /New meeting/ }));
    await userEvent.type(screen.getByLabelText(/^Title/), 'Design review');
    await userEvent.click(screen.getByRole('button', { name: /Save meeting/i }));
    await waitFor(() => {
      const probe = screen.getByTestId('location-probe');
      expect(probe.dataset.pathname).toBe('/meetings/m-new');
      const state = JSON.parse(probe.textContent || 'null');
      expect(state.pmoListReturn).toMatchObject({ list: 'meetings', path: '/meetings?q=kickoff' });
    });
  });

  it('FR-LRC-005: a return restores the captured scroll position only once real (non-placeholder) rows are ready', async () => {
    listState.isPending = true;
    const entry = {
      pathname: '/meetings',
      search: '',
      state: { pmoListScrollRestore: { list: 'meetings', path: '/meetings', scrollTop: 300 } },
    };
    // A fresh element per render: re-rendering the SAME element would let React bail out.
    const tree = () => (
      <ToastProvider>
        <MemoryRouter initialEntries={[entry]}>
          <div className="main-scroll">
            <Meetings />
          </div>
        </MemoryRouter>
      </ToastProvider>
    );
    const { rerender } = render(tree());
    const main = sizeMainScroll();

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(main.scrollTop).toBe(0);

    // Rows on screen, but they are the previous query's placeholder — still not this list's content.
    listState.isPending = false;
    listState.isPlaceholderData = true;
    rerender(tree());
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(main.scrollTop).toBe(0);

    listState.isPlaceholderData = false;
    rerender(tree());
    await waitFor(() => expect(main.scrollTop).toBe(300));
    expect(screen.getByText('Kickoff with Acme')).toBeInTheDocument();
  });
});
