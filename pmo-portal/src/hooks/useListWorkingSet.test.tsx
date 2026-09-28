// @vitest-environment jsdom
import React, { useEffect } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { BrowserRouter, MemoryRouter, useLocation } from 'react-router';
import {
  useListWorkingSet,
  useUrlSearchInput,
  type UseListWorkingSetOptions,
} from './useListWorkingSet';
import { readProjectView, writeProjectView } from './useProjectView';

/** Every distinct router location key seen, in order: one entry per navigate/replace. */
let seenKeys: string[] = [];

beforeEach(() => {
  window.history.replaceState(null, '');
  sessionStorage.clear();
  seenKeys = [];
});

function LocationProbe() {
  const location = useLocation();
  useEffect(() => {
    seenKeys.push(location.key);
  }, [location.key]);
  return (
    <output
      data-testid="location"
      data-path={`${location.pathname}${location.search}`}
      data-key={location.key}
      data-state={JSON.stringify(location.state ?? null)}
    />
  );
}

/** Let effects and any follow-up replace settle (a loop would keep adding keys meanwhile). */
async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 30));
  });
}

function currentPath() {
  return screen.getByTestId('location').getAttribute('data-path');
}

function ProjectsHost({ options }: { options?: UseListWorkingSetOptions }) {
  const { workingSet, setWorkingSet } = useListWorkingSet('projects', options);
  return (
    <div>
      <output data-testid="ws" data-json={JSON.stringify(workingSet)} />
      <button
        type="button"
        onClick={() => setWorkingSet((prev) => ({ ...prev, q: 'sea' }))}
      >
        Set q
      </button>
      <button
        type="button"
        onClick={() => setWorkingSet((prev) => ({ ...prev, filter: 'Ongoing' }))}
      >
        Set filter
      </button>
      <button
        type="button"
        onClick={() => setWorkingSet((prev) => ({ ...prev, view: 'calendar' }))}
      >
        Set view
      </button>
      <button
        type="button"
        onClick={() => setWorkingSet((prev) => ({ ...prev, view: 'table' }))}
      >
        Set table view
      </button>
    </div>
  );
}

function tree(options?: UseListWorkingSetOptions) {
  return (
    <BrowserRouter>
      <ProjectsHost options={options} />
      <LocationProbe />
    </BrowserRouter>
  );
}

function renderAt(path: string, options?: UseListWorkingSetOptions) {
  window.history.replaceState(null, '', path);
  return render(tree(options));
}

function workingSet() {
  const el = screen.getByTestId('ws');
  return JSON.parse(el.getAttribute('data-json') ?? '{}') as Record<string, unknown>;
}

describe('useListWorkingSet — Projects', () => {
  it('AC-LRC-001: setter calls replace rather than push, so the browser entry index does not grow', async () => {
    renderAt('/projects');
    const idx0 = (window.history.state as { idx?: number } | null)?.idx;

    fireEvent.click(screen.getByRole('button', { name: 'Set q' }));
    fireEvent.click(screen.getByRole('button', { name: 'Set filter' }));
    fireEvent.click(screen.getByRole('button', { name: 'Set view' }));

    await waitFor(() =>
      expect(screen.getByTestId('location').getAttribute('data-path')).toContain('view=calendar'),
    );
    expect((window.history.state as { idx?: number } | null)?.idx).toBe(idx0);
    expect(workingSet()).toMatchObject({ q: 'sea', filter: 'Ongoing', view: 'calendar' });
  });

  it('AC-LRC-001: preserves unrelated query keys across setter writes', async () => {
    renderAt('/projects?campaign=summer&source=dashboard');
    fireEvent.click(screen.getByRole('button', { name: 'Set q' }));
    await waitFor(() =>
      expect(screen.getByTestId('location').getAttribute('data-path')).toContain('q=sea'),
    );
    const path = screen.getByTestId('location').getAttribute('data-path');
    expect(path).toContain('campaign=summer');
    expect(path).toContain('source=dashboard');
    expect(workingSet()).toMatchObject({ q: 'sea' });
  });

  it('AC-LRC-001: materializes a nondefault session view into the URL with exactly one replace', async () => {
    writeProjectView('calendar');
    expect(readProjectView()).toBe('calendar');
    renderAt('/projects?filter=at-risk', { sessionView: readProjectView() });

    await waitFor(() => expect(currentPath()).toContain('view=calendar'));
    await settle();
    expect(currentPath()).toBe('/projects?filter=at-risk&view=calendar');
    expect(workingSet()).toMatchObject({ filter: 'at-risk', view: 'calendar' });
    // Initial entry + the single materializing replace; no loop, no second write.
    expect(seenKeys).toHaveLength(2);
  });

  it('AC-LRC-002: an already-settled URL causes no replace at all on mount', async () => {
    renderAt('/projects?filter=at-risk&q=harbor');
    await settle();
    expect(currentPath()).toBe('/projects?filter=at-risk&q=harbor');
    expect(seenKeys).toHaveLength(1);
  });

  it('AC-LRC-002: keeps an Engineer\'s explicit My Projects drill filter even though it equals the default', async () => {
    renderAt('/projects?filter=My+Projects', { projectsDefaultFilter: 'My Projects' });
    await settle();
    expect(currentPath()).toBe('/projects?filter=My+Projects');
    expect(workingSet()).toMatchObject({ filter: 'My Projects' });
    expect(seenKeys).toHaveLength(1);
  });

  it('AC-LRC-002: writes nothing before role defaults are ready, so a late Engineer default keeps ?filter=All', async () => {
    writeProjectView('calendar');
    const view = renderAt('/projects?filter=All', {
      defaultsReady: false,
      sessionView: readProjectView(),
    });
    await settle();
    expect(currentPath()).toBe('/projects?filter=All');
    expect(seenKeys).toHaveLength(1);

    view.rerender(
      tree({
        defaultsReady: true,
        projectsDefaultFilter: 'My Projects',
        sessionView: readProjectView(),
      }),
    );
    await waitFor(() => expect(currentPath()).toContain('view=calendar'));
    await settle();
    expect(currentPath()).toBe('/projects?filter=All&view=calendar');
    expect(workingSet()).toMatchObject({ filter: 'All', view: 'calendar' });
  });

  it('AC-LRC-002: does not overwrite an explicit URL view, even an invalid one, with the session view', async () => {
    writeProjectView('calendar');
    renderAt('/projects?view=map', { sessionView: readProjectView() });
    await settle();
    expect(currentPath()).toBe('/projects?view=map');
    expect(workingSet()).toMatchObject({ view: 'table' });
    expect(seenKeys).toHaveLength(1);
  });

  it('AC-LRC-001: choosing the default view over a nondefault session view sticks instead of snapping back', async () => {
    writeProjectView('calendar');
    renderAt('/projects', { sessionView: readProjectView() });
    await waitFor(() => expect(currentPath()).toBe('/projects?view=calendar'));

    fireEvent.click(screen.getByRole('button', { name: 'Set table view' }));
    await settle();
    expect(currentPath()).toBe('/projects?view=table');
    expect(workingSet()).toMatchObject({ view: 'table' });
  });

  // This pins state preservation only. A restore still applies only when its path equals the
  // list URL exactly (useListReturn), so this restore, captured before the view was added, would
  // no longer match the materialized URL.
  it('FR-LRC-005: the materializing replace carries the existing router state forward unchanged', async () => {
    writeProjectView('calendar');
    const restore = {
      pmoListScrollRestore: { list: 'projects', path: '/projects', scrollTop: 240 },
    };
    render(
      <MemoryRouter initialEntries={[{ pathname: '/projects', search: '', state: restore }]}>
        <ProjectsHost options={{ sessionView: readProjectView() }} />
        <LocationProbe />
      </MemoryRouter>,
    );
    await waitFor(() => expect(currentPath()).toBe('/projects?view=calendar'));
    const state = JSON.parse(screen.getByTestId('location').getAttribute('data-state') ?? 'null');
    expect(state).toEqual(restore);
  });

  it('AC-LRC-002: an explicit URL view wins over the session fallback', async () => {
    writeProjectView('calendar');
    renderAt('/projects?view=kanban&campaign=winter', { sessionView: readProjectView() });

    await waitFor(() => expect(workingSet()).toMatchObject({ view: 'kanban' }));
    const path = screen.getByTestId('location').getAttribute('data-path');
    expect(path).toContain('view=kanban');
    expect(path).not.toContain('view=calendar');
    expect(path).toContain('campaign=winter');
  });
});
const SEARCH_DELAY_MS = 20;

