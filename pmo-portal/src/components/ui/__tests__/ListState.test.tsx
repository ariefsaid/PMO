import { describe, it, expect, expectTypeOf, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { createInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';

const analytics = vi.hoisted(() => ({ trackEmptyStateSeen: vi.fn() }));
vi.mock('@/src/lib/analytics', () => ({ trackEmptyStateSeen: analytics.trackEmptyStateSeen }));

import { ListState, type ListStateProps } from '../ListState';

describe('ListState', () => {
  it('partial: announces an incomplete result and keeps its recovery action available', async () => {
    const onLoadMore = vi.fn();
    render(
      <ListState
        variant="partial"
        title="50 loaded, more available"
        sub="Load more to see the rest."
        action={{ label: 'Load more', onClick: onLoadMore }}
      />,
    );

    expect(screen.getByRole('status')).toHaveTextContent('50 loaded, more available');
    expect(screen.getByText('Load more to see the rest.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Load more' }));
    expect(onLoadMore).toHaveBeenCalledOnce();
  });

  it('requires retry handlers for failed states and excludes them from loading and empty states', () => {
    expectTypeOf<Extract<ListStateProps, { variant: 'loading' }>['onRetry']>()
      .toBeNever();
    expectTypeOf<Extract<ListStateProps, { variant: 'empty' }>['onRetry']>()
      .toBeNever();
    expectTypeOf<Extract<ListStateProps, { variant: 'error' }>['onRetry']>()
      .toEqualTypeOf<() => void>();
    // @ts-expect-error a failed state must identify the read this retry recovers
    const failedReadWithoutRetry: ListStateProps = { variant: 'error', title: 'Could not load' };
    void failedReadWithoutRetry;
  });

  it('loading: renders skeleton rows + aria-busy', () => {
    render(<ListState variant="loading" />);
    const region = screen.getByTestId('liststate-loading');
    expect(region).toHaveAttribute('aria-busy', 'true');
    expect(region.querySelectorAll('.skel').length).toBeGreaterThan(0);
  });

  it('loading renders while the locale provider is not initialized yet', () => {
    const uninitializedI18n = createInstance();
    render(
      <I18nextProvider i18n={uninitializedI18n}>
        <React.Suspense fallback={<div data-testid="i18n-suspended">Waiting for locale</div>}>
          <ListState
            variant="loading"
            loadingRole="status"
            loadingAriaLabel="Authenticating…"
            loadingLabel="Authenticating…"
          />
        </React.Suspense>
      </I18nextProvider>,
    );

    expect(screen.queryByTestId('i18n-suspended')).not.toBeInTheDocument();
    expect(screen.getByRole('status', { name: 'Authenticating…' })).toHaveAttribute('aria-busy', 'true');
  });

  it('loading: testId prop overrides the default liststate-loading testid', () => {
    render(<ListState variant="loading" testId="milestone-strip-skeleton" />);
    expect(screen.getByTestId('milestone-strip-skeleton')).toHaveAttribute('aria-busy', 'true');
    expect(screen.queryByTestId('liststate-loading')).toBeNull();
  });

  it.each(['lines', 'table', 'cards', 'detail', 'chart'] as const)(
    'loading shape=%s keeps its busy announcement',
    (shape) => {
      render(<ListState variant="loading" shape={shape} />);
      const region = screen.getByTestId('liststate-loading');
      expect(region).toHaveAttribute('aria-busy', 'true');
      expect(region).toHaveAttribute('aria-live', 'polite');
      expect(screen.getByText('Loading…')).toBeInTheDocument();
    },
  );

  it('loadingRole=status keeps one busy status region that announces its loading copy', () => {
    render(
      <ListState
        variant="loading"
        shape="cards"
        loadingLabel="Loading files…"
        loadingRole="status"
      />,
    );
    const status = screen.getByRole('status');
    expect(status).toHaveAttribute('aria-busy', 'true');
    expect(status).toHaveTextContent('Loading files…');
    expect(status).toHaveAttribute('aria-live', 'polite');
  });

  it('loadingAriaLabel preserves an explicit status name while retaining the loading copy', () => {
    render(
      <ListState
        variant="loading"
        loadingLabel="Loading…"
        loadingRole="status"
        loadingAriaLabel="Authenticating…"
      />,
    );
    expect(screen.getByRole('status', { name: 'Authenticating…' })).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByText('Loading…')).toBeInTheDocument();
  });

  it('loading: loadingLabel replaces the announced copy for page/section loads', () => {
    render(<ListState variant="loading" loadingLabel="Loading project finances…" />);
    expect(screen.getByText('Loading project finances…')).toBeInTheDocument();
  });

  it('empty: renders icon tile, title, sub, and a LIVE (never disabled) populating action', async () => {
    const onAction = vi.fn();
    render(
      <ListState
        variant="empty"
        title="No projects yet"
        sub="Create your first project to get started."
        action={{ label: 'Clear filters', onClick: onAction }}
      />
    );
    expect(screen.getByText('No projects yet')).toBeInTheDocument();
    expect(screen.getByText('Create your first project to get started.')).toBeInTheDocument();
    const btn = screen.getByRole('button', { name: 'Clear filters' });
    // E5: the empty-state action is always a live button — the disabled-CTA
    // anti-pattern can no longer be expressed (disabled/disabledTitle removed).
    expect(btn).not.toBeDisabled();
    await userEvent.click(btn);
    expect(onAction).toHaveBeenCalled();
  });

  it('empty: renders no action button when no action is supplied (teaching-only empty)', () => {
    render(<ListState variant="empty" title="No projects yet" sub="They will appear here." />);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('error: role=alert, destructive title, and a Retry that calls onRetry', async () => {
    const onRetry = vi.fn();
    render(
      <ListState
        variant="error"
        title="Could not load projects"
        sub="Check your connection and try again."
        onRetry={onRetry}
      />
    );
    const alert = screen.getByRole('alert');
    expect(alert).toBeInTheDocument();
    expect(screen.getByText('Could not load projects')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(onRetry).toHaveBeenCalled();
  });

  it('C1: an error object is not rendered in the error body', () => {
    const rawError = new Error('database response detail must stay internal');
    render(
      <ListState
        variant="error"
        title="Could not load projects"
        sub={rawError as unknown as React.ReactNode}
        onRetry={() => undefined}
      />,
    );

    expect(screen.getByRole('alert')).toHaveTextContent('Could not load projects');
    expect(screen.queryByText(rawError.message)).not.toBeInTheDocument();
  });

  it('error: headline uses the AA destructive-text token class, no inline hard-coded colour (dark-mode contrast)', () => {
    render(<ListState variant="error" title="Could not load projects" onRetry={() => undefined} />);
    const headline = screen.getByText('Could not load projects');
    expect(headline).toHaveClass('text-destructive-text');
    expect(headline.getAttribute('style') ?? '').not.toMatch(/color|hsl/i);
  });
});

describe('ListState: empty_state_seen analytics (2026-07-13 wiring plan)', () => {
  beforeEach(() => {
    analytics.trackEmptyStateSeen.mockClear();
  });

  it('fires empty_state_seen via the lazy facade on mount when stateId+role+module are all given', async () => {
    render(
      <ListState
        variant="empty"
        title="No companies yet"
        stateId="companies-empty"
        role="Admin"
        module="companies"
      />
    );
    await waitFor(() => {
      expect(analytics.trackEmptyStateSeen).toHaveBeenCalledWith('companies-empty', 'Admin', 'companies');
      expect(analytics.trackEmptyStateSeen).toHaveBeenCalledTimes(1);
    });
  });

  it('does NOT fire empty_state_seen when stateId/role/module are omitted (opt-in tracking)', () => {
    render(<ListState variant="empty" title="No companies yet" />);
    expect(analytics.trackEmptyStateSeen).not.toHaveBeenCalled();
  });

  it('does NOT fire empty_state_seen for the loading or error variants', () => {
    render(<ListState variant="loading" />);
    render(
      <ListState
        variant="error"
        title="Couldn't load"
        onRetry={() => undefined}
        stateId="companies-error"
        role="Admin"
        module="companies"
      />
    );
    expect(analytics.trackEmptyStateSeen).not.toHaveBeenCalled();
  });

  it('O18: an error that is the whole page can carry the level-one heading', () => {
    render(<ListState variant="error" titleAsPageHeading title="Couldn't load this project" onRetry={() => undefined} />);
    expect(screen.getByRole('heading', { level: 1, name: "Couldn't load this project" })).toBeInTheDocument();
  });
});
