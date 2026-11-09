import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ImpersonationProvider } from '@/src/auth/impersonation';

const h = vi.hoisted(() => ({
  listOrgDrafts: vi.fn(),
  getActivationMode: vi.fn(),
  precheckActivation: vi.fn(),
  activateVersion: vi.fn(),
  getDistribution: vi.fn(),
}));
vi.mock('@/src/lib/repositories', () => ({ repositories: { budget: h } }));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 'me', org_id: 'org-1', role: 'Finance' } }) }));

import { BudgetDraftReview } from './BudgetDraftReview';
import { draftTickState } from './draftTickState';
import { categoryTotals, planFor } from '@/src/lib/budget/savedDistribution';
import { yearsInSpan } from '@/src/lib/budget/budgetDistribution';

const draft = (id: string, extra: Record<string, unknown> = {}) => ({
  id, projectId: `p-${id}`, projectCode: `PRJ-${id}`, projectName: `Project ${id}`, currency: 'IDR', version: 1, name: 'Imported',
  total: 1000, createdBy: 'u9', editorIds: ['u9'], documentUrl: null,
  budgetMode: 'per_year', projectStart: null, projectEnd: null, lines: [], ...extra,
});
const calendar = [{ name: 'FY2026', start: '2026-01-01', end: '2026-12-31' }];
const wholeLines = [{ category: 'Labor', budgeted_amount: 1000 }];
const whole = (id: string) => draft(id, { budgetMode: 'whole_project', projectStart: '2026-02-01', projectEnd: '2026-06-30', lines: wholeLines });
const savedPlan = () => planFor(categoryTotals(wholeLines as never), yearsInSpan('2026-02-01', '2026-06-30', calendar), '2026-02-01', '2026-06-30', 'by_days', {}, {});
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
  h.getDistribution.mockResolvedValue(null);
});
afterEach(cleanup);

/** The panel is collapsed by default (no readiness reads until opened); most tests open it. */
async function mount(opts: { open?: boolean; role?: 'Finance' | 'Engineer' } = {}) {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ImpersonationProvider realRole={opts.role ?? 'Finance'}><BudgetDraftReview /></ImpersonationProvider>
    </QueryClientProvider>,
  );
  if (opts.open !== false && opts.role !== 'Engineer') fireEvent.click(await screen.findByRole('button', { name: /^Review \d+ drafts?$/ }));
}
const box = (name: RegExp) => screen.getByRole('checkbox', { name });

