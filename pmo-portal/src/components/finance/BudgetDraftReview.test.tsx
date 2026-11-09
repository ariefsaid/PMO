import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ImpersonationProvider } from '@/src/auth/impersonation';

const h = vi.hoisted(() => ({
  listOrgDrafts: vi.fn(),
  getActivationMode: vi.fn(),
  precheckActivation: vi.fn(),
  activateVersion: vi.fn(),
}));
vi.mock('@/src/lib/repositories', () => ({ repositories: { budget: h } }));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 'me', org_id: 'org-1', role: 'Finance' } }) }));

import { BudgetDraftReview } from './BudgetDraftReview';
import { draftTickState } from './draftTickState';

const draft = (id: string, extra: Record<string, unknown> = {}) => ({
  id, projectId: `p-${id}`, projectCode: `PRJ-${id}`, projectName: `Project ${id}`, currency: 'IDR', version: 1, name: 'Imported',
  total: 1000, createdBy: 'u9', editorIds: ['u9'], documentUrl: null, ...extra,
});
const ready = { status: 'ready', erpCheck: 'available', fiscalYearNames: null, fiscalYears: null, issues: [] };
const unmapped = { ...ready, status: 'blocked', issues: [{ code: 'budget-category-unmapped', categories: ['Labor'] }] };

beforeEach(() => {
  vi.clearAllMocks();
  h.listOrgDrafts.mockResolvedValue([
    draft('a', { documentUrl: 'https://sp.example/a.xlsx' }),
    draft('b'),
    draft('c', { createdBy: 'me', editorIds: ['me'] }),
  ]);
  h.getActivationMode.mockImplementation(async (id: string) => (id === 'c' ? 'blocked_editor' : 'allowed'));
  h.precheckActivation.mockImplementation(async (id: string) => (id === 'b' ? unmapped : ready));
  h.activateVersion.mockResolvedValue({ pushState: 'pushed' });
});
afterEach(cleanup);

function mount() {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ImpersonationProvider realRole="Finance"><BudgetDraftReview /></ImpersonationProvider>
    </QueryClientProvider>,
  );
}
const box = (name: RegExp) => screen.getByRole('checkbox', { name });

describe('draftTickState', () => {
  const base = { mode: 'allowed' as const, precheck: ready as never, canTransition: true };
  it('AC-BAD-003 a mode that is not allowed/sole_operator is never tickable', () => {
    expect(draftTickState({ ...base, mode: 'blocked_editor' })).toBe('not-allowed');
    expect(draftTickState({ ...base, mode: 'blocked_no_drafter' })).toBe('not-allowed');
    expect(draftTickState({ ...base, canTransition: false })).toBe('not-allowed');
  });
  it('AC-BAD-002 unmapped categories and a blocked precheck are not tickable', () => {
    expect(draftTickState({ ...base, precheck: unmapped as never })).toBe('unmapped');
    expect(draftTickState({ ...base, precheck: { ...ready, status: 'blocked' } as never })).toBe('blocked');
  });
  it('AC-BAD-001 ready only when mode allows and the precheck is clean (ERP down is informational)', () => {
    expect(draftTickState(base)).toBe('ready');
    expect(draftTickState({ ...base, precheck: { ...ready, status: 'erp-unavailable' } as never })).toBe('ready');
    expect(draftTickState({ ...base, mode: 'sole_operator', canTransition: false })).toBe('ready');
    expect(draftTickState({ ...base, precheck: undefined })).toBe('checking');
  });
});

it('AC-BAD-001/002/003 lists total, mapped and source link; unmapped and SoD-blocked drafts cannot be ticked', async () => {
  mount();
  await screen.findByText(/Project a/);
  await waitFor(() => expect(box(/Project a/)).not.toHaveAttribute('aria-disabled'));
  expect(screen.getByRole('link', { name: 'Open' })).toHaveAttribute('href', 'https://sp.example/a.xlsx');
  expect(box(/Project b/)).toHaveAttribute('aria-disabled','true');
  expect(box(/Project c/)).toHaveAttribute('aria-disabled','true');
  expect(screen.getByText('Map the budget categories first')).toBeInTheDocument();
  expect(screen.getByText('Someone else must activate this draft')).toBeInTheDocument();
  expect(screen.getByText('No')).toBeInTheDocument();
});

