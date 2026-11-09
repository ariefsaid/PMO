import React from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryCache, QueryClient, QueryClientProvider, useQueries, type QueryKey } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BahasaProvider } from '@/test/bahasa';

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

function setupWithQueries(queries: readonly { queryKey: QueryKey; queryFn: () => Promise<string> }[]) {
  const queryClient = new QueryClient({
    queryCache: new QueryCache({ onError: () => undefined }),
    defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: React.ReactNode }) =>
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  const hook = renderHook((props: typeof baseProps) => {
    const activeReads = useQueries({ queries });
    const paste = useBudgetPasteRows(props);
    return { activeReads, paste };
  }, { initialProps: baseProps, wrapper });
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

  it('rejects a non-canonical amount before any write', async () => {
    const { result } = setup();

    await act(async () => { await result.current.save([{ ...rows[0], amount: '1,234.50' }]); });

    expect(budget.createLineItem).not.toHaveBeenCalled();
    expect(result.current.validationError).toMatch(/non-canonical amount/i);
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

  it('returns an immutable confirmed receipt and stops after one request when unmounted in flight', async () => {
    const pending = deferred<ReturnType<typeof confirmedLine>>();
    budget.createLineItem.mockReturnValueOnce(pending.promise);
    const { result, unmount } = setup();
    let save!: Promise<unknown>;

    act(() => { save = result.current.save(rows); });
    expect(budget.createLineItem).toHaveBeenCalledTimes(1);
    unmount();

    let receipt: unknown;
    await act(async () => {
      pending.resolve(confirmedLine('line-1'));
      receipt = await save;
    });

    expect(budget.createLineItem).toHaveBeenCalledTimes(1);
    expect(receipt).toMatchObject({
      projectId: 'project-1',
      targetId: 'draft-1',
      results: [
        { rowNumber: 2, targetId: 'draft-1', status: 'created' },
        { rowNumber: 3, targetId: 'draft-1', status: 'unsubmitted' },
        { rowNumber: 4, targetId: 'draft-1', status: 'unsubmitted' },
      ],
      refreshError: null,
    });
    expect(Object.isFrozen(receipt)).toBe(true);
    expect(Object.isFrozen((receipt as { results: unknown[] }).results)).toBe(true);
  });

  it('returns the actual uncertain result after an in-flight request settles during unmount', async () => {
    const pending = deferred<ReturnType<typeof confirmedLine>>();
    budget.createLineItem.mockReturnValueOnce(pending.promise);
    const { result, unmount } = setup();
    let save!: Promise<unknown>;

    act(() => { save = result.current.save(rows); });
    unmount();

    let receipt: unknown;
    await act(async () => {
      pending.reject(new Error('transport outcome is unknown'));
      receipt = await save;
    });

    expect(budget.createLineItem).toHaveBeenCalledTimes(1);
    expect(receipt).toMatchObject({
      results: [
        { rowNumber: 2, targetId: 'draft-1', status: 'uncertain', retryable: false },
        { rowNumber: 3, status: 'unsubmitted' },
        { rowNumber: 4, status: 'unsubmitted' },
      ],
    });
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

  it('blocks same-session replay after uncertainty and requires explicit new-session acknowledgement', async () => {
    budget.createLineItem.mockRejectedValueOnce(new Error('lost response'));
    const { result } = setup();

    let firstReceipt: unknown;
    await act(async () => { firstReceipt = await result.current.save(rows.slice(0, 1)); });
    const originalResults = result.current.results;

    await act(async () => { await result.current.save(rows.slice(0, 1)); });

    expect(budget.createLineItem).toHaveBeenCalledTimes(1);
    expect(result.current.results).toEqual(originalResults);
    expect(result.current.validationError).toMatch(/new paste session|reconciliation/i);
    expect(firstReceipt).toMatchObject({ results: [{ rowNumber: 2, status: 'uncertain' }] });

    await act(async () => { result.current.acknowledgeAndStartNewSession(); });
    expect(result.current.results).toEqual([]);

    budget.createLineItem.mockResolvedValueOnce(confirmedLine('line-2'));
    let newReceipt: unknown;
    await act(async () => { newReceipt = await result.current.save(rows.slice(0, 1)); });

    expect(budget.createLineItem).toHaveBeenCalledTimes(2);
    expect(budget.createLineItem).toHaveBeenLastCalledWith(
      'draft-1', { category: 'Labor', description: 'Same line', budgeted_amount: 12.3 },
    );
    expect(newReceipt).toMatchObject({ results: [{ rowNumber: 2, status: 'created' }] });
  });

  it('retries only confirmed failures and excludes uncertain and unsubmitted rows', async () => {
    budget.createLineItem
      .mockRejectedValueOnce(rejected('22003'))
      .mockRejectedValueOnce(new Error('response lost'))
      .mockResolvedValueOnce(confirmedLine('line-2'));
    const { result } = setup();

    await act(async () => { await result.current.save(rows); });
    expect(result.current.results.map(({ rowNumber, status }) => [rowNumber, status])).toEqual([
      [2, 'failed'], [3, 'uncertain'], [4, 'unsubmitted'],
    ]);

    await act(async () => { await result.current.retryFailed(); });

    expect(budget.createLineItem).toHaveBeenCalledTimes(3);
    expect(budget.createLineItem).toHaveBeenLastCalledWith(
      'draft-1', { category: 'Labor', description: 'Same line', budgeted_amount: 12.3 },
    );
    expect(result.current.results.map(({ rowNumber, status }) => [rowNumber, status])).toEqual([
      [2, 'created'], [3, 'uncertain'], [4, 'unsubmitted'],
    ]);
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
    expect(queryClient.invalidateQueries).toHaveBeenCalledTimes(1);

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

  it('keeps the save mutex locked until every same-prefix refresh settles after a fast rejection', async () => {
    const pendingRead = deferred<string>();
    const readCalls = [0, 0];
    const queries = [
      {
        queryKey: ['budget-distribution', 'org-1', 'project-1', 'draft-1'],
        queryFn: () => {
          readCalls[0] += 1;
          return readCalls[0] === 1 ? Promise.resolve('initial') : Promise.reject(new Error('read failed'));
        },
      },
      {
        queryKey: ['budget-distribution', 'org-1', 'project-1', 'draft-2'],
        queryFn: () => {
          readCalls[1] += 1;
          return readCalls[1] === 1 ? Promise.resolve('initial') : pendingRead.promise;
        },
      },
    ];
    const { result } = setupWithQueries(queries);
    await waitFor(() => expect(result.current.activeReads.every((query) => query.data === 'initial')).toBe(true));

    let save!: Promise<unknown>;
    act(() => { save = result.current.paste.save(rows.slice(0, 1)); });
    await waitFor(() => expect(readCalls).toEqual([2, 2]));
    const remainedLocked = result.current.paste.isSaving;
    expect(result.current.paste.results[0]).toMatchObject({ status: 'created' });

    pendingRead.resolve('fresh');
    await act(async () => { await save; });

    expect(remainedLocked).toBe(true);
    expect(result.current.paste.isSaving).toBe(false);
    expect(result.current.paste.results[0]).toMatchObject({ status: 'created', retryable: false });
    expect(result.current.paste.refreshError).toBeTruthy();
    expect(budget.createLineItem).toHaveBeenCalledTimes(1);
  });

  it('writes 500 rows with one in-flight request and one bounded refresh using exact payloads', async () => {
    const gates: ReturnType<typeof deferred<ReturnType<typeof confirmedLine>>>[] = [];
    let activeWrites = 0;
    let maxActiveWrites = 0;
    let nextRequest = deferred<void>();
    budget.createLineItem.mockImplementation(() => {
      activeWrites += 1;
      maxActiveWrites = Math.max(maxActiveWrites, activeWrites);
      const gate = deferred<ReturnType<typeof confirmedLine>>();
      gates.push(gate);
      nextRequest.resolve();
      nextRequest = deferred<void>();
      return gate.promise.finally(() => { activeWrites -= 1; });
    });
    const manyRows = Array.from({ length: 500 }, (_, index) => ({
      rowNumber: index + 1,
      category: 'Labor' as const,
      description: 'Line ' + (index + 1),
      amount: (index + 1) + '.00',
    }));
    const refreshCalls = [0, 0, 0];
    const queries = [
      {
        queryKey: ['budget-versions', 'org-1', 'project-1'],
        queryFn: () => {
          refreshCalls[0] += 1;
          return Promise.resolve(refreshCalls[0] === 1 ? 'initial' : 'fresh');
        },
      },
      {
        queryKey: ['budget-distribution', 'org-1', 'project-1', 'draft-1'],
        queryFn: () => {
          refreshCalls[1] += 1;
          return Promise.resolve(refreshCalls[1] === 1 ? 'initial' : 'fresh');
        },
      },
      {
        queryKey: ['budget-distribution', 'org-1', 'project-1', 'draft-2'],
        queryFn: () => {
          refreshCalls[2] += 1;
          return Promise.resolve(refreshCalls[2] === 1 ? 'initial' : 'fresh');
        },
      },
    ];
    const { result, queryClient } = setupWithQueries(queries);
    await waitFor(() => expect(result.current.activeReads.every((query) => query.data === 'initial')).toBe(true));
    const invalidation = vi.spyOn(queryClient, 'invalidateQueries');
    let requestSignal = nextRequest;
    let save!: Promise<unknown>;
    act(() => { save = result.current.paste.save(manyRows); });

    for (let index = 0; index < manyRows.length; index += 1) {
      await requestSignal.promise;
      expect(gates).toHaveLength(index + 1);
      expect(activeWrites).toBe(1);
      if (index === manyRows.length - 1) expect(refreshCalls).toEqual([1, 1, 1]);
      if (index < manyRows.length - 1) requestSignal = nextRequest;
      await act(async () => {
        gates[index].resolve(confirmedLine('line-' + (index + 1)));
        await Promise.resolve();
      });
    }
    await act(async () => { await save; });

    expect(maxActiveWrites).toBe(1);
    expect(activeWrites).toBe(0);
    expect(budget.createLineItem).toHaveBeenCalledTimes(500);
    expect(budget.createLineItem.mock.calls.map(([, item]) => item)).toEqual(
      manyRows.map((row, index) => ({
        category: row.category,
        description: row.description,
        budgeted_amount: index + 1,
      })),
    );
    expect(invalidation).toHaveBeenCalledTimes(1);
    expect(refreshCalls).toEqual([2, 2, 2]);
    expect(result.current.paste.results).toHaveLength(500);
    expect(result.current.paste.results.every((row) => row.status === 'created')).toBe(true);
  });

  it('AC-005 rejects non-canonical amounts that parse to a valid number, before any write', async () => {
    const { result } = setup();

    for (const amount of ['1.5', '01.00', ' 5', '5.0']) {
      await act(async () => { await result.current.save([{ ...rows[0], amount }]); });
      expect(result.current.validationError).toMatch(/non-canonical amount/i);
    }
    expect(budget.createLineItem).not.toHaveBeenCalled();
  });

  it('#1473 shows validation messages in the user language (ID), not English', async () => {
    const queryClient = new QueryClient();
    const wrapper = ({ children }: { children: React.ReactNode }) =>
      <BahasaProvider locale="id"><QueryClientProvider client={queryClient}>{children}</QueryClientProvider></BahasaProvider>;
    const { result } = renderHook(() => useBudgetPasteRows(baseProps), { wrapper });

    await act(async () => { await result.current.save([]); });

    expect(result.current.validationError).toBe('Tambahkan minimal satu baris valid sebelum menyimpan.');
    expect(budget.createLineItem).not.toHaveBeenCalled();
  });
});
