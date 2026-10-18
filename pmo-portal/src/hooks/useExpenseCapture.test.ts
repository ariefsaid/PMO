import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

const h = vi.hoisted(() => ({
  create: vi.fn(),
  prepare: vi.fn(),
  objectExists: vi.fn(),
  confirm: vi.fn(),
  cleanup: vi.fn(),
  upload: vi.fn(),
}));
vi.mock('@/src/lib/repositories/expenseCapture', () => ({
  expenseCaptureRepository: { create: h.create, prepareReceipt: h.prepare, objectExists: h.objectExists },
  confirmExpenseCaptureReceipt: h.confirm,
  cleanupUnlinkedExpenseCaptureReceipt: h.cleanup,
}));
vi.mock('@/src/lib/uploadTransport', () => ({ uploadWithProgress: h.upload }));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 'user-29', org_id: 'org-29' } }) }));

import { useExpenseCapture } from './useExpenseCapture';
import { EXPENSE_QUERY_ROOTS } from './useExpenseClaims';

const captureInput = {
  header: {
    kind: 'claim' as const,
    title: 'Taxi to project site',
    purpose: null,
    projectId: 'project-29',
    budgetCategory: 'Special expenses' as const,
    advanceId: null,
  },
  firstLine: {
    expenseDate: '2026-10-07',
    expenseType: 'Travel' as const,
    description: 'Taxi to project site',
    amount: 150000,
  },
  receiptFile: new File(['receipt'], 'taxi.pdf', { type: 'application/pdf' }),
};

const setup = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const wrapper = ({ children }: { children: React.ReactNode }) => React.createElement(QueryClientProvider, { client }, children);
  const hook = renderHook(() => useExpenseCapture(), { wrapper });
  return { ...hook, client };
};

describe('AC-S29-003 recoverable receipt capture hook', () => {
  beforeEach(() => {
    for (const fn of Object.values(h)) fn.mockReset();
    h.create.mockImplementation(async (command: { claimId: string }) => command.claimId);
    h.prepare.mockResolvedValue({ signedUrl: 'https://upload.invalid/signed', path: 'org-29/00000000-0000-4000-8000-000000000029/00000000-0000-4000-8000-000000000031/taxi.pdf' });
    h.objectExists.mockResolvedValue(false);
    h.confirm.mockResolvedValue({ id: '00000000-0000-4000-8000-000000000031', claim_id: '00000000-0000-4000-8000-000000000029', file_path: 'org-29/00000000-0000-4000-8000-000000000029/00000000-0000-4000-8000-000000000031/taxi.pdf' });
    h.upload.mockResolvedValue(undefined);
  });

  it('AC-S29-003 keeps stable claim, line, file and path through upload failure and same-draft retry', async () => {
    const uuid = vi.spyOn(globalThis.crypto, 'randomUUID')
      .mockReturnValueOnce('00000000-0000-4000-8000-000000000029')
      .mockReturnValueOnce('00000000-0000-4000-8000-000000000030')
      .mockReturnValueOnce('00000000-0000-4000-8000-000000000031');
    h.upload.mockRejectedValueOnce(new Error('network response lost'));
    h.objectExists.mockResolvedValueOnce(false).mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const { result, client } = setup();
    const invalidate = vi.spyOn(client, 'invalidateQueries');

    await act(async () => { await expect(result.current.capture(captureInput)).rejects.toThrow('network response lost'); });
    expect(result.current.recovery).toMatchObject({ claimId: '00000000-0000-4000-8000-000000000029', draftSaved: true, phase: 'receipt-upload-failed' });
    const firstCommand = h.create.mock.calls[0][0];
    expect(firstCommand).toMatchObject({ claimId: '00000000-0000-4000-8000-000000000029', lineId: '00000000-0000-4000-8000-000000000030', header: captureInput.header, firstLine: captureInput.firstLine });
    expect(h.prepare).toHaveBeenCalledWith('00000000-0000-4000-8000-000000000029', '00000000-0000-4000-8000-000000000031', 'taxi.pdf');
    expect(h.upload.mock.invocationCallOrder[0]).toBeGreaterThan(h.create.mock.invocationCallOrder[0]);
    expect(h.confirm).not.toHaveBeenCalled();

    await act(async () => { await expect(result.current.capture(captureInput)).resolves.toBe('00000000-0000-4000-8000-000000000029'); });
    expect(uuid).toHaveBeenCalledTimes(3);
    expect(h.create).toHaveBeenCalledTimes(1);
    expect(h.prepare).toHaveBeenCalledTimes(2);
    expect(h.prepare.mock.calls[1]).toEqual(h.prepare.mock.calls[0]);
    expect(h.upload).toHaveBeenCalledTimes(1);
    expect(h.confirm).toHaveBeenCalledWith('00000000-0000-4000-8000-000000000029', '00000000-0000-4000-8000-000000000031', 'org-29/00000000-0000-4000-8000-000000000029/00000000-0000-4000-8000-000000000031/taxi.pdf');
    await waitFor(() => expect(result.current.recovery).toMatchObject({ claimId: '00000000-0000-4000-8000-000000000029', draftSaved: true, phase: 'complete' }));
    for (const root of EXPENSE_QUERY_ROOTS) expect(invalidate).toHaveBeenCalledWith({ queryKey: [root] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['expense-receipts', 'org-29', '00000000-0000-4000-8000-000000000029'] });
    uuid.mockRestore();
  });

  it('AC-S29-003 creates one stable line without receipt storage work', async () => {
    vi.spyOn(globalThis.crypto, 'randomUUID').mockReturnValueOnce('00000000-0000-4000-8000-000000000039').mockReturnValueOnce('00000000-0000-4000-8000-000000000040');
    const { result } = setup();
    const lineOnly = { ...captureInput, receiptFile: null };
    await act(async () => { await expect(result.current.capture(lineOnly)).resolves.toBe('00000000-0000-4000-8000-000000000039'); });

    expect(h.create).toHaveBeenCalledWith(expect.objectContaining({ claimId: '00000000-0000-4000-8000-000000000039', lineId: '00000000-0000-4000-8000-000000000040' }));
    expect(h.prepare).not.toHaveBeenCalled();
    expect(h.upload).not.toHaveBeenCalled();
    expect(h.confirm).not.toHaveBeenCalled();
  });
});