describe('draftTickState', () => {
  const base = { mode: 'allowed' as const, precheck: ready as never, canTransition: true };
  it('AC-BAD-003 a mode that is not allowed/sole_operator is never tickable, and each block names its own reason', () => {
    expect(draftTickState({ ...base, mode: 'blocked_editor' })).toBe('blocked-editor');
    expect(draftTickState({ ...base, mode: 'blocked_no_drafter' })).toBe('needs-admin-finance');
    expect(draftTickState({ ...base, mode: 'blocked' })).toBe('eligibility-unavailable');
    expect(draftTickState({ ...base, canTransition: false })).toBe('not-allowed');
  });
  it('AC-BAD-012 a whole-project draft needs the Budget tab\'s distribution gate to be current', () => {
    expect(draftTickState({ ...base, distribution: 'current' })).toBe('ready');
    expect(draftTickState({ ...base, distribution: 'absent' })).toBe('distribution-missing');
    for (const d of ['stale', 'dirty', 'invalid', 'saving'] as const) expect(draftTickState({ ...base, distribution: d })).toBe('distribution-stale');
    expect(draftTickState({ ...base, distribution: 'loading' })).toBe('checking');
    expect(draftTickState({ ...base, distribution: 'error' })).toBe('check-failed');
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
  await mount();
  await screen.findByText(/Project a/);
  await waitFor(() => expect(box(/Project a/)).not.toHaveAttribute('aria-disabled'));
  expect(screen.getByRole('link', { name: 'Open' })).toHaveAttribute('href', 'https://sp.example/a.xlsx');
  expect(box(/Project b/)).toHaveAttribute('aria-disabled','true');
  expect(box(/Project c/)).toHaveAttribute('aria-disabled','true');
  expect(screen.getByText('Map the budget categories first')).toBeInTheDocument();
  expect(screen.getByText('You drafted or edited this draft, so someone else must activate it.')).toBeInTheDocument();
  expect(screen.getByText('No')).toBeInTheDocument();
});

it('AC-BAD-008 a draft I prepared myself is not tickable even when the server mode says allowed', async () => {
  h.listOrgDrafts.mockResolvedValue([draft('f', { createdBy: 'me', editorIds: [] }), draft('g')]);
  h.getActivationMode.mockResolvedValue('allowed');
  await mount();
  await waitFor(() => expect(box(/Project g/)).not.toHaveAttribute('aria-disabled'));
  expect(box(/Project f/)).toHaveAttribute('aria-disabled', 'true');
  expect(screen.getByText('Someone else must activate this draft')).toBeInTheDocument();
});

it('AC-BAD-012 a whole-project draft is tickable only while its saved distribution matches the live ERPNext fiscal years', async () => {
  h.listOrgDrafts.mockResolvedValue([whole('w'), whole('x'), whole('y')]);
  h.precheckActivation.mockResolvedValue({ ...ready, fiscalYears: calendar });
  h.getDistribution.mockImplementation(async (id: string) => (id === 'w' ? savedPlan() : id === 'x'
    ? { ...savedPlan(), basis: { ...savedPlan().basis, years: [{ name: 'FY2025', start: '2025-01-01', end: '2025-12-31' }] } }
    : null));
  await mount();
  await waitFor(() => expect(box(/Project w/)).not.toHaveAttribute('aria-disabled'));
  expect(box(/Project x/)).toHaveAttribute('aria-disabled', 'true');
  expect(box(/Project y/)).toHaveAttribute('aria-disabled', 'true');
  expect(screen.getByText(/no longer matches this draft/)).toBeInTheDocument();
  expect(screen.getByText(/Save a fiscal-year distribution/)).toBeInTheDocument();
});

it('AC-BAD-004/006 one confirm with the count; nothing activates before it; only the ticked draft does', async () => {
  await mount();
  await waitFor(() => expect(box(/Project a/)).not.toHaveAttribute('aria-disabled'));
  expect(screen.getByRole('button', { name: /Activate selected \(0\)/ })).toBeDisabled();
  fireEvent.click(box(/Project a/));
  fireEvent.click(screen.getByRole('button', { name: /Activate selected \(1\)/ }));
  const dialog = await screen.findByRole('dialog');
  expect(dialog).toHaveTextContent('Activate 1 draft budget?');
  expect(dialog).not.toHaveTextContent('only person');
  expect(h.activateVersion).not.toHaveBeenCalled();
  fireEvent.click(within(dialog).getByRole('button', { name: 'Activate 1 draft' }));
  await waitFor(() => expect(h.activateVersion).toHaveBeenCalledTimes(1));
  expect(h.activateVersion).toHaveBeenCalledWith('a');
  expect(await screen.findByText('1 activated, 0 failed')).toBeInTheDocument();
});

it('AC-BAD-014 the confirm wording is singular for one draft (several are covered by the 2- and 3-draft cases)', async () => {
  await mount();
  await waitFor(() => expect(box(/Project a/)).not.toHaveAttribute('aria-disabled'));
  fireEvent.click(box(/Project a/));
  fireEvent.click(screen.getByRole('button', { name: /Activate selected \(1\)/ }));
  expect(await screen.findByRole('dialog')).toHaveTextContent(/makes 1 draft \(total .*\) the live active budget of its project/);
});

it('AC-BAD-004 cancel activates nothing', async () => {
  await mount();
  await waitFor(() => expect(box(/Project a/)).not.toHaveAttribute('aria-disabled'));
  fireEvent.click(box(/Project a/));
  fireEvent.click(screen.getByRole('button', { name: /Activate selected/ }));
  fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Cancel' }));
  expect(h.activateVersion).not.toHaveBeenCalled();
});

it('AC-BAD-005 the sole-operator wording appears only when a selected draft is in sole-operator mode', async () => {
  h.getActivationMode.mockResolvedValue('sole_operator');
  h.listOrgDrafts.mockResolvedValue([draft('a', { createdBy: 'me', editorIds: ['me'] })]);
  await mount();
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
  await mount();
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
  await mount();
  await waitFor(() => expect(box(/Project e/)).not.toHaveAttribute('aria-disabled'));
  for (const n of [/Project a/, /Project e/]) fireEvent.click(box(n));
  fireEvent.click(screen.getByRole('button', { name: /Activate selected \(2\)/ }));
  fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: /Activate 2 drafts/ }));
  expect(await screen.findByText('2 activated, 0 failed')).toBeInTheDocument();
  expect(screen.getByText('1 activated but ERPNext was not updated; ask Finance or an administrator to review it.')).toBeInTheDocument();
});

