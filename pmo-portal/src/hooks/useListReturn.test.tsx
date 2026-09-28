import React, { useState } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BrowserRouter,
  MemoryRouter,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from 'react-router';
import { AppShell } from '@/src/components/shell/AppShell';
import { LIST_ENTRY_SCROLL_STATE_KEY, useListReturn, useReturnNavigate } from './useListReturn';
import { listReturnNavigation } from '@/src/lib/listReturnContext';

beforeEach(() => {
  window.history.replaceState(null, '');
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function LocationProbe() {
  const location = useLocation();
  return (
    <output
      data-testid="location"
      data-path={`${location.pathname}${location.search}`}
      data-state={JSON.stringify(location.state ?? null)}
      data-key={location.key}
    >
      {`${location.pathname}${location.search}`}
    </output>
  );
}

function CompaniesList() {
  const location = useLocation();
  const [ready, setReady] = useState(!location.state?.pmoListScrollRestore);
  const { openRecord } = useListReturn({ list: 'companies', contentReady: ready });
  const navigate = useNavigate();
  return (
    <div>
      <button type="button" onClick={() => openRecord('/companies/company-1')}>
        Open company
      </button>
      <button type="button" onClick={() => openRecord('https://outside.example/path')}>
        Open unsafe target
      </button>
      <button type="button" onClick={() => openRecord('/companies/company-1#')}>
        Open target with empty fragment
      </button>
      <button type="button" onClick={() => openRecord('/companies/bad\u0007id')}>
        Open control-char target
      </button>
      <button type="button" onClick={() => openRecord('/companies/company-1/approvals')}>
        Open tab target
      </button>
      <button
        type="button"
        onClick={(event) => {
          event.currentTarget.dataset.opened = String(openRecord('/projects/project-1', 'projects'));
        }}
      >
        Open another list's record
      </button>
      <button type="button" onClick={() => navigate('/companies?type=Client', { replace: true })}>
        Change list URL
      </button>
      <button type="button" onClick={() => setReady(true)}>
        List ready
      </button>
      <button type="button" onClick={() => setReady(false)}>
        List loading
      </button>
    </div>
  );
}

function CompanyDetail() {
  const { returnToList } = useListReturn({ list: 'companies' });
  const navigate = useNavigate();
  return (
    <div>
      <button type="button" onClick={() => returnToList()}>
        Return to companies
      </button>
      <button type="button" onClick={() => navigate(-1)}>
        Browser Back
      </button>
    </div>
  );
}

function SalesPipelinePage() {
  const location = useLocation();
  const [ready, setReady] = useState(!location.state?.pmoListScrollRestore);
  const { openRecord } = useListReturn({ list: 'sales', contentReady: ready });
  return (
    <div>
      <button
        type="button"
        onClick={() => openRecord('/projects/project-1', 'projects')}
      >
        Open project
      </button>
      <button type="button" onClick={() => setReady(true)}>
        Sales ready
      </button>
    </div>
  );
}

function ProjectDetailFromSales() {
  const { returnToList } = useListReturn({ list: 'projects' });
  return (
    <div>
      <button type="button" onClick={() => returnToList('projects')}>
        Return to Projects
      </button>
      <button type="button" onClick={() => returnToList('sales')}>
        Sales Pipeline link
      </button>
    </div>
  );
}

function AppRoutes({ shell = true }: { shell?: boolean }) {
  const routes = (
    <Routes>
      <Route path="/companies" element={<CompaniesList />} />
      <Route path="/companies/:id" element={<CompanyDetail />} />
    </Routes>
  );
  return shell ? (
    <AppShell rail={null} header={null}>
      {routes}
    </AppShell>
  ) : (
    routes
  );
}

function SalesRoutes() {
  return (
    <Routes>
      <Route path="/sales" element={<SalesPipelinePage />} />
      <Route path="/projects/:id" element={<ProjectDetailFromSales />} />
    </Routes>
  );
}

function renderAt(path: string, shell = true, state?: unknown) {
  const parsed = new URL(path, 'https://local.test');
  return render(
    <MemoryRouter initialEntries={[{ pathname: parsed.pathname, search: parsed.search, state }]}>
      <AppRoutes shell={shell} />
      <LocationProbe />
    </MemoryRouter>,
  );
}

function sizeMainScroll({ scrollHeight = 1000, clientHeight = 200 } = {}) {
  const main = document.querySelector<HTMLElement>('.main-scroll');
  if (!main) return undefined;
  Object.defineProperties(main, {
    scrollHeight: { configurable: true, value: scrollHeight },
    clientHeight: { configurable: true, value: clientHeight },
  });
  return main;
}

describe('useReturnNavigate', () => {
  type ReturnTarget = Parameters<ReturnType<typeof useReturnNavigate>>[0];

  it('AC-LRC-010: accepts a plain path or a resolver-minted descriptor, never hand-built state', () => {
    const plain: ReturnTarget = '/companies';
    const minted: ReturnTarget = listReturnNavigation(undefined, 'companies');
    // @ts-expect-error a hand-built {path,state} is not a validated ListReturnNavigation.
    const forged: ReturnTarget = { path: '/companies', state: { pmoListScrollRestore: {} } };
    expect([plain, minted, forged]).toHaveLength(3);
  });
});

describe('useListReturn', () => {
  it('FR-LRC-003: captures the list URL and scroll before opening the canonical record path', () => {
    renderAt('/companies?type=Client&q=harbor&campaign=source');
    const main = sizeMainScroll();
    expect(main).not.toBeUndefined();
    main!.scrollTop = 320;

    fireEvent.click(screen.getByRole('button', { name: 'Open company' }));

    expect(screen.getByTestId('location')).toHaveAttribute('data-path', '/companies/company-1');
    const state = JSON.parse(screen.getByTestId('location').getAttribute('data-state') ?? '{}');
    expect(state.pmoListReturn).toEqual({
      list: 'companies',
      path: '/companies?type=Client&q=harbor&campaign=source',
      scrollTop: 320,
    });
    expect(screen.getByRole('button', { name: 'Return to companies' })).toBeInTheDocument();
  });

  it('AC-LRC-010: does not navigate to an external record target', () => {
    renderAt('/companies');
    fireEvent.click(screen.getByRole('button', { name: 'Open unsafe target' }));
    expect(screen.getByTestId('location')).toHaveAttribute('data-path', '/companies');
  });

  it('AC-LRC-010: does not normalize a record target that contains even an empty fragment', () => {
    renderAt('/companies');
    fireEvent.click(screen.getByRole('button', { name: 'Open target with empty fragment' }));
    expect(screen.getByTestId('location')).toHaveAttribute('data-path', '/companies');
  });

  it('AC-LRC-010: rejects control-character ids and tab/deep paths, warning in development', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    renderAt('/companies');

    fireEvent.click(screen.getByRole('button', { name: 'Open control-char target' }));
    expect(screen.getByTestId('location')).toHaveAttribute('data-path', '/companies');

    fireEvent.click(screen.getByRole('button', { name: 'Open tab target' }));
    expect(screen.getByTestId('location')).toHaveAttribute('data-path', '/companies');

    expect(spy).toHaveBeenCalled();
  });

  it('AC-LRC-010: a list that may not open another owner\'s record stays put and warns in development', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    renderAt('/companies?type=Client');

    const button = screen.getByRole('button', { name: "Open another list's record" });
    fireEvent.click(button);

    expect(button).toHaveAttribute('data-opened', 'false');
    expect(screen.getByTestId('location')).toHaveAttribute('data-path', '/companies?type=Client');
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][0]).toContain('"companies"');
    expect(spy.mock.calls[0][0]).toContain('"projects"');
  });

  it('FR-LRC-005: restores a captured source entry on native Back after the shell resets scroll to top', async () => {
    renderAt('/companies?type=Vendor');
    const main = sizeMainScroll();
    expect(main).not.toBeUndefined();
    main!.scrollTop = 460;
    const scrollTo = vi.fn((options?: ScrollToOptions) => {
      const { top } = options ?? {};
      main!.scrollTop = top ?? 0;
    });
    main!.scrollTo = scrollTo as unknown as HTMLElement['scrollTo'];

    fireEvent.click(screen.getByRole('button', { name: 'Open company' }));
    expect(main!.scrollTop).toBe(0);
    fireEvent.click(screen.getByRole('button', { name: 'Browser Back' }));

    expect(screen.getByTestId('location')).toHaveAttribute('data-path', '/companies?type=Vendor');
    await waitFor(() => expect(main!.scrollTop).toBe(460));
  });

  it('FR-LRC-005: preserves the BrowserRouter history envelope while capturing and restoring native Back', async () => {
    window.history.replaceState(null, '', '/companies?type=Vendor');
    render(
      <BrowserRouter>
        <AppRoutes />
      </BrowserRouter>,
    );
    const main = sizeMainScroll();
    expect(main).not.toBeUndefined();
    main!.scrollTop = 460;

    fireEvent.click(screen.getByRole('button', { name: 'Open company' }));
    expect(window.history.state).toMatchObject({
      idx: 1,
      usr: { pmoListReturn: { list: 'companies' } },
    });

    await act(async () => {
      window.history.back();
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    await waitFor(() => expect(window.location.pathname).toBe('/companies'));
    await waitFor(() => expect(main!.scrollTop).toBe(460));
    expect(window.history.state).toMatchObject({
      idx: 0,
      pmoListScrollConsumedFor: expect.any(String),
    });
  });

  it('FR-LRC-005: never scrolls before the list is ready and restores exactly once once it is', () => {
    vi.useFakeTimers();
    const state = {
      pmoListReturn: {
        list: 'companies',
        path: '/companies?type=Client&q=review',
        scrollTop: 900,
      },
    };
    renderAt('/companies/company-1', true, state);
    const main = sizeMainScroll({ scrollHeight: 650, clientHeight: 250 });
    expect(main).not.toBeUndefined();

    fireEvent.click(screen.getByRole('button', { name: 'Return to companies' }));
    expect(screen.getByTestId('location')).toHaveAttribute(
      'data-path',
      '/companies?type=Client&q=review',
    );
    expect(main!.scrollTop).toBe(0);

    // Still not ready: advancing the restore tick must NOT scroll — the `!ready ||` guard holds.
    act(() => {
      vi.advanceTimersByTime(0);
    });
    expect(main!.scrollTop).toBe(0);

    fireEvent.click(screen.getByRole('button', { name: 'List ready' }));
    act(() => {
      vi.advanceTimersByTime(0);
    });
    expect(main!.scrollTop).toBe(400); // 900 clamped to (650-250)

    // A subsequent loading→ready cycle must not re-restore (consumed once).
    main!.scrollTop = 17;
    fireEvent.click(screen.getByRole('button', { name: 'List loading' }));
    fireEvent.click(screen.getByRole('button', { name: 'List ready' }));
    act(() => {
      vi.advanceTimersByTime(0);
    });
    expect(main!.scrollTop).toBe(17);
  });

  it('FR-LRC-004: explicit return pushes a new entry so browser Back reaches the detail, with clean state', async () => {
    window.history.replaceState(null, '', '/companies?type=Client&q=harbor');
    render(
      <BrowserRouter>
        <AppRoutes />
      </BrowserRouter>,
    );
    const main = sizeMainScroll();
    expect(main).not.toBeUndefined();
    main!.scrollTop = 320;

    fireEvent.click(screen.getByRole('button', { name: 'Open company' }));
    await waitFor(() => expect(window.location.pathname).toBe('/companies/company-1'));
    const idxAfterOpen = (window.history.state as { idx: number }).idx;

    // Explicit return pushes (the web norm), so the index advances by exactly one.
    fireEvent.click(screen.getByRole('button', { name: 'Return to companies' }));
    await waitFor(() => expect(window.location.pathname).toBe('/companies'));
    const returnedState = window.history.state as {
      idx: number;
      usr: Record<string, unknown>;
    };
    expect(returnedState.idx).toBe(idxAfterOpen + 1);

    // The returned list entry carries the one-shot restore but never pmoListReturn.
    expect(returnedState.usr?.pmoListScrollRestore).toBeDefined();
    expect(returnedState.usr?.pmoListReturn).toBeUndefined();
    expect(window.location.search).toContain('q=harbor');

    // Browser Back now reaches the detail entry instead of appearing to do nothing.
    await act(async () => {
      window.history.back();
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    await waitFor(() => expect(window.location.pathname).toBe('/companies/company-1'));
  });

  it('AC-LRC-010: falls back to the owning index for a direct record URL without context', () => {
    renderAt('/companies/company-1');
    fireEvent.click(screen.getByRole('button', { name: 'Return to companies' }));
    expect(screen.getByTestId('location')).toHaveAttribute('data-path', '/companies');
  });

  it('FR-LRC-005: does not require a scroll element to exist for a validated explicit return', () => {
    vi.useFakeTimers();
    const state = {
      pmoListReturn: {
        list: 'companies',
        path: '/companies?type=Client',
        scrollTop: 170,
      },
    };
    renderAt('/companies/company-1', false, state);
    expect(document.querySelector('.main-scroll')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Return to companies' }));
    expect(screen.getByTestId('location')).toHaveAttribute('data-path', '/companies?type=Client');
    act(() => {
      vi.advanceTimersByTime(0);
    });
    expect(document.querySelector('.main-scroll')).toBeNull();
  });

  function renderSalesAt(path: string) {
    const parsed = new URL(path, 'https://local.test');
    return render(
      <MemoryRouter initialEntries={[{ pathname: parsed.pathname, search: parsed.search }]}>
        <SalesRoutes />
        <LocationProbe />
      </MemoryRouter>,
    );
  }

  it('AC-LRC-010: a project opened from Sales keeps its structural return under Projects', () => {
    renderSalesAt('/sales?scope=Open&status=Leads&view=table');

    fireEvent.click(screen.getByRole('button', { name: 'Open project' }));
    expect(screen.getByTestId('location')).toHaveAttribute('data-path', '/projects/project-1');
    const openedState = JSON.parse(screen.getByTestId('location').getAttribute('data-state') ?? '{}');
    expect(openedState.pmoListReturn).toMatchObject({
      list: 'sales',
      path: '/sales?scope=Open&status=Leads&view=table',
    });

    // BackBar/breadcrumb owner is Projects: Sales context is not its owning list, so it goes home.
    fireEvent.click(screen.getByRole('button', { name: 'Return to Projects' }));
    expect(screen.getByTestId('location')).toHaveAttribute('data-path', '/projects');
    const returnedState = JSON.parse(
      screen.getByTestId('location').getAttribute('data-state') ?? '{}',
    );
    expect(returnedState.pmoListReturn).toBeUndefined();
    expect(returnedState.pmoListScrollRestore).toBeUndefined();
  });

  it('FR-LRC-006: the project\'s Sales Pipeline link returns to the captured Sales working set', () => {
    renderSalesAt('/sales?scope=Needs+attention&status=Leads&q=harbor&view=table');

    fireEvent.click(screen.getByRole('button', { name: 'Open project' }));
    expect(screen.getByTestId('location')).toHaveAttribute('data-path', '/projects/project-1');

    fireEvent.click(screen.getByRole('button', { name: 'Sales Pipeline link' }));
    expect(screen.getByTestId('location')).toHaveAttribute(
      'data-path',
      '/sales?scope=Needs+attention&status=Leads&q=harbor&view=table',
    );
  });

  it('AC-LRC-010: returnToList ignores tampered router state and falls back to the owning index', () => {
    for (const pmoListReturn of [
      { list: 'companies', path: 'https://outside.example/companies' },
      { list: 'companies', path: '//outside.example/companies' },
      { list: 'companies', path: '/contacts?company=evil' },
      { list: 'contacts', path: '/contacts' },
      { list: 'sales', path: '/sales?scope=Lost' },
      { list: 'companies', path: '/companies#top' },
      'not-a-record',
    ]) {
      const view = renderAt('/companies/company-1', false, { pmoListReturn, focusId: 'row-2' });
      fireEvent.click(screen.getByRole('button', { name: 'Return to companies' }));
      const location = screen.getByTestId('location');
      expect(location, JSON.stringify(pmoListReturn)).toHaveAttribute('data-path', '/companies');
      const state = JSON.parse(location.getAttribute('data-state') ?? '{}');
      expect(state).toEqual({ focusId: 'row-2' });
      view.unmount();
    }
  });

  it('FR-LRC-005: ignores stale entry keys and URLs even when the list is ready', () => {
    vi.useFakeTimers();
    renderAt('/companies?type=Client');
    const main = sizeMainScroll();
    expect(main).not.toBeUndefined();
    const locationKey = screen.getByTestId('location').getAttribute('data-key');
    expect(locationKey).toBeTruthy();
    window.history.replaceState(
      {
        [LIST_ENTRY_SCROLL_STATE_KEY]: {
          locationKey: 'old_entry',
          path: '/companies?type=Client',
          scrollTop: 170,
        },
      },
      '',
    );
    main!.scrollTop = 0;
    fireEvent.click(screen.getByRole('button', { name: 'List loading' }));
    fireEvent.click(screen.getByRole('button', { name: 'List ready' }));
    act(() => {
      vi.advanceTimersByTime(0);
    });
    expect(main!.scrollTop).toBe(0);

    window.history.replaceState(
      {
        [LIST_ENTRY_SCROLL_STATE_KEY]: {
          locationKey,
          path: '/companies?type=Vendor',
          scrollTop: 170,
        },
      },
      '',
    );
    fireEvent.click(screen.getByRole('button', { name: 'List loading' }));
    fireEvent.click(screen.getByRole('button', { name: 'List ready' }));
    act(() => {
      vi.advanceTimersByTime(0);
    });
    expect(main!.scrollTop).toBe(0);
  });
});