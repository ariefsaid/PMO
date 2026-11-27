import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { ReadState } from '../ReadState';
import { resolveReadState, type ReadQueryLike } from '../readStateModel';

function makeQuery<T>(overrides: Partial<ReadQueryLike<T>> = {}): ReadQueryLike<T> {
  return {
    data: undefined,
    isPending: false,
    isError: false,
    refetch: vi.fn(),
    ...overrides,
  };
}

describe('resolveReadState', () => {
  it('returns loading while pending with no data', () => {
    const phase = resolveReadState(makeQuery<string[]>({ isPending: true, data: undefined }));
    expect(phase).toEqual({ status: 'loading' });
  });

  it('never treats absent data as an empty list even when isPending is false', () => {
    const phase = resolveReadState(makeQuery<string[]>({ isPending: false, isError: false, data: undefined }));
    expect(phase).toEqual({ status: 'loading' });
  });

  it('returns error with retry when an initial read fails', () => {
    const refetch = vi.fn();
    const phase = resolveReadState(makeQuery<string[]>({ isError: true, data: undefined, refetch }));
    expect(phase.status).toBe('error');
    if (phase.status === 'error') {
      phase.onRetry();
      expect(refetch).toHaveBeenCalledOnce();
    }
  });

  it('returns error with retry when a refetch fails on an empty result (never shows empty copy)', () => {
    const refetch = vi.fn();
    const phase = resolveReadState(makeQuery<string[]>({ isError: true, data: [], refetch }));
    expect(phase.status).toBe('error');
    if (phase.status === 'error') {
      phase.onRetry();
      expect(refetch).toHaveBeenCalledOnce();
    }
  });

  it('keeps loaded data and exposes refreshError when a refetch fails after data loaded', () => {
    const refetch = vi.fn();
    const phase = resolveReadState(makeQuery<string[]>({ isError: true, data: ['Row A'], refetch }));
    expect(phase.status).toBe('ready');
    if (phase.status === 'ready') {
      expect(phase.data).toEqual(['Row A']);
      expect(phase.refreshError).not.toBeNull();
      phase.refreshError?.onRetry();
      expect(refetch).toHaveBeenCalledOnce();
    }
  });

  it('returns empty only on a successful empty read (array or null detail)', () => {
    expect(resolveReadState(makeQuery<string[]>({ data: [] }))).toEqual({ status: 'empty', data: [] });
    expect(resolveReadState(makeQuery<{ id: string } | null>({ data: null }))).toEqual({ status: 'empty', data: null });
  });

  it('returns ready with no refreshError on a successful non-empty read', () => {
    expect(resolveReadState(makeQuery<string[]>({ data: ['A'] }))).toEqual({
      status: 'ready',
      data: ['A'],
      refreshError: null,
    });
  });

  it('supports a custom isEmpty predicate for derived collections', () => {
    const phase = resolveReadState(makeQuery<{ items: string[] }>({ data: { items: [] } }), {
      isEmpty: (d) => d.items.length === 0,
    });
    expect(phase).toEqual({ status: 'empty', data: { items: [] } });
  });
});

describe('ReadState', () => {
  it('renders loading skeleton while pending', () => {
    render(
      <ReadState
        query={makeQuery<string[]>({ isPending: true })}
        errorTitle="Couldn't load items"
        empty={<p>Nothing here</p>}
      >
        {(rows) => <div>{rows.join(',')}</div>}
      </ReadState>,
    );
    expect(screen.getByTestId('liststate-loading')).toHaveAttribute('aria-busy', 'true');
    expect(screen.queryByText('Nothing here')).not.toBeInTheDocument();
  });

  it('renders retryable error and never empty copy on a rejected read', async () => {
    const refetch = vi.fn();
    render(
      <ReadState
        query={makeQuery<string[]>({ isError: true, data: undefined, refetch })}
        errorTitle="Couldn't load items"
        empty={<p>Nothing here</p>}
      >
        {(rows) => <div>{rows.join(',')}</div>}
      </ReadState>,
    );
    expect(screen.getByRole('alert')).toHaveTextContent("Couldn't load items");
    expect(screen.queryByText('Nothing here')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(refetch).toHaveBeenCalledOnce();
  });

  it('keeps loaded data visible alongside the retry alert when a refresh fails', async () => {
    const refetch = vi.fn();
    render(
      <ReadState
        query={makeQuery<string[]>({ isError: true, data: ['Alpha', 'Beta'], refetch })}
        errorTitle="Couldn't refresh items"
        empty={<p>Nothing here</p>}
      >
        {(rows) => <ul>{rows.map((r) => <li key={r}>{r}</li>)}</ul>}
      </ReadState>,
    );
    expect(screen.getByRole('alert')).toHaveTextContent("Couldn't refresh items");
    expect(screen.getByText('Alpha')).toBeInTheDocument();
    expect(screen.getByText('Beta')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(refetch).toHaveBeenCalledOnce();
  });

  it('renders empty copy only on a successful empty read', () => {
    render(
      <ReadState
        query={makeQuery<string[]>({ data: [] })}
        errorTitle="Couldn't load items"
        empty={<p>Nothing here</p>}
      >
        {(rows) => <div>{rows.join(',')}</div>}
      </ReadState>,
    );
    expect(screen.getByText('Nothing here')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('renders children when data is loaded and clean', () => {
    render(
      <ReadState
        query={makeQuery<string[]>({ data: ['Alpha'] })}
        errorTitle="Couldn't load items"
        empty={<p>Nothing here</p>}
      >
        {(rows) => <div>{rows.join(',')}</div>}
      </ReadState>,
    );
    expect(screen.getByText('Alpha')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByText('Nothing here')).not.toBeInTheDocument();
  });
});