it('AC-BAD-002 a failed readiness check is shown, never left as Checking, and cannot be ticked', async () => {
  h.precheckActivation.mockRejectedValue(new Error('edge down'));
  await mount();
  expect(await screen.findAllByText("Couldn't check readiness")).toHaveLength(3);
  expect(box(/Project a/)).toHaveAttribute('aria-disabled', 'true');
});

it('renders nothing when there are no drafts', async () => {
  h.listOrgDrafts.mockResolvedValue([]);
  await mount({ open: false });
  await waitFor(() => expect(h.listOrgDrafts).toHaveBeenCalled());
  expect(screen.queryByRole('heading', { name: 'Review and activate drafts' })).toBeNull();
});

it('AC-BAD-013 the panel is collapsed by default: no readiness read fires until it is opened', async () => {
  await mount({ open: false });
  await screen.findByRole('button', { name: 'Review 3 drafts' });
  expect(h.getActivationMode).not.toHaveBeenCalled();
  expect(h.precheckActivation).not.toHaveBeenCalled();
  expect(screen.queryByRole('checkbox')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Review 3 drafts' }));
  await waitFor(() => expect(h.precheckActivation).toHaveBeenCalledTimes(3));
  expect(h.getActivationMode).toHaveBeenCalledTimes(3);
});

it('AC-BAD-013 readiness reads are capped at 10 drafts at a time; the rest are checked on request', async () => {
  h.listOrgDrafts.mockResolvedValue(Array.from({ length: 12 }, (_, i) => draft(`d${String(i).padStart(2, '0')}`)));
  await mount();
  await waitFor(() => expect(h.precheckActivation).toHaveBeenCalledTimes(10));
  expect(h.getActivationMode).toHaveBeenCalledTimes(10);
  expect(screen.getByText('Readiness checked for 10 of 12 drafts')).toBeInTheDocument();
  expect(screen.getAllByText('Not checked yet')).toHaveLength(2);
  expect(box(/Project d11/)).toHaveAttribute('aria-disabled', 'true');
  fireEvent.click(screen.getByRole('button', { name: 'Check the rest' }));
  await waitFor(() => expect(h.precheckActivation).toHaveBeenCalledTimes(12));
  expect(screen.queryByText('Not checked yet')).toBeNull();
});

it('AC-BAD-013 a role that can activate nothing reads no drafts and sees no panel', async () => {
  await mount({ role: 'Engineer' });
  await new Promise((r) => setTimeout(r, 0));
  expect(h.listOrgDrafts).not.toHaveBeenCalled();
  expect(h.getActivationMode).not.toHaveBeenCalled();
  expect(screen.queryByRole('heading', { name: 'Review and activate drafts' })).toBeNull();
});

it('AC-BAD-013 a row that is refetching is not treated as ready', async () => {
  let release: (v: unknown) => void = () => {};
  await mount();
  await waitFor(() => expect(box(/Project a/)).not.toHaveAttribute('aria-disabled'));
  h.precheckActivation.mockImplementation(() => new Promise((r) => { release = r; }));
  fireEvent.click(screen.getByRole('button', { name: 'Hide drafts' }));
  fireEvent.click(screen.getByRole('button', { name: /^Review \d+ drafts?$/ }));
  await waitFor(() => expect(h.precheckActivation.mock.calls.length).toBeGreaterThan(3));
  expect(box(/Project a/)).toHaveAttribute('aria-disabled', 'true');
  release(ready);
});

it('AC-BAD-015 the outcome per project survives the rows refetching away: the failed and ERP-flagged project is still named', async () => {
  h.listOrgDrafts.mockImplementation(async () => (h.activateVersion.mock.calls.length > 0 ? [] : [draft('a'), draft('d'), draft('e')]));
  h.activateVersion.mockImplementation(async (id: string) => {
    if (id === 'd') throw Object.assign(new Error('new row violates check constraint "x"'), { code: '23514' });
    return { pushState: id === 'a' ? 'failed' : 'pushed' };
  });
  await mount();
  await waitFor(() => expect(box(/Project e/)).not.toHaveAttribute('aria-disabled'));
  for (const n of [/Project a/, /Project d/, /Project e/]) fireEvent.click(box(n));
  fireEvent.click(screen.getByRole('button', { name: /Activate selected \(3\)/ }));
  fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: /Activate 3 drafts/ }));
  await waitFor(() => expect(screen.queryByRole('checkbox')).toBeNull());
  const line = (label: string) => screen.getByText(label).closest('li');
  expect(line('PRJ-a Project a v1')).toHaveTextContent('Activated, but ERPNext was not updated');
  expect(line('PRJ-d Project d v1')).toHaveTextContent('This change conflicts with the current document state. Refresh and try again.');
  expect(line('PRJ-d Project d v1')).not.toHaveTextContent('check constraint');
  expect(line('PRJ-e Project e v1')).toHaveTextContent('Activated');
  expect(screen.getByText('2 activated, 1 failed')).toBeInTheDocument();
});

