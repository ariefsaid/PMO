import React from 'react';
import { act, render } from '@testing-library/react';
import { MemoryRouter, useNavigate } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const capture = vi.fn();
vi.mock('./client', () => ({ analyticsClient: { capture: (...a: unknown[]) => capture(...a) } }));

import { useRouteFirstData } from './useRouteFirstData';

let nav: (to: string) => void;
const Probe: React.FC = () => {
  useRouteFirstData();
  nav = useNavigate();
  return null;
};

const mount = (client = new QueryClient()) =>
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/projects/9f1c2e3a-1111-2222-3333-444455556666?token=secret']}>
        <Probe />
      </MemoryRouter>
    </QueryClientProvider>,
  );

const advance = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });
const pending = (client: QueryClient, key: string) => {
  let release!: () => void;
  void client.fetchQuery({ queryKey: [key], queryFn: () => new Promise<number>((r) => { release = () => r(1); }) });
  return () => release();
};

describe('useRouteFirstData', () => {
  beforeEach(() => { vi.useFakeTimers(); capture.mockClear(); });
  afterEach(() => vi.useRealTimers());

  it('emits once per navigation with route pattern, never the URL; first is cold, later warm', async () => {
    mount();
    await advance(400);
    await advance(400);
    expect(capture).toHaveBeenCalledTimes(1);
    const [name, props] = capture.mock.calls[0];
    expect(name).toBe('route_first_data');
    expect(props).toMatchObject({ route: '/projects/:projectId', temperature: 'cold' });
    expect(typeof props.duration_ms).toBe('number');
    expect(JSON.stringify(props)).not.toMatch(/9f1c2e3a|secret|token/);

    act(() => nav('/companies?x=1'));
    await advance(400);
    expect(capture).toHaveBeenCalledTimes(2);
    expect(capture.mock.calls[1][1]).toMatchObject({ route: '/companies', temperature: 'warm' });
  });

  it('does not settle on the first tick when nothing has fetched yet (idle window)', async () => {
    mount();
    await advance(10);
    expect(capture).not.toHaveBeenCalled();
    await advance(300);
    expect(capture).toHaveBeenCalledTimes(1);
    expect(capture.mock.calls[0][1].duration_ms).toBeGreaterThanOrEqual(300);
  });

  it('a late-starting query (after the first tick) is waited for, not reported as ~0 ms', async () => {
    const client = new QueryClient();
    mount(client);
    await advance(100);
    const release = pending(client, 'late');
    await advance(500);
    expect(capture).not.toHaveBeenCalled();
    release();
    await advance(1);
    expect(capture).toHaveBeenCalledTimes(1);
    expect(capture.mock.calls[0][1].duration_ms).toBeGreaterThanOrEqual(600);
  });

  it('waits for in-flight queries, then emits exactly once despite query churn', async () => {
    const client = new QueryClient();
    const release = pending(client, 'slow');
    mount(client);
    await advance(400);
    expect(capture).not.toHaveBeenCalled();
    release();
    await advance(1);
    for (let i = 0; i < 5; i++) await client.fetchQuery({ queryKey: ['churn', i], queryFn: async () => i });
    await advance(1000);
    expect(capture).toHaveBeenCalledTimes(1);
    expect(capture.mock.calls[0][1].timed_out).toBeUndefined();
  });

  it('never settles: sent with timed_out at the 15 s cap, once', async () => {
    const client = new QueryClient();
    pending(client, 'hung');
    mount(client);
    await advance(14_000);
    expect(capture).not.toHaveBeenCalled();
    await advance(1_500);
    await advance(20_000);
    expect(capture).toHaveBeenCalledTimes(1);
    expect(capture.mock.calls[0][1]).toMatchObject({ timed_out: true, duration_ms: 15_000 });
  });

  it('navigating away unsettled sends abandoned with elapsed ms; no double event on rapid navigation', async () => {
    const client = new QueryClient();
    pending(client, 'hung');
    mount(client);
    await advance(2_000);
    act(() => nav('/companies'));
    act(() => nav('/projects'));
    expect(capture).toHaveBeenCalledTimes(2);
    expect(capture.mock.calls[0][1]).toMatchObject({ route: '/projects/:projectId', abandoned: true, duration_ms: 2_000 });
    expect(capture.mock.calls[1][1]).toMatchObject({ route: '/companies', abandoned: true });
    await advance(20_000);
    // hung query still blocks /projects: it times out once, nothing else leaks
    expect(capture).toHaveBeenCalledTimes(3);
    expect(capture.mock.calls[2][1]).toMatchObject({ route: '/projects', timed_out: true });
  });

  it('settled navigation sends no abandoned event on leave', async () => {
    mount();
    await advance(400);
    act(() => nav('/companies'));
    expect(capture).toHaveBeenCalledTimes(1);
  });
});
