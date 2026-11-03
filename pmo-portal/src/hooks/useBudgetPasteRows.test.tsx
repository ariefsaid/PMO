import React from 'react';
import { act, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const budget = vi.hoisted(() => ({ createLineItem: vi.fn() }));

vi.mock('@/src/lib/repositories', () => ({ repositories: { budget } }));
vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'user-1', org_id: 'org-1', role: 'Project Manager' } }),
}));

import { useBudgetPasteRows, type BudgetPasteRowInput } from './useBudgetPasteRows';

const rows: readonly BudgetPasteRowInput[] = [
  { rowNumber: 2, category: 'Labor', description: 'Same line', amount: '12.30' },
  { rowNumber: 3, category: 'Labor', description: 'Same line', amount: '12.30' },
  { rowNumber: 4, category: 'Materials', description: null, amount: '9.99' },
];

const baseProps = {
  projectId: 'project-1',
  targetId: 'draft-1',
  selectedId: 'draft-1',
  isDraft: true,
  canCreate: true,
  canEdit: true,
};

function setup(initialProps = baseProps) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: React.ReactNode }) =>
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  const hook = renderHook((props: typeof baseProps) => useBudgetPasteRows(props), {
    initialProps,
    wrapper,
  });
  return { ...hook, queryClient };
}

function confirmedLine(id: string) {
  return { id };
}