function ProjectsSearchHost() {
  const { workingSet, setWorkingSet } = useListWorkingSet('projects');
  const [search, setSearch] = useUrlSearchInput(
    workingSet.q,
    (q) => setWorkingSet((prev) => ({ ...prev, q })),
    SEARCH_DELAY_MS,
  );
  return (
    <div>
      <input aria-label="Search projects" value={search} onChange={(e) => setSearch(e.target.value)} />
      <button type="button" onClick={() => setWorkingSet((prev) => ({ ...prev, q: '' }))}>
        Clear all
      </button>
    </div>
  );
}

function renderSearchAt(path: string) {
  window.history.replaceState(null, '', path);
  return render(
    <BrowserRouter>
      <ProjectsSearchHost />
      <LocationProbe />
    </BrowserRouter>,
  );
}

describe('useUrlSearchInput — search text over the URL working set', () => {
  it('FR-LRC-001: keeps typed text local and writes the URL with one replace after typing pauses', async () => {
    renderSearchAt('/projects?campaign=spring');
    const idx0 = (window.history.state as { idx?: number } | null)?.idx;
    const input = screen.getByRole('textbox', { name: 'Search projects' });

    for (const text of ['h', 'ha', 'har', 'harb', 'harbor']) {
      fireEvent.change(input, { target: { value: text } });
    }
    // The control shows every keystroke at once; the URL waits for the pause.
    expect(input).toHaveValue('harbor');
    expect(currentPath()).toBe('/projects?campaign=spring');

    await waitFor(() => expect(currentPath()).toBe('/projects?campaign=spring&q=harbor'));
    await settle();
    expect(input).toHaveValue('harbor');
    // Initial entry + one replacing write for the whole burst; no history entry was added.
    expect(seenKeys).toHaveLength(2);
    expect((window.history.state as { idx?: number } | null)?.idx).toBe(idx0);

    // Typing on after the URL caught up is kept, and written again after the next pause.
    fireEvent.change(input, { target: { value: 'harbor crane' } });
    expect(input).toHaveValue('harbor crane');
    await waitFor(() => expect(currentPath()).toBe('/projects?campaign=spring&q=harbor+crane'));
    expect(input).toHaveValue('harbor crane');
  });

  it('FR-LRC-001: an external URL change replaces the text and cancels a pending write', async () => {
    renderSearchAt('/projects?q=harbor');
    const input = screen.getByRole('textbox', { name: 'Search projects' });
    expect(input).toHaveValue('harbor');

    fireEvent.change(input, { target: { value: 'harbor crane' } });
    fireEvent.click(screen.getByRole('button', { name: 'Clear all' }));

    await waitFor(() => expect(input).toHaveValue(''));
    await settle();
    // The typed text that was still waiting to be written does not come back.
    expect(currentPath()).toBe('/projects');
    expect(input).toHaveValue('');
  });
});
