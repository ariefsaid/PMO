import React, { useState } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BrowserRouter, MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router';
import { AppShell } from '@/src/components/shell/AppShell';
import { LIST_ENTRY_SCROLL_STATE_KEY, useListReturn } from './useListReturn';

beforeEach(() => {
  window.history.replaceState(null, '');
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
  const { openRecord } = useListReturn({ list: 'companies', ready });
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

describe('useListReturn', () => {
  it('captures the list URL and scroll before opening the canonical record path', () => {
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
      sourceLocationKey: expect.any(String),
    });
    expect(screen.getByRole('button', { name: 'Return to companies' })).toBeInTheDocument();
  });

  it('does not navigate to an external record target', () => {
    renderAt('/companies');
    fireEvent.click(screen.getByRole('button', { name: 'Open unsafe target' }));
    expect(screen.getByTestId('location')).toHaveAttribute('data-path', '/companies');
  });

  it('does not normalize a record target that contains even an empty fragment', () => {
    renderAt('/companies');
    fireEvent.click(screen.getByRole('button', { name: 'Open target with empty fragment' }));
    expect(screen.getByTestId('location')).toHaveAttribute('data-path', '/companies');
  });

  it('restores a captured source entry on native Back after the shell resets scroll to top', async () => {
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

  it('preserves the BrowserRouter history envelope while capturing and restoring native Back', async () => {
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

  it('waits for list readiness, clamps an explicit return offset, and uses the validated path', async () => {
    const state = {
      pmoListReturn: {
        list: 'companies',
        path: '/companies?type=Client&q=review',
        scrollTop: 900,
        sourceLocationKey: 'source_1',
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

    fireEvent.click(screen.getByRole('button', { name: 'List ready' }));
    await waitFor(() => expect(main!.scrollTop).toBe(400));

    main!.scrollTop = 17;
    fireEvent.click(screen.getByRole('button', { name: 'List loading' }));
    fireEvent.click(screen.getByRole('button', { name: 'List ready' }));
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(main!.scrollTop).toBe(17);
  });

  it('falls back to the owning index for a direct record URL without context', () => {
    renderAt('/companies/company-1');
    fireEvent.click(screen.getByRole('button', { name: 'Return to companies' }));
    expect(screen.getByTestId('location')).toHaveAttribute('data-path', '/companies');
  });

  it('does not require a scroll element to exist for a validated explicit return', async () => {
    const state = {
      pmoListReturn: {
        list: 'companies',
        path: '/companies?type=Client',
        scrollTop: 170,
        sourceLocationKey: 'source_1',
      },
    };
    renderAt('/companies/company-1', false, state);
    expect(document.querySelector('.main-scroll')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Return to companies' }));
    expect(screen.getByTestId('location')).toHaveAttribute('data-path', '/companies?type=Client');
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(document.querySelector('.main-scroll')).toBeNull();
  });

  it('ignores stale entry keys and URLs even when the list is ready', async () => {
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
    await new Promise((resolve) => setTimeout(resolve, 10));
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
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(main!.scrollTop).toBe(0);
  });
});
