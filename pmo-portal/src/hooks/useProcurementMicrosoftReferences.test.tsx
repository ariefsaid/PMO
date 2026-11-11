import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

const { procurement } = vi.hoisted(() => ({
  procurement: {
    listDocuments: vi.fn(),
    createMicrosoftDocument: vi.fn(),
    linkMicrosoftDocument: vi.fn(),
    unlinkMicrosoftDocument: vi.fn(),
    clearDocumentLink: vi.fn(),
  },
}));
vi.mock('@/src/lib/repositories', () => ({ repositories: { procurement } }));
vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'user-1', org_id: 'org-1' } }),
}));

import { useProcurementMicrosoftReferences } from './useProcurementMicrosoftReferences';

const wrap = (client: QueryClient) =>
  function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
const freshClient = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });

const reference = {
  drive_id: 'drive-1', item_id: 'item-1', web_url: 'https://example.invalid/doc',
  name: 'Synthetic doc', item_kind: 'file' as const,
};
const rows = [
  { id: 'r1', procurement_id: 'case-1', type: 'Quote', link: 'https://legacy.invalid/x', source: null },
  { id: 'r2', procurement_id: 'case-1', type: 'Microsoft reference', link: reference.web_url, source: 'onedrive' },
];

beforeEach(() => {
  vi.clearAllMocks();
  procurement.listDocuments.mockResolvedValue(rows);
  procurement.createMicrosoftDocument.mockResolvedValue({ ...rows[1], id: 'r3' });
  procurement.linkMicrosoftDocument.mockResolvedValue(undefined);
  procurement.unlinkMicrosoftDocument.mockResolvedValue(undefined);
  procurement.clearDocumentLink.mockResolvedValue(undefined);
});

describe('useProcurementMicrosoftReferences', () => {
  it('AC-M365DOC-051: queries the case register by case id only, org-scoped, returning legacy rows too', async () => {
    const client = freshClient();
    const { result } = renderHook(() => useProcurementMicrosoftReferences('case-1'), { wrapper: wrap(client) });
    await waitFor(() => expect(result.current.query.isSuccess).toBe(true));
    expect(procurement.listDocuments).toHaveBeenCalledWith('case-1');
    expect(result.current.query.data).toHaveLength(2);
    expect(client.getQueryCache().findAll({ queryKey: ['procurement-documents', 'org-1', 'case-1'] })).toHaveLength(1);
  });

  it('AC-PFE-009: create forwards an attach-to target to the repository', async () => {
    const { result } = renderHook(() => useProcurementMicrosoftReferences('case-1'), { wrapper: wrap(freshClient()) });
    const target = { recordKind: 'vendor_invoice' as const, recordId: 'vi-1' };
    await act(async () => { await result.current.create.mutateAsync({ reference, target }); });
    expect(procurement.createMicrosoftDocument).toHaveBeenCalledWith('case-1', reference, undefined, target);
  });

  it('AC-M365DOC-051: is disabled without a case id', () => {
    const { result } = renderHook(() => useProcurementMicrosoftReferences(''), { wrapper: wrap(freshClient()) });
    expect(procurement.listDocuments).not.toHaveBeenCalled();
    expect(result.current.query.fetchStatus).toBe('idle');
  });

  it('AC-M365DOC-062: create/link/unlink/clear call the repository and invalidate only the case register', async () => {
    const client = freshClient();
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    const { result } = renderHook(() => useProcurementMicrosoftReferences('case-1'), { wrapper: wrap(client) });
    await act(async () => {
      const created = await result.current.create.mutateAsync({ reference, metadata: { referenceNumber: 'R-1', date: '2026-10-14' } });
      expect(created.id).toBe('r3');
      await result.current.link.mutateAsync({ id: 'r1', reference });
      await result.current.unlink.mutateAsync('r2');
      await result.current.clearLegacy.mutateAsync('r1');
    });
    expect(procurement.createMicrosoftDocument).toHaveBeenCalledWith('case-1', reference, { referenceNumber: 'R-1', date: '2026-10-14' });
    expect(procurement.linkMicrosoftDocument).toHaveBeenCalledWith('r1', reference);
    expect(procurement.unlinkMicrosoftDocument).toHaveBeenCalledWith('r2');
    expect(procurement.clearDocumentLink).toHaveBeenCalledWith('r1');
    expect(invalidate).toHaveBeenCalledTimes(4);
    for (const call of invalidate.mock.calls) {
      expect(call[0]).toEqual({ queryKey: ['procurement-documents', 'org-1', 'case-1'] });
    }
  });

  it('AC-M365DOC-062: a denied zero-row write surfaces the repository error and invalidates nothing', async () => {
    const client = freshClient();
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    procurement.unlinkMicrosoftDocument.mockRejectedValue(Object.assign(new Error('Document not found or you do not have permission to edit it.'), { code: '42501' }));
    const { result } = renderHook(() => useProcurementMicrosoftReferences('case-1'), { wrapper: wrap(client) });
    await act(async () => {
      await expect(result.current.unlink.mutateAsync('r2')).rejects.toMatchObject({ code: '42501' });
    });
    expect(invalidate).not.toHaveBeenCalled();
  });
});
