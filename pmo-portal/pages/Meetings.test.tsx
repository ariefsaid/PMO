import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { resetActiveLocale, setActiveLocale } from '@/src/lib/locale/activeLocale';
import { render, screen, within, waitFor, act } from '@testing-library/react';
import { toast as sonnerToast } from 'sonner';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router';
import React from 'react';
import type { Role } from '@/src/auth/AuthContext';
import { ToastProvider } from '@/src/components/ui';
import { findToastAnnouncement } from '@/src/components/ui/__tests__/toastTestQueries';
import { AppError } from '@/src/lib/appError';

// ── Repository-seam-backed hooks are mocked; the page is the unit under test. ──
const { listState, mutations, useMeetingsSpy, projectsState } = vi.hoisted(() => ({
  /** The picker read's rows, in whatever order the reader returns them (C18 order is the page's). */
  projectsState: {
    data: [] as Array<{ id: string; name: string; short_name?: string | null }>,
  },
  listState: {
    data: [] as unknown[],
    isPending: false,
    isError: false,
    isPlaceholderData: false,
    total: 2 as number | undefined,
    hasNextPage: false,
    isFetchingNextPage: false,
    /** The loaded pages are incomplete (one search leg failed) — their row set is a subset. */
    isPartial: false,
    fetchNextPage: vi.fn(),
    /** When true, the UNFILTERED query answers with react-query's kept-previous `[]` placeholder
     *  (a refetch still in flight after Clear filters). */
    unfilteredPlaceholder: false,
    refetch: vi.fn(),
  },
  mutations: {
    create: { mutateAsync: vi.fn(), isPending: false },
    update: { mutateAsync: vi.fn(), isPending: false },
    archive: { mutateAsync: vi.fn(), isPending: false },
    restore: { mutateAsync: vi.fn(), isPending: false },
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
  useMeetingsPages: (params: { projectId?: string; search?: string; includeArchived?: boolean } = {}) => {
    useMeetingsSpy(params);
    // list-working-set-return (#683): Meetings' search/project narrowing is a SERVER query
    // (DD-MTG-5) — simulate that here so an AC-LRC-012 zero-match/clear-filters case is
    // observable through the page, not just as a spy call.
    const narrowed = Boolean(params.projectId || params.search);
    if (!narrowed && listState.unfilteredPlaceholder) {
      return { ...listState, data: { pages: [{ rows: [] }] }, isPlaceholderData: true };
    }
    const visibleRows = params.includeArchived
      ? listState.data
      : listState.data.filter((row) => !(row as { archived_at?: string | null }).archived_at);
    return { ...listState, data: { pages: [{ rows: narrowed ? [] : visibleRows }] } };
  },
  useMeetingMutations: () => mutations,
}));

vi.mock('@/src/hooks/useProjects', () => ({
  useProjectPickerOptions: () => ({ data: projectsState.data, isPending: false }),
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

// The toast library's store replays still-active toasts into the next provider — clear them.
afterEach(() => {
  act(() => { sonnerToast.dismiss(); });
});


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

const archivedSeed = {
  id: 'm-archived',
  title: 'Archived planning session',
  occurred_at: '2026-08-19T09:00:00Z',
  location: null,
  project_id: null,
  project: null,
  created_by_id: 'u1',
  archived_at: '2026-08-21T09:00:00Z',
  is_template: false,
};

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

const chooseProject = async (label: string) => {
  await userEvent.click(screen.getByRole('combobox', { name: /Filter by project/i }));
  await userEvent.click(await screen.findByRole('option', { name: label }));
};

beforeEach(() => {
  listState.data = seed;
  projectsState.data = [{ id: '33333333-3333-4333-8333-333333333333', name: 'Harbour Upgrade', short_name: 'North Terminal' }];
  listState.isPending = false;
  listState.isError = false;
  listState.isPlaceholderData = false;
  listState.total = 2;
  listState.hasNextPage = false;
  listState.isFetchingNextPage = false;
  listState.isPartial = false;
  listState.fetchNextPage.mockClear();
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

  it('C8 meetings.ts:84,168,196 labels a capped list as partial and offers Load more', async () => {
    listState.data = Array.from({ length: 200 }, (_, i) => ({ ...(seed[0] as object), id: `m${i}`, title: `Meeting ${i}` }));
    listState.hasNextPage = true;
    listState.total = 250;
    renderPage();
    expect(screen.getAllByText('Showing 200 of 250')).toHaveLength(2);
    await userEvent.click(screen.getByRole('button', { name: 'Load more' }));
    expect(listState.fetchNextPage).toHaveBeenCalledOnce();
  });

  it('C8b F5 an incomplete page is counted as loaded rows, never as the exact total', () => {
    listState.data = Array.from({ length: 25 }, (_, i) => ({ ...(seed[0] as object), id: `m${i}`, title: `Meeting ${i}` }));
    listState.hasNextPage = true;
    listState.total = 250;
    listState.isPartial = true;
    renderPage();
    expect(screen.queryByText(/Showing 25 of 250/)).toBeNull();
    expect(screen.getByText('25 loaded, more available')).toBeInTheDocument();
  });

  // C8 residual: the full-text leg of a search failed, so the rows are a subset of the matches.
  // c8b dropped the exact total for that case; on the LAST page there is no continuation footer
  // at all, so the page itself has to say the result may be incomplete.
  it('C8 residual: an incomplete last page says some matches may be missing', () => {
    listState.data = Array.from({ length: 25 }, (_, i) => ({ ...(seed[0] as object), id: `m${i}`, title: `Meeting ${i}` }));
    listState.hasNextPage = false;
    listState.total = undefined;
    listState.isPartial = true;
    renderPage();
    expect(screen.getByText('Some matches may be missing. Search again to retry.')).toBeInTheDocument();
  });

  it('C8 residual: a complete page never claims matches are missing', () => {
    renderPage();
    expect(screen.queryByText(/may be missing/i)).toBeNull();
  });

  it('C8b F4 does not claim a count while the rows on screen are the previous query’s placeholder', () => {
    listState.isPlaceholderData = true;
    listState.total = 250;
    renderPage();
    expect(screen.queryByText(/Showing \d+ of 250/)).toBeNull();
  });

  it('AC-002 #1325: the project column leads with the short name and titles the contractual one', () => {
    const original = listState.data;
    listState.data = [{ ...(seed[0] as object), project: { id: '33333333-3333-4333-8333-333333333333', name: 'Harbour Upgrade', short_name: 'Harbour', project_manager_id: null, pm: null } }];
    renderPage();
    const row = screen.getByText('Kickoff with Acme').closest('tr')!;
    expect(within(row).getByTitle('Harbour Upgrade')).toHaveTextContent('Harbour');
    listState.data = original;
  });

  it('a row activates into the /meetings/:id detail route', async () => {
    renderPage();
    await userEvent.click(screen.getByText('Kickoff with Acme'));
    expect(screen.getByTestId('location-probe').dataset.pathname).toBe('/meetings/m1');
  });

  it('C18 the project filter lists projects by the name a person reads, not the UUID order of the picker read', async () => {
    projectsState.data = [
      { id: '90000000-0000-4000-8000-000000000001', name: 'Zulu Refinery Upgrade', short_name: null },
      { id: '10000000-0000-4000-8000-000000000002', name: 'Legal Title', short_name: 'Arun Terminal' },
    ];
    renderPage();
    await userEvent.click(screen.getByRole('combobox', { name: /Filter by project/i }));
    expect(await screen.findByRole('listbox')).toBeInTheDocument();
    const options = await screen.findAllByRole('option');
    expect(options.map((option) => option.textContent).filter((label) => label !== 'All projects')).toEqual([
      'Arun Terminal',
      'Zulu Refinery Upgrade',
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

  it('hides archived meetings by default', () => {
    listState.data = [...seed, archivedSeed];
    renderPage('Engineer');
    expect(screen.getByText('Kickoff with Acme')).toBeInTheDocument();
    expect(screen.queryByText('Archived planning session')).not.toBeInTheDocument();
  });

  it('Show archived is URL-backed, includes live rows, and an author can restore into the active list', async () => {
    listState.data = [...seed, archivedSeed];
    renderPage('Engineer');
    await userEvent.click(screen.getByRole('switch', { name: 'Show archived' }));

    expect(useMeetingsSpy).toHaveBeenLastCalledWith(expect.objectContaining({ includeArchived: true }));
    expect(screen.getByTestId('location-probe')).toHaveAttribute('data-search', '?archived=1');
    expect(screen.getByText('Kickoff with Acme')).toBeInTheDocument();
    const title = screen.getAllByText('Archived planning session').find((element) => element.closest('tr'))!;
    const row = title.closest('tr')!;
    expect(within(row).getByText('Archived')).toBeInTheDocument();
    expect(within(row).getByText('Archived planning session')).toHaveClass('text-muted-foreground');
    await userEvent.click(within(row).getByRole('button', { name: 'Row actions' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Restore' }));

    await waitFor(() => expect(mutations.restore.mutateAsync).toHaveBeenCalledWith('m-archived'));
    listState.data = listState.data.map((item) => {
      const row = item as { id: string; archived_at?: string | null };
      return row.id === archivedSeed.id ? { ...row, archived_at: null } : item;
    });
    await userEvent.click(screen.getByRole('switch', { name: 'Show archived' }));
    const restoredTitle = (await screen.findAllByText('Archived planning session')).find((element) => element.closest('tr'))!;
    expect(restoredTitle).toBeInTheDocument();
    expect(within(restoredTitle.closest('tr')!).queryByText('Archived')).not.toBeInTheDocument();
  });

  it('does not offer restore for an archived meeting owned by someone else', async () => {
    listState.data = [{ ...archivedSeed, created_by_id: 'u9' }];
    renderPage('Engineer');
    await userEvent.click(screen.getByRole('switch', { name: 'Show archived' }));
    const row = screen.getByText('Archived planning session').closest('tr')!;
    await userEvent.click(within(row).getByRole('button', { name: 'Row actions' }));
    expect(screen.queryByRole('menuitem', { name: 'Restore' })).not.toBeInTheDocument();
  });

  it('C13 Meetings.tsx:179-193 says why a row cannot be archived instead of silently omitting it', async () => {
    renderPage('Engineer');
    const row = screen.getByText('Supplier dispute call').closest('tr')!;
    await userEvent.click(within(row).getByRole('button', { name: 'Row actions' }));
    // The known rule (author or Admin) is rendered, so the missing action is explainable from the list.
    expect(screen.getByRole('menuitem', { name: /author or Admin/i })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Archive' })).not.toBeInTheDocument();
  });
});

describe('Meetings — states', () => {
  it('empty state renders with the create affordance', () => {
    listState.data = [];
    renderPage();
    expect(screen.getByText('No meetings yet')).toBeInTheDocument();
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
    expect(screen.getByText(/14 Jun, 11:30\sPM/)).toBeInTheDocument();
    unmount();

    setActiveLocale({ locale: 'en', numberLocale: 'en-US', timezone: 'Asia/Jakarta' });
    renderPage();
    expect(screen.getByText(/15 Jun, 06:30\sAM/)).toBeInTheDocument();
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
    expect((await screen.findAllByText(/valid date and a local time that exists/i)).length).toBeGreaterThan(0);
    expect(mutations.create.mutateAsync).not.toHaveBeenCalled();
  });
});

// list-working-set-return (#683, AC-LRC-008): `project`/`q` round-trip through the URL, and
// opening a row stamps a validated Meetings return context onto the navigation's router state.
// The existing deferred SERVER search + newest-first query are unchanged (see Meetings.tsx).
describe('Meetings index — list working set + return context (AC-LRC-008)', () => {
  it('AC-002 #1325: project filter offers the short name only (no contractual suffix) on the stable UUID', async () => {
    renderPage('Admin');
    await userEvent.click(screen.getByRole('combobox', { name: /Filter by project/i }));
    expect(await screen.findByRole('option', { name: 'North Terminal' })).toBeInTheDocument();
  });

  it('AC-LRC-001: a direct URL with ?project= restores the selected filter and queries the server for it', () => {
    renderPage('Admin', '/meetings?project=33333333-3333-4333-8333-333333333333');
    expect(screen.getByRole('combobox', { name: /Filter by project/i })).toHaveTextContent('North Terminal');
    expect(useMeetingsSpy).toHaveBeenLastCalledWith(
      expect.objectContaining({ projectId: '33333333-3333-4333-8333-333333333333' }),
    );
  });

  it('AC-LRC-001: choosing a project filter writes ?project= to the URL', async () => {
    renderPage('Admin');
    await chooseProject('North Terminal');
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
    await chooseProject('North Terminal');
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

  it('FilterBar: project filter and search round-trip through the URL', async () => {
    renderPage('Admin', '/meetings');
    await chooseProject('North Terminal');
    await waitFor(() =>
      expect(screen.getByTestId('location-probe').dataset.search).toContain(
        'project=33333333-3333-4333-8333-333333333333',
      ),
    );
    await userEvent.type(screen.getByLabelText(/Search meetings/i), 'kickoff');
    await waitFor(() => {
      const search = screen.getByTestId('location-probe').dataset.search;
      expect(search).toContain('project=33333333-3333-4333-8333-333333333333');
      expect(search).toContain('q=kickoff');
    });
    await userEvent.click(screen.getByRole('button', { name: /Clear all/i }));
    await waitFor(() => expect(screen.getByTestId('location-probe').dataset.search).toBe(''));
  });

  it('AC-LRC-001: an unavailable ?project= stays the active, clearable choice (control agrees with the URL)', async () => {
    const GONE = '99999999-9999-4999-8999-999999999999';
    renderPage('Admin', `/meetings?project=${GONE}`);
    const projectPicker = screen.getByRole('combobox', { name: /Filter by project/i });
    expect(projectPicker).toHaveTextContent('Unavailable project');
    expect(useMeetingsSpy).toHaveBeenLastCalledWith(expect.objectContaining({ projectId: GONE }));
    expect(screen.getByText(/No meetings match/i)).toBeInTheDocument();

    await userEvent.click(projectPicker);
    expect(await screen.findByRole('option', { name: 'Unavailable project' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Clear filters/i }));
    await waitFor(() => expect(screen.getByTestId('location-probe').dataset.search).toBe(''));
    expect(screen.getByRole('combobox', { name: /Filter by project/i })).toHaveTextContent('All projects');
    expect(screen.queryByRole('option', { name: 'Unavailable project' })).not.toBeInTheDocument();
  });

  it('shows Clear all only while a project, search, or archived filter is active', async () => {
    renderPage('Admin');
    expect(screen.queryByRole('button', { name: /Clear all/i })).not.toBeInTheDocument();

    await chooseProject('North Terminal');
    expect(screen.getByRole('button', { name: /Clear all/i })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Clear all/i }));
    await waitFor(() => expect(screen.getByTestId('location-probe').dataset.search).toBe(''));
    expect(screen.queryByRole('button', { name: /Clear all/i })).not.toBeInTheDocument();

    await userEvent.type(screen.getByLabelText(/Search meetings/i), 'pipeline');
    expect(screen.getByRole('button', { name: /Clear all/i })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Clear all/i }));
    await waitFor(() => expect(screen.getByTestId('location-probe').dataset.search).toBe(''));
    expect(screen.getByLabelText(/Search meetings/i)).toHaveValue('');
    expect(screen.queryByRole('button', { name: /Clear all/i })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('switch', { name: 'Show archived' }));
    expect(screen.getByRole('button', { name: /Clear all/i })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Clear all/i }));
    await waitFor(() => expect(screen.getByTestId('location-probe').dataset.search).toBe(''));
    expect(screen.getByRole('switch', { name: 'Show archived' })).not.toBeChecked();
    expect(screen.queryByRole('button', { name: /Clear all/i })).not.toBeInTheDocument();
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

// Floor (all-screens/floor-tests/meetings.md items 7-9): the row MENU is a separate doorway from
// row activation, and the two destructive items run through their confirms with the row's id.
describe('Meetings — floor: row menu actions (floor-tests/meetings.md 7-9)', () => {
  it('floor 7: Row actions > Open opens that meeting record with the list-return context', async () => {
    renderPage('Admin');
    const row = screen.getByText('Kickoff with Acme').closest('tr')!;
    await userEvent.click(within(row).getByRole('button', { name: 'Row actions' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Open' }));

    const probe = screen.getByTestId('location-probe');
    expect(probe.dataset.pathname).toBe('/meetings/m1');
    expect(JSON.parse(probe.textContent || 'null').pmoListReturn).toMatchObject({
      list: 'meetings',
      path: '/meetings',
    });
  });

  it('floor 8: Row actions > Archive asks first, then archives that row', async () => {
    renderPage('Admin');
    const row = screen.getByText('Kickoff with Acme').closest('tr')!;
    await userEvent.click(within(row).getByRole('button', { name: 'Row actions' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Archive' }));

    // Nothing is written before the confirm.
    expect(mutations.archive.mutateAsync).not.toHaveBeenCalled();
    const dialog = await screen.findByRole('dialog', { name: /Archive Kickoff with Acme\?/ });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Archive meeting' }));

    await waitFor(() => expect(mutations.archive.mutateAsync).toHaveBeenCalledWith('m1'));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('floor 9: Row actions > Delete deletes that row, and a task reference stays visible', async () => {
    mutations.remove.mutateAsync.mockRejectedValue(new AppError('foreign key violation', '23503'));
    renderPage('Admin');
    const row = screen.getByText('Kickoff with Acme').closest('tr')!;
    await userEvent.click(within(row).getByRole('button', { name: 'Row actions' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Delete' }));

    // The delete confirm keeps the destructive tone, which renders role="alertdialog".
    const dialog = await screen.findByRole('alertdialog', { name: /Delete Kickoff with Acme\?/ });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete meeting' }));

    await waitFor(() => expect(mutations.remove.mutateAsync).toHaveBeenCalledWith('m1'));
    // A meeting whose minuted action items still exist cannot be deleted (23503): the refusal is
    // a visible, classified outcome naming Archive as the recovery — never a silent no-op.
    const refusal = await findToastAnnouncement('alert', /Still in use/i);
    expect(refusal).toHaveTextContent(/Archive it instead/i);
  });
});
