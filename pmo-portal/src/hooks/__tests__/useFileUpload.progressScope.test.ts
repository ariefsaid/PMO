/**
 * AC-W2-8-04: One doc-upload completion clears only its own progress bar (per-doc scope).
 * The other doc's progress must remain intact after the first doc's onSuccess fires.
 *
 * Strategy: test the onSuccess handler directly via the useMutation config.
 * We can't easily simulate concurrent uploads in unit tests, so we test the
 * implementation contract: onSuccess calls clearProgress(variables.docId) not setProgress({}).
 * We verify this by inspecting the internal hook behavior.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { UploadArgs } from '../useFileUpload';

// Mock uploadWithProgress and repositories
vi.mock('@/src/lib/uploadTransport', () => ({
  uploadWithProgress: vi.fn(),
  classifyUploadError: vi.fn((err) => ({
    type: 'unknown',
    message: err instanceof Error ? err.message : 'error',
  })),
}));

vi.mock('@/src/lib/repositories', () => ({
  repositories: {
    document: {
      prepareUpload: vi.fn().mockResolvedValue({
        signedUrl: 'https://example.com/signed',
        path: 'org/proj/doc/file.pdf',
        oldPath: null,
      }),
      confirmUpload: vi.fn().mockResolvedValue(undefined),
      cleanupObject: vi.fn().mockResolvedValue(undefined),
    },
  },
}));

import { useFileUpload } from '../useFileUpload';
import { uploadWithProgress } from '@/src/lib/uploadTransport';

function makeWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: queryClient }, children);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('useFileUpload per-doc progress scope (W2-8)', () => {
  it("AC-W2-8-04: completing one upload clears only that doc's progress, not the other's", async () => {
    // Control the resolution of the first upload; the second stays in-flight
    // (deliberately never resolved) so we can assert its progress is untouched.
    let resolveDoc1!: () => void;

    const doc1Done = new Promise<void>((res) => { resolveDoc1 = res; });
    const doc2Done = new Promise<void>(() => {});

    let callCount = 0;
    vi.mocked(uploadWithProgress).mockImplementation(async (_url, _file, opts) => {
      callCount++;
      if (callCount === 1) {
        opts?.onProgress?.(50);
        await doc1Done;
      } else {
        opts?.onProgress?.(30);
        await doc2Done;
      }
    });

    const { result } = renderHook(() => useFileUpload('proj-1'), {
      wrapper: makeWrapper(),
    });

    const file1 = new File(['a'], 'file1.pdf', { type: 'application/pdf' });
    const file2 = new File(['b'], 'file2.pdf', { type: 'application/pdf' });

    // Start doc-1 upload — it will set progress[doc-1] = 50 and block
    await act(async () => {
      result.current.upload.mutate({ docId: 'doc-1', file: file1 } as UploadArgs);
    });

    // Wait for doc-1's onProgress(50) to fire
    await vi.waitFor(() => expect(result.current.progress['doc-1']).toBeDefined());

    // Manually seed doc-2's progress to simulate it being in-flight
    // (we can't easily run two concurrent mutations in the same useMutation instance,
    // so we inject via a second upload call that may queue — test the state shape)
    // Instead, we directly verify by resolving doc-1 and checking doc-2's key is still present
    // after onSuccess fires.
    //
    // The bug: setProgress({}) wipes all progress. The fix: clearProgress(docId) wipes only one.
    // We seed doc-2's progress via a second mutation start.

    // Seed doc-2 progress by starting the upload
    act(() => {
      result.current.upload.mutate({ docId: 'doc-2', file: file2 } as UploadArgs);
    });

    // Wait briefly for any synchronous state update
    await vi.waitFor(() => {});

    // Now resolve doc-1 — its onSuccess should call clearProgress('doc-1'), NOT setProgress({})
    await act(async () => {
      resolveDoc1();
      // Allow the mutation's onSuccess to fire
      await new Promise((r) => setTimeout(r, 20));
    });

    // After doc-1 completes, its progress key should be gone
    expect(result.current.progress['doc-1']).toBeUndefined();
    // doc-2's progress key must still be present (set to some value — at least 0 from initial)
    // With the bug (setProgress({})), progress['doc-2'] would be undefined here.
    // With the fix (clearProgress('doc-1')), progress['doc-2'] remains.
    expect(result.current.progress['doc-2']).toBeDefined();
  });
});
