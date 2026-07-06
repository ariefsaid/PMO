import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => {
  const result = { value: { data: null as unknown, error: null as unknown } };
  const calls = {
    from: [] as unknown[],
    select: [] as unknown[],
    eq: [] as unknown[],
    insert: [] as unknown[],
    update: [] as unknown[],
    maybeSingle: 0,
    single: 0,
  };
  const builder: Record<string, unknown> = {};
  const chain = (name: keyof typeof calls) => (...args: unknown[]) => {
    if (name === 'maybeSingle' || name === 'single') {
      (calls[name] as number)++;
    } else {
      (calls[name] as unknown[]).push(args.length === 1 ? args[0] : args);
    }
    return builder;
  };
  builder.select = chain('select');
  builder.eq = chain('eq');
  builder.insert = chain('insert');
  builder.update = chain('update');
  builder.maybeSingle = chain('maybeSingle');
  builder.single = chain('single');
  builder.then = (resolve: (v: unknown) => unknown) => resolve(result.value);

  const from = vi.fn((table: string) => {
    calls.from.push(table);
    return builder;
  });

  const storageResult = {
    value: {
      data: {
        signedUrl: 'https://signed/upload',
        path: 'org/org-1/agent-attachments/att-1',
      },
      error: null as unknown,
    },
  };
  const storageCalls = {
    bucket: [] as unknown[],
    createSignedUploadUrl: [] as unknown[],
    remove: [] as unknown[],
  };
  const storageBuilder = {
    createSignedUploadUrl: vi.fn((path: string) => {
      storageCalls.createSignedUploadUrl.push(path);
      return Promise.resolve(storageResult.value);
    }),
    remove: vi.fn((paths: string[]) => {
      storageCalls.remove.push(paths);
      return Promise.resolve({ data: [], error: null });
    }),
  };
  const storage = {
    from: vi.fn((bucket: string) => {
      storageCalls.bucket.push(bucket);
      return storageBuilder;
    }),
  };

  return { from, calls, result, storage, storageCalls, storageResult };
});

vi.mock('@/src/lib/supabase/client', () => ({ supabase: { from: h.from, storage: h.storage } }));

import {
  prepareAgentAttachmentUpload,
  confirmAgentAttachmentUpload,
  cleanupAgentAttachmentObject,
} from './agentAttachments';

beforeEach(() => {
  h.from.mockClear();
  for (const k of Object.keys(h.calls) as (keyof typeof h.calls)[]) {
    if (typeof h.calls[k] === 'number') (h.calls[k] as unknown) = 0;
    else (h.calls[k] as unknown[]).length = 0;
  }
  h.result.value = { data: null, error: null };
  h.storage.from.mockClear();
  h.storageCalls.bucket.length = 0;
  h.storageCalls.createSignedUploadUrl.length = 0;
  h.storageCalls.remove.length = 0;
  h.storageResult.value = {
    data: { signedUrl: 'https://signed/upload', path: 'org/org-1/agent-attachments/att-1' },
    error: null,
  };
});

describe('agent attachment DAL', () => {
  it('AC-AT2-004 prepares upload by inserting metadata first and creating a signed URL for the row path', async () => {
    h.result.value = {
      data: {
        id: 'att-1',
        storage_path: 'org/org-1/agent-attachments/att-1',
      },
      error: null,
    };

    const res = await prepareAgentAttachmentUpload({
      threadId: 'thread-1',
      fileName: 'Quote.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 512,
    });

    expect(h.calls.from).toContain('agent_attachments');
    expect(h.calls.insert[0]).toEqual({
      thread_id: 'thread-1',
      mime_type: 'application/pdf',
      size_bytes: 512,
      original_filename: 'Quote.pdf',
    });
    expect(h.storageCalls.bucket).toEqual(['agent-attachments']);
    expect(h.storageCalls.createSignedUploadUrl).toEqual(['org/org-1/agent-attachments/att-1']);
    expect(res).toEqual({
      attachmentId: 'att-1',
      signedUrl: 'https://signed/upload',
      path: 'org/org-1/agent-attachments/att-1',
    });
  });

  it('AC-AT2-004 rejects disallowed MIME before inserting an attachment row', async () => {
    await expect(
      prepareAgentAttachmentUpload({
        threadId: 'thread-1',
        fileName: 'evil.exe',
        mimeType: 'application/x-msdownload',
        sizeBytes: 10,
      }),
    ).rejects.toMatchObject({ code: 'P0001' });
    expect(h.calls.from).toHaveLength(0);
    expect(h.storageCalls.createSignedUploadUrl).toHaveLength(0);
  });

  it('AC-AT2-004 confirmUpload marks the prepared attachment ready for resolver lookup', async () => {
    h.result.value = { data: null, error: null };
    await confirmAgentAttachmentUpload('att-1');
    expect(h.calls.from).toEqual(['agent_attachments']);
    expect(h.calls.update[0]).toEqual({ extracted_text_status: 'pending', archived_at: null });
    expect(h.calls.eq).toContainEqual(['id', 'att-1']);
  });

  it('AC-AT2-004 cleanup removes storage and soft-archives the prepared row by path', async () => {
    h.result.value = { data: null, error: null };
    await cleanupAgentAttachmentObject('org/org-1/agent-attachments/att-1');
    expect(h.storageCalls.bucket).toEqual(['agent-attachments']);
    expect(h.storageCalls.remove).toEqual([['org/org-1/agent-attachments/att-1']]);
    expect(h.calls.from).toEqual(['agent_attachments']);
    expect(h.calls.update[0]).toMatchObject({ archived_at: expect.any(String) });
    expect(h.calls.eq).toContainEqual(['storage_path', 'org/org-1/agent-attachments/att-1']);
  });
});
