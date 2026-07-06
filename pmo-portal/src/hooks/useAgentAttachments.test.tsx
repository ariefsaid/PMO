import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('@/src/lib/uploadTransport', () => ({
  uploadWithProgress: vi.fn(),
  classifyUploadError: vi.fn((err) => {
    if (err instanceof Error && err.message.includes('bad')) {
      return { type: 'server', message: 'Upload failed — try again' };
    }
    return { type: 'server', message: 'Upload failed — try again' };
  }),
}));

vi.mock('@/src/lib/repositories', () => ({
  repositories: {
    agentAttachment: {
      prepareUpload: vi.fn().mockResolvedValue({
        attachmentId: 'att-1',
        signedUrl: 'https://signed/upload',
        path: 'org/org-1/agent-attachments/att-1',
      }),
      confirmUpload: vi.fn().mockResolvedValue(undefined),
      cleanupObject: vi.fn().mockResolvedValue(undefined),
      // MINOR-7 (review): the hook routes thread creation through the repository seam
      // (ADR-0017), never importing the DAL directly.
      createThread: vi.fn().mockResolvedValue({ id: 'prepared-thread' }),
    },
  },
}));

import { useAgentAttachments } from './useAgentAttachments';
import { repositories } from '@/src/lib/repositories';
import { uploadWithProgress } from '@/src/lib/uploadTransport';

function wrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: queryClient }, children);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(uploadWithProgress).mockImplementation(async (_url, _file, opts) => {
    opts?.onProgress?.(40);
    opts?.onProgress?.(100);
  });
});

describe('useAgentAttachments upload flow', () => {
  it('AC-AT2-001 uploads with progress, confirms the row, and returns attachment id only', async () => {
    const { result } = renderHook(() => useAgentAttachments('thread-1'), { wrapper: wrapper() });
    const file = new File(['pdf'], 'quote.pdf', { type: 'application/pdf' });

    let attachmentId = '';
    await act(async () => {
      attachmentId = await result.current.uploadAttachment(file);
    });

    expect(repositories.agentAttachment.prepareUpload).toHaveBeenCalledWith('thread-1', file);
    expect(uploadWithProgress).toHaveBeenCalledWith('https://signed/upload', file, expect.objectContaining({
      contentType: 'application/pdf',
      upsert: false,
    }));
    expect(repositories.agentAttachment.confirmUpload).toHaveBeenCalledWith('att-1');
    expect(attachmentId).toBe('att-1');
    await waitFor(() => expect(result.current.progress['att-1']).toBeUndefined());
  });

  it('AC-AT2-002 upload failure cleans up the prepared object and records an error without blocking text send', async () => {
    vi.mocked(uploadWithProgress).mockRejectedValueOnce(new Error('bad network'));
    const { result } = renderHook(() => useAgentAttachments('thread-1'), { wrapper: wrapper() });

    let thrown: unknown;
    await act(async () => {
      try {
        await result.current.uploadAttachment(new File(['pdf'], 'quote.pdf', { type: 'application/pdf' }));
      } catch (err) {
        thrown = err;
      }
    });

    expect(thrown).toMatchObject({ message: 'bad network' });
    expect(repositories.agentAttachment.cleanupObject).toHaveBeenCalledWith('org/org-1/agent-attachments/att-1');
    expect(result.current.error).toEqual({ type: 'server', message: 'Upload failed — try again' });
  });

  it('AC-AT2-001 prepares a thread when the user attaches before the first send', async () => {
    const { result } = renderHook(() => useAgentAttachments(null), { wrapper: wrapper() });

    await act(async () => {
      await result.current.uploadAttachment(new File(['pdf'], 'quote.pdf', { type: 'application/pdf' }));
    });

    expect(repositories.agentAttachment.createThread).toHaveBeenCalledWith();
    expect(repositories.agentAttachment.prepareUpload).toHaveBeenCalledWith(
      'prepared-thread',
      expect.any(File),
    );
    expect(result.current.threadId).toBe('prepared-thread');
  });

  it('CRITICAL-1 resetThread clears the sticky prepared thread so the next upload mints a new thread', async () => {
    // Two successive uploads must bind to two DIFFERENT threads once a New Conversation
    // reset has fired — proving the preparedThreadId does NOT leak across conversations
    // (review finding CRITICAL-1).
    vi.mocked(repositories.agentAttachment.createThread)
      .mockResolvedValueOnce({ id: 'thread-T1' })
      .mockResolvedValueOnce({ id: 'thread-T2' });

    const { result } = renderHook(() => useAgentAttachments(null), { wrapper: wrapper() });
    const file = new File(['pdf'], 'quote.pdf', { type: 'application/pdf' });

    await act(async () => {
      await result.current.uploadAttachment(file);
    });
    expect(result.current.threadId).toBe('thread-T1');
    expect(repositories.agentAttachment.prepareUpload).toHaveBeenLastCalledWith(
      'thread-T1',
      expect.any(File),
    );

    // New conversation resets the prepared thread back to the prop (null).
    act(() => {
      result.current.resetThread();
    });
    expect(result.current.threadId).toBeNull();

    await act(async () => {
      await result.current.uploadAttachment(file);
    });
    // The next upload mints a fresh thread — NOT the stale T1.
    expect(result.current.threadId).toBe('thread-T2');
    expect(result.current.threadId).not.toBe('thread-T1');
    expect(repositories.agentAttachment.prepareUpload).toHaveBeenLastCalledWith(
      'thread-T2',
      expect.any(File),
    );
  });
});
