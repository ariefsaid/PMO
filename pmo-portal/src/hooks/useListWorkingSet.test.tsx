// @vitest-environment jsdom
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { BrowserRouter, useLocation } from 'react-router';
import { useListWorkingSet, type UseListWorkingSetOptions } from './useListWorkingSet';
import { readProjectView, writeProjectView } from './useProjectView';

beforeEach(() => {
  window.history.replaceState(null, '');
  sessionStorage.clear();
});

function LocationProbe() {
  const location = useLocation();
  return (
    <output
      data-testid="location"
      data-path={`${location.pathname}${location.search}`}
      data-key={location.key}
    />
  );
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
    </div>
  );
}

function renderAt(path: string, options?: UseListWorkingSetOptions) {
  window.history.replaceState(null, '', path);
  return render(
    <BrowserRouter>
      <ProjectsHost options={options} />
      <LocationProbe />
    </BrowserRouter>,
  );
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

  it('AC-LRC-002: materializes a nondefault session view into the URL once without a replace loop', async () => {
    writeProjectView('calendar');
    expect(readProjectView()).toBe('calendar');
    renderAt('/projects?filter=at-risk', { sessionView: readProjectView() });

    await waitFor(() =>
      expect(screen.getByTestId('location').getAttribute('data-path')).toContain('view=calendar'),
    );
    const idx = (window.history.state as { idx?: number } | null)?.idx;
    const first = screen.getByTestId('location').getAttribute('data-path') ?? '';
    const occurrences = first.match(/view=calendar/g)?.length ?? 0;
    // The session view is materialized once; the replace is not a loop.
    expect(occurrences).toBe(1);
    expect(workingSet()).toMatchObject({ filter: 'at-risk', view: 'calendar' });
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect((window.history.state as { idx?: number } | null)?.idx).toBe(idx);
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