it('AC-BAD-016 an activation that sent nothing to ERPNext (no budget lines) is named, not reported as plain success', async () => {
  h.listOrgDrafts.mockResolvedValue([draft('a'), draft('e')]);
  h.activateVersion.mockImplementation(async (id: string) => ({ pushState: id === 'a' ? 'nothing-to-push' : 'pushed' }));
  await mount();
  await waitFor(() => expect(box(/Project e/)).not.toHaveAttribute('aria-disabled'));
  for (const n of [/Project a/, /Project e/]) fireEvent.click(box(n));
  fireEvent.click(screen.getByRole('button', { name: /Activate selected \(2\)/ }));
  fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: /Activate 2 drafts/ }));
  expect(await screen.findByText('2 activated, 0 failed')).toBeInTheDocument();
  expect(screen.getByText('PRJ-a Project a v1').closest('li')).toHaveTextContent('Activated, but nothing was sent to ERPNext: no budget lines');
  expect(screen.getByText(/1 activated but nothing was sent to ERPNext/)).toBeInTheDocument();
});

it('AC-BAD-017 a second batch replaces the summary instead of adding to the first', async () => {
  await mount();
  await waitFor(() => expect(box(/Project a/)).not.toHaveAttribute('aria-disabled'));
  const run = async (name: RegExp, size: RegExp) => {
    await waitFor(() => expect(box(name)).not.toHaveAttribute('aria-disabled'));
    fireEvent.click(box(name));
    fireEvent.click(screen.getByRole('button', { name: /Activate selected \(1\)/ }));
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: size }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  };
  await run(/Project a/, /^Activate 1 draft$/);
  expect(await screen.findByText('1 activated, 0 failed')).toBeInTheDocument();
  h.activateVersion.mockRejectedValueOnce(new Error('only a Draft version can be activated'));
  await run(/Project a/, /^Activate 1 draft$/);
  expect(await screen.findByText('0 activated, 1 failed')).toBeInTheDocument();
  expect(screen.queryByText('1 activated, 0 failed')).toBeNull();
});
