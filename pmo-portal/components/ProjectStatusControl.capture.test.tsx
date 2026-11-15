import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { ToastProvider } from '@/src/components/ui';

const mockMutate = vi.fn();
const mockMutateAsync = vi.fn();
const mockMutationState = vi.hoisted(() => ({ error: null as unknown }));
const trackSaveFailed = vi.hoisted(() => vi.fn());

vi.mock('@/src/lib/analytics', async (orig) => ({ ...(await orig<object>()), trackSaveFailed }));
vi.mock('@/src/auth/impersonation', () => ({
  useEffectiveRole: vi.fn(() => ({ effectiveRole: 'Project Manager', realRole: 'Project Manager', canImpersonate: false, viewAs: vi.fn() })),
}));
vi.mock('@/src/hooks/useProjectTransitions', () => ({
  useProjectWinEligibility: () => ({ data: 'allowed', isFetching: false, isError: false }),
  useProjectTransition: () => ({
    mutate: mockMutate,
    mutateAsync: mockMutateAsync,
    isError: mockMutationState.error !== null,
    error: mockMutationState.error,
    isPending: false,
  }),
}));

import ProjectStatusControl from './ProjectStatusControl';

const project = { id: 'proj-1', status: 'Negotiation' as const, customer_contract_ref: null as string | null };

const failWith = (message: string, code?: string) => {
  const err = Object.assign(new Error(message), code ? { code } : {});
  // The query client exposes the error only once the call has rejected, as in the app.
  mockMutateAsync.mockImplementation(async () => { mockMutationState.error = err; throw err; });
};

const attempt = async () => {
  const user = userEvent.setup();
  render(<ToastProvider><ProjectStatusControl project={project} /></ToastProvider>);
  await user.click(screen.getByRole('button', { name: /change status/i }));
  await user.click(screen.getByRole('button', { name: /Tender Submitted/i }));
  await user.click(screen.getByRole('button', { name: /Move to Tender Submitted/i }));
};

beforeEach(() => {
  vi.clearAllMocks();
  mockMutationState.error = null;
});

describe('ProjectStatusControl failure capture (#1682 review F1)', () => {
  it('one failed change logs exactly one save_failed, under the projects module', async () => {
    failWith('illegal transition A -> B', 'P0001');
    await attempt();
    await waitFor(() => expect(screen.getAllByRole('alert').length).toBeGreaterThan(0));
    expect(trackSaveFailed).toHaveBeenCalledTimes(1);
    expect(trackSaveFailed.mock.calls[0][3]).toBe('projects');
  });
});

describe('ProjectStatusControl server refusals (#1684 review F3)', () => {
  it('a known refusal shows the translated sentence, not the server English', async () => {
    failWith('the note is limited to 500 characters', 'P0001');
    await attempt();
    const alerts = await screen.findAllByRole('alert');
    expect(alerts.map(a => a.textContent).join('|')).toContain('The note is limited to 500 characters.');
  });

  it('unknown server text falls back to the generic sentence, never raw', async () => {
    failWith('some brand new server refusal', 'P0001');
    await attempt();
    const text = (await screen.findAllByRole('alert')).map(a => a.textContent).join('|');
    expect(text).toMatch(/could not be changed/i);
    expect(text).not.toMatch(/brand new server refusal/);
  });
});