it('AC-BAD-004/006 one confirm with the count; nothing activates before it; only the ticked draft does', async () => {
  mount();
  await waitFor(() => expect(box(/Project a/)).not.toHaveAttribute('aria-disabled'));
  expect(screen.getByRole('button', { name: /Activate selected \(0\)/ })).toBeDisabled();
  fireEvent.click(box(/Project a/));
  fireEvent.click(screen.getByRole('button', { name: /Activate selected \(1\)/ }));
  const dialog = await screen.findByRole('dialog');
  expect(dialog).toHaveTextContent('Activate 1 draft budgets?');
  expect(dialog).not.toHaveTextContent('only person');
  expect(h.activateVersion).not.toHaveBeenCalled();
  fireEvent.click(within(dialog).getByRole('button', { name: /Activate 1 drafts/ }));
  await waitFor(() => expect(h.activateVersion).toHaveBeenCalledTimes(1));
  expect(h.activateVersion).toHaveBeenCalledWith('a');
  expect(await screen.findByText('1 activated, 0 failed')).toBeInTheDocument();
});

it('AC-BAD-004 cancel activates nothing', async () => {
  mount();
  await waitFor(() => expect(box(/Project a/)).not.toHaveAttribute('aria-disabled'));
  fireEvent.click(box(/Project a/));
  fireEvent.click(screen.getByRole('button', { name: /Activate selected/ }));
  fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Cancel' }));
  expect(h.activateVersion).not.toHaveBeenCalled();
});

it('AC-BAD-005 the sole-operator wording appears only when a selected draft is in sole-operator mode', async () => {
  h.getActivationMode.mockResolvedValue('sole_operator');
  h.listOrgDrafts.mockResolvedValue([draft('a', { createdBy: 'me', editorIds: ['me'] })]);
  mount();
  await waitFor(() => expect(box(/Project a/)).not.toHaveAttribute('aria-disabled'));
  fireEvent.click(box(/Project a/));
  fireEvent.click(screen.getByRole('button', { name: /Activate selected/ }));
  expect(await screen.findByRole('dialog')).toHaveTextContent("You're the only person in this organisation");
});

it('AC-BAD-007 a refused draft shows its own failure; the others still activate, in order', async () => {
  h.listOrgDrafts.mockResolvedValue([draft('a'), draft('d'), draft('e')]);
  h.activateVersion.mockImplementation(async (id: string) => {
    if (id === 'd') throw new Error('only a Draft version can be activated');
    return { pushState: 'pushed' };
  });
  mount();
  await waitFor(() => expect(box(/Project e/)).not.toHaveAttribute('aria-disabled'));
  for (const n of [/Project a/, /Project d/, /Project e/]) fireEvent.click(box(n));
  fireEvent.click(screen.getByRole('button', { name: /Activate selected \(3\)/ }));
  fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: /Activate 3 drafts/ }));
  expect(await screen.findByText('2 activated, 1 failed')).toBeInTheDocument();
  expect(h.activateVersion.mock.calls.map((c) => c[0])).toEqual(['a', 'd', 'e']);
  expect(screen.getByText('only a Draft version can be activated')).toBeInTheDocument();
});

it('AC-BAD-007 an activation whose ERP push failed is counted and flagged, not reported as plain success', async () => {
  h.listOrgDrafts.mockResolvedValue([draft('a'), draft('e')]);
  h.activateVersion.mockImplementation(async (id: string) => ({ pushState: id === 'a' ? 'failed' : 'pushed' }));
  mount();
  await waitFor(() => expect(box(/Project e/)).not.toHaveAttribute('aria-disabled'));
  for (const n of [/Project a/, /Project e/]) fireEvent.click(box(n));
  fireEvent.click(screen.getByRole('button', { name: /Activate selected \(2\)/ }));
  fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: /Activate 2 drafts/ }));
  expect(await screen.findByText('2 activated, 0 failed')).toBeInTheDocument();
  expect(screen.getByText('1 activated but ERPNext was not updated; ask Finance or an administrator to review it.')).toBeInTheDocument();
});

it('AC-BAD-002 a failed readiness check is shown, never left as Checking, and cannot be ticked', async () => {
  h.precheckActivation.mockRejectedValue(new Error('edge down'));
  mount();
  expect(await screen.findAllByText("Couldn't check readiness")).toHaveLength(3);
  expect(box(/Project a/)).toHaveAttribute('aria-disabled', 'true');
});

it('renders nothing when there are no drafts', async () => {
  h.listOrgDrafts.mockResolvedValue([]);
  mount();
  await waitFor(() => expect(h.listOrgDrafts).toHaveBeenCalled());
  expect(screen.queryByRole('heading', { name: 'Review and activate drafts' })).toBeNull();
});