function rejected(code: string, message = 'backend detail must stay private') {
  return Object.assign(new Error(message), { code });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe('useBudgetPasteRows', () => {
  beforeEach(() => {
    budget.createLineItem.mockReset();
    budget.createLineItem.mockImplementation(async () => confirmedLine('created-line'));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('writes the immutable reviewed snapshot sequentially and retries only a confirmed row-local rejection', async () => {
    budget.createLineItem
      .mockResolvedValueOnce(confirmedLine('line-1'))
      .mockRejectedValueOnce(rejected('22003'))
      .mockResolvedValueOnce(confirmedLine('line-3'))
      .mockResolvedValueOnce(confirmedLine('line-2'));
    const { result } = setup();

    await act(async () => result.current.save(rows));

    expect(budget.createLineItem.mock.calls).toEqual([
      ['draft-1', { category: 'Labor', description: 'Same line', budgeted_amount: 12.3 }],
      ['draft-1', { category: 'Labor', description: 'Same line', budgeted_amount: 12.3 }],
      ['draft-1', { category: 'Materials', description: null, budgeted_amount: 9.99 }],
    ]);
    expect(result.current.results.map(({ rowNumber, status }) => [rowNumber, status])).toEqual([
      [2, 'created'], [3, 'failed'], [4, 'created'],
    ]);

    await act(async () => result.current.retryFailed());

    expect(budget.createLineItem).toHaveBeenCalledTimes(4);
    expect(budget.createLineItem).toHaveBeenLastCalledWith(
      'draft-1', { category: 'Labor', description: 'Same line', budgeted_amount: 12.3 },
    );
    expect(result.current.results.map(({ rowNumber, status }) => [rowNumber, status])).toEqual([
      [2, 'created'], [3, 'created'], [4, 'created'],
    ]);
  });

  it('keeps a confirmed row failure visible and blocks retry when the original target is no longer selected', async () => {
    budget.createLineItem.mockRejectedValueOnce(rejected('22003'));
    const { result, rerender } = setup();
    await act(async () => result.current.save(rows.slice(0, 1)));
    rerender({ ...baseProps, selectedId: 'draft-2' });

    await act(async () => result.current.retryFailed());

    expect(budget.createLineItem).toHaveBeenCalledTimes(1);
    expect(result.current.results[0]).toMatchObject({ targetId: 'draft-1', status: 'failed', retryable: true });
    expect(result.current.validationError).toMatch(/original budget Draft/i);
  });

  it('locks duplicate submissions synchronously before the hook rerenders', async () => {
    const pending = deferred<ReturnType<typeof confirmedLine>>();
    budget.createLineItem.mockReturnValueOnce(pending.promise);
    const { result } = setup();
    let first!: Promise<unknown>;
    let duplicate!: Promise<unknown>;

    act(() => {
      first = result.current.save(rows.slice(0, 1));
      duplicate = result.current.save(rows.slice(0, 1));
    });
    expect(budget.createLineItem).toHaveBeenCalledTimes(1);
    expect(result.current.isSaving).toBe(true);

    await act(async () => {
      pending.resolve(confirmedLine('line-1'));
      await Promise.all([first, duplicate]);
    });
    expect(budget.createLineItem).toHaveBeenCalledTimes(1);
  });

  it('keeps the captured target outcome and stops when live authority changes during an awaited write', async () => {
    const pending = deferred<ReturnType<typeof confirmedLine>>();
    budget.createLineItem.mockReturnValueOnce(pending.promise);
    const { result, rerender } = setup();
    let save!: Promise<unknown>;

    act(() => { save = result.current.save(rows); });
    rerender({ ...baseProps, selectedId: 'draft-2' });
    await act(async () => {
      pending.resolve(confirmedLine('line-1'));
      await save;
    });

    expect(budget.createLineItem).toHaveBeenCalledTimes(1);
    expect(budget.createLineItem).toHaveBeenCalledWith(
      'draft-1', { category: 'Labor', description: 'Same line', budgeted_amount: 12.3 },
    );
    expect(result.current.results.map(({ rowNumber, status }) => [rowNumber, status])).toEqual([
      [2, 'created'], [3, 'unsubmitted'], [4, 'unsubmitted'],
    ]);
  });

  it.each([
    ['create permission', { canCreate: false }],
    ['edit permission', { canEdit: false }],
    ['Draft status', { isDraft: false }],
    ['selected target', { selectedId: 'draft-2' }],
  ])('stops before the next row if live %s changes', async (_label, patch) => {
    const pending = deferred<ReturnType<typeof confirmedLine>>();
    budget.createLineItem.mockReturnValueOnce(pending.promise);
    const { result, rerender } = setup();
    let save!: Promise<unknown>;

    act(() => { save = result.current.save(rows); });
    rerender({ ...baseProps, ...patch });
    await act(async () => {
      pending.resolve(confirmedLine('line-1'));
      await save;
    });

    expect(budget.createLineItem).toHaveBeenCalledTimes(1);
    expect(result.current.results[0]).toMatchObject({ rowNumber: 2, status: 'created' });
    expect(result.current.results.slice(1).map(({ status }) => status)).toEqual(['unsubmitted', 'unsubmitted']);
  });

  it('marks an unknown transport outcome uncertain, stops, preserves it, and never retries it', async () => {
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => undefined);
    budget.createLineItem.mockRejectedValueOnce(new Error('clipboard contents should not be logged'));
    const { result } = setup();

    await act(async () => result.current.save(rows));
    await act(async () => result.current.retryFailed());

    expect(budget.createLineItem).toHaveBeenCalledTimes(1);
    expect(result.current.results.map(({ status }) => status)).toEqual(['uncertain', 'unsubmitted', 'unsubmitted']);
    expect(JSON.stringify(debug.mock.calls)).not.toContain('clipboard contents');
  });

  it('marks a timeout uncertain and requires reconciliation instead of retrying', async () => {
    budget.createLineItem.mockRejectedValueOnce(rejected('REQUEST_TIMEOUT'));
    const { result } = setup();

    await act(async () => result.current.save(rows));
    await act(async () => result.current.retryFailed());

    expect(budget.createLineItem).toHaveBeenCalledTimes(1);
    expect(result.current.results.map(({ status }) => status)).toEqual(['uncertain', 'unsubmitted', 'unsubmitted']);
  });

  it('does not claim created when the repository resolves without a confirmed line row', async () => {
    budget.createLineItem.mockResolvedValueOnce(undefined);
    const { result } = setup();

    await act(async () => result.current.save(rows));

    expect(result.current.results.map(({ status }) => status)).toEqual(['uncertain', 'unsubmitted', 'unsubmitted']);
    expect(result.current.results[0]).toMatchObject({ retryable: false });
  });

  it.each([
    ['42501', "You don't have permission to do that.", 'Your role does not allow this change. Ask an administrator if you think it should.', 'permission_denied'],
    ['P0001', "That move isn't allowed from the current stage.", 'The selected budget is no longer available for editing.', 'illegal_transition'],
  ])('stops on authority or Draft rejection code %s with classified safe copy', async (code, headline, detail, classification) => {
    budget.createLineItem.mockRejectedValueOnce(rejected(code));
    const { result } = setup();

    await act(async () => result.current.save(rows));

    expect(budget.createLineItem).toHaveBeenCalledTimes(1);
    expect(result.current.results.map(({ status }) => status)).toEqual(['failed', 'unsubmitted', 'unsubmitted']);
    expect(result.current.results[0]).toMatchObject({
      retryable: false,
      error: { headline, detail, classification },
    });
    expect(JSON.stringify(result.current.results[0].error)).not.toContain('backend detail must stay private');
  });

  it('accepts cent precision boundaries and round-trips them through the ordinary number payload', async () => {
    const boundaryRows: readonly BudgetPasteRowInput[] = [
      { rowNumber: 1, category: 'Labor', description: null, amount: '0.01' },
      { rowNumber: 2, category: 'Labor', description: null, amount: '0.10' },
      { rowNumber: 3, category: 'Labor', description: null, amount: '999999999999.99' },
    ];
    const { result } = setup();

    await act(async () => result.current.save(boundaryRows));

    expect(budget.createLineItem.mock.calls.map(([, item]) => item.budgeted_amount)).toEqual([
      0.01, 0.1, 999999999999.99,
    ]);
    expect(result.current.results.map(({ status }) => status)).toEqual(['created', 'created', 'created']);
  });

  it.each([
    ['empty input', []],
    ['duplicate source row numbers', [rows[0], rows[0]]],
    ['unknown category', [{ ...rows[0], category: 'invented' }]],
    ['malformed decimal', [{ ...rows[0], amount: '1.001' }]],
    ['non-canonical decimal', [{ ...rows[0], amount: '1.0' }]],
  ])('rejects %s before the repository write', async (_label, input) => {
    const { result } = setup();

    await act(async () => result.current.save(input as readonly BudgetPasteRowInput[]));

    expect(budget.createLineItem).not.toHaveBeenCalled();
  });

  it('rejects an amount whose number conversion is non-finite before writing', async () => {
    const RealNumber = Number;
    const invalidNumber = Object.assign((() => Infinity) as unknown as NumberConstructor, {
      isFinite: RealNumber.isFinite,
      isSafeInteger: RealNumber.isSafeInteger,
    });
    vi.stubGlobal('Number', invalidNumber);
    const { result } = setup();

    await act(async () => result.current.save(rows.slice(0, 1)));

    expect(budget.createLineItem).not.toHaveBeenCalled();
  });

  it('waits for the coalesced cache reconciliation before ending the batch', async () => {
    const pendingRefresh = deferred<void>();
    const { result, queryClient } = setup();
    vi.spyOn(queryClient, 'invalidateQueries').mockReturnValue(pendingRefresh.promise);
    let save!: Promise<unknown>;

    act(() => { save = result.current.save(rows.slice(0, 1)); });
    await act(async () => Promise.resolve());

    expect(result.current.isSaving).toBe(true);
    expect(result.current.results[0]).toMatchObject({ status: 'created' });
    expect(queryClient.invalidateQueries).toHaveBeenCalledTimes(5);

    await act(async () => {
      pendingRefresh.resolve();
      await save;
    });
    expect(result.current.isSaving).toBe(false);
  });

  it('preserves a confirmed write when refresh fails and never puts it into the retry set', async () => {
    const { result, queryClient } = setup();
    vi.spyOn(queryClient, 'invalidateQueries').mockRejectedValue(new Error('refresh response contains no row data'));

    await act(async () => result.current.save(rows.slice(0, 1)));
    await act(async () => result.current.retryFailed());

    expect(budget.createLineItem).toHaveBeenCalledTimes(1);
    expect(result.current.results[0]).toMatchObject({ rowNumber: 2, status: 'created', retryable: false });
    expect(result.current.refreshError).toBeTruthy();
  });
});
