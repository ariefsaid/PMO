import React from 'react';
import { act, render } from '@testing-library/react';
import { MemoryRouter, useNavigate } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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

const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 5)); });

describe('useRouteFirstData', () => {
  beforeEach(() => capture.mockClear());

  it('emits once per navigation with route pattern, never the URL; first is cold, later warm', async () => {
    mount();
    await flush();
    await flush();
    expect(capture).toHaveBeenCalledTimes(1);
    const [name, props] = capture.mock.calls[0];
    expect(name).toBe('route_first_data');
    expect(props).toMatchObject({ route: '/projects/:projectId', temperature: 'cold' });
    expect(typeof props.duration_ms).toBe('number');
    expect(JSON.stringify(props)).not.toMatch(/9f1c2e3a|secret|token/);

    act(() => nav('/companies?x=1'));
    await flush();
    expect(capture).toHaveBeenCalledTimes(2);
    expect(capture.mock.calls[1][1]).toMatchObject({ route: '/companies', temperature: 'warm' });
  });

  it('waits for in-flight queries before emitting', async () => {
    const client = new QueryClient();
    let release!: () => void;
    void client.fetchQuery({ queryKey: ['slow'], queryFn: () => new Promise<number>((r) => { release = () => r(1); }) });
    mount(client);
    await flush();
    expect(capture).not.toHaveBeenCalled();
    release();
    await flush();
    expect(capture).toHaveBeenCalledTimes(1);
  });
});
