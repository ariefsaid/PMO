import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { ToastProvider } from '@/src/components/ui';
import { ImpersonationProvider, useEffectiveRole } from '@/src/auth/impersonation';
import type { Role } from '@/src/auth/AuthContext';

const h = vi.hoisted(() => ({
  downloadInvoicePdf: vi.fn(),
  triggerBlobDownload: vi.fn(),
  toast: vi.fn(),
}));
vi.mock('@/src/lib/repositories', async (orig) => {
  const actual = await orig<typeof import('@/src/lib/repositories')>();
  return { ...actual, repositories: { revenue: { downloadInvoicePdf: h.downloadInvoicePdf } } };
});
vi.mock('@/src/lib/download', () => ({ triggerBlobDownload: h.triggerBlobDownload }));
vi.mock('@/src/components/ui', async (orig) => {
  const actual = await orig<typeof import('@/src/components/ui')>();
  return { ...actual, useToast: () => ({ toast: h.toast }) };
});

import { useInvoicePdfDownload } from '../useInvoicePdfDownload';

const freshClient = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });

/** Real ImpersonationProvider (the hook's actual role source) with an optional
 *  demo-org view-as applied on mount — mirrors how Shell threads the context.
 *  `client` lets a test spy on the exact QueryClient the hook resolves via useQueryClient. */
function ViewAsRole({ role, children }: { role?: Role; children: React.ReactNode }) {
  const { viewAs } = useEffectiveRole();
  React.useEffect(() => {
    if (role) viewAs(role);
  }, [viewAs, role]);
  return <>{children}</>;
}

function Wrapper({ realRole, viewAs, client }: { realRole: Role; viewAs?: Role; client: QueryClient }) {
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>
      <ToastProvider>
        <ImpersonationProvider realRole={realRole} demoEligibility="eligible">
          <ViewAsRole role={viewAs}>{children}</ViewAsRole>
        </ImpersonationProvider>
      </ToastProvider>
    </QueryClientProvider>
  );
}

const INVOICE = { id: 'si-1', si_number: 'ACC-SINV-2026-00001' };
const refusal = (code: string) => Object.assign(new Error(code), { code });

beforeEach(() => {
  vi.clearAllMocks();
});

// Pins for #912's hook contract (the page tests cover the positive paths end-to-end;
// these pin the two behaviours at the hook seam so a refactor cannot silently flip them).
describe('useInvoicePdfDownload', () => {
  it('an ERP_NOT_PERMITTED refusal does NOT refetch the sales-invoices list (STALE_LIST_CODES polarity)', async () => {
    h.downloadInvoicePdf.mockRejectedValueOnce(refusal('ERP_NOT_PERMITTED'));
    const qc = freshClient();
    const invalidate = vi.spyOn(qc, 'invalidateQueries');
    const { result } = renderHook(() => useInvoicePdfDownload(), {
      wrapper: Wrapper({ realRole: 'Finance', client: qc }),
    });
    await act(async () => {
      await result.current.download(INVOICE);
    });
    // The warning toast still fires…
    expect(h.toast).toHaveBeenCalledWith(
      expect.anything(),
      expect.stringContaining('Ask your administrator'),
      'warning',
    );
    // …but a permission refusal is not a stale mirror — no list refetch.
    expect(invalidate).not.toHaveBeenCalled();
  });

  it('a real Admin viewing-as Finance still gets the Admin copy (the hook reads realRole, not effectiveRole)', async () => {
    h.downloadInvoicePdf.mockRejectedValueOnce(refusal('ERP_NOT_PERMITTED'));
    const { result } = renderHook(() => useInvoicePdfDownload(), {
      wrapper: Wrapper({ realRole: 'Admin', viewAs: 'Finance', client: freshClient() }),
    });
    await act(async () => {
      await result.current.download(INVOICE);
    });
    const [, remedy] = h.toast.mock.calls.at(-1)!;
    // The Admin is told where to fix it — even while wearing the Finance hat.
    expect(remedy).toContain('Open Administration → Integrations');
    expect(remedy).not.toContain('Ask your administrator');
  });
});
