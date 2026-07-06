import type { ModelMessage } from '../_shared/modelClient.ts';
import type { DeputyContext } from '../../../pmo-portal/src/lib/agent/runtime/port.ts';

export const AGENT_ATTACHMENT_TEXT_CHAR_CAP = 16_000;
const BUCKET = 'agent-attachments';

export type AttachmentTextStatus = 'pending' | 'ready' | 'failed' | 'skipped';

export interface ResolvedAttachment {
  id: string;
  originalFilename: string;
  mimeType: string;
  extractedTextStatus: AttachmentTextStatus;
  extractedText?: string | null;
}

interface AttachmentRow {
  id: string;
  original_filename: string;
  mime_type: string;
  storage_path: string;
  extracted_text_status: AttachmentTextStatus;
  extracted_text: string | null;
  archived_at?: string | null;
}

interface AttachmentStorageLike {
  storage?: {
    from(bucket: string): {
      download(path: string): PromiseLike<{ data: Blob | null; error: unknown }>;
    };
  };
  from(table: string): {
    select(columns: string): {
      in(column: string, values: string[]): {
        limit(n: number): PromiseLike<{ data: unknown[] | null; error: unknown }>;
      };
    };
    update?(patch: object): {
      eq(column: string, value: string): PromiseLike<{ data: unknown; error: unknown }>;
    };
  };
}

export interface PdfExtractionResult {
  text: string | null;
  status: Extract<AttachmentTextStatus, 'ready' | 'failed' | 'skipped'>;
}

export type ExtractPdfText = (bytes: Uint8Array) => Promise<PdfExtractionResult>;

async function defaultExtractPdfText(_bytes: Uint8Array): Promise<PdfExtractionResult> {
  return { text: null, status: 'skipped' };
}

function boundText(text: string): { text: string; truncated: boolean } {
  if (text.length <= AGENT_ATTACHMENT_TEXT_CHAR_CAP) {
    return { text, truncated: false };
  }
  return {
    text: text.slice(0, AGENT_ATTACHMENT_TEXT_CHAR_CAP),
    truncated: true,
  };
}

function contextForAttachment(attachment: ResolvedAttachment): string {
  if (attachment.extractedTextStatus !== 'ready' || !attachment.extractedText) {
    return [
      `[Untrusted attachment content: ${attachment.originalFilename}]`,
      `Attachment id: ${attachment.id}`,
      `MIME type: ${attachment.mimeType}`,
      `Status: ${attachment.extractedTextStatus}. The assistant cannot read this attachment's text yet.`,
      '[/Untrusted attachment content]',
    ].join('\n');
  }

  const bounded = boundText(attachment.extractedText);
  return [
    `[Untrusted attachment content: ${attachment.originalFilename}]`,
    `Attachment id: ${attachment.id}`,
    `MIME type: ${attachment.mimeType}`,
    bounded.text,
    bounded.truncated ? '[truncated]' : '',
    '[/Untrusted attachment content]',
  ].filter(Boolean).join('\n');
}

export function buildAttachmentContextMessages(
  attachments: ResolvedAttachment[],
): ModelMessage[] {
  return attachments.map((attachment) => ({
    role: 'user',
    content: contextForAttachment(attachment),
  }));
}

async function blobToBytes(blob: Blob): Promise<Uint8Array> {
  return new Uint8Array(await blob.arrayBuffer());
}

async function updateExtractionStatus(
  supabase: AttachmentStorageLike,
  attachmentId: string,
  result: PdfExtractionResult,
): Promise<void> {
  try {
    const update = supabase
      .from('agent_attachments')
      .update?.({
        extracted_text_status: result.status,
        extracted_text: result.text,
        extracted_text_chars: result.text?.length ?? null,
      });
    if (update) {
      await update.eq('id', attachmentId);
    }
  } catch {
    // Extraction cache updates are best-effort. The bounded context for this
    // turn is already built from the in-memory extraction result.
  }
}

async function resolveAttachmentRows(ids: string[], ctx: DeputyContext): Promise<AttachmentRow[]> {
  const cleanIds = [...new Set(ids.map((id) => id.trim()).filter(Boolean))];
  if (cleanIds.length === 0) return [];

  const supabase = ctx.supabase as unknown as AttachmentStorageLike;
  const { data, error } = await supabase
    .from('agent_attachments')
    .select('id, original_filename, mime_type, storage_path, extracted_text_status, extracted_text, archived_at')
    .in('id', cleanIds)
    .limit(cleanIds.length);
  if (error || !data) return [];
  return (data as AttachmentRow[]).filter((row) => !row.archived_at);
}

async function resolveOneAttachment(
  row: AttachmentRow,
  ctx: DeputyContext,
  extractPdfText: ExtractPdfText,
): Promise<ResolvedAttachment> {
  if (row.extracted_text_status === 'ready' && row.extracted_text) {
    return {
      id: row.id,
      originalFilename: row.original_filename,
      mimeType: row.mime_type,
      extractedTextStatus: 'ready',
      extractedText: row.extracted_text,
    };
  }

  if (row.mime_type !== 'application/pdf') {
    return {
      id: row.id,
      originalFilename: row.original_filename,
      mimeType: row.mime_type,
      extractedTextStatus: 'skipped',
      extractedText: null,
    };
  }

  const supabase = ctx.supabase as unknown as AttachmentStorageLike;
  const downloaded = await supabase.storage?.from(BUCKET).download(row.storage_path);
  if (!downloaded?.data || downloaded.error) {
    return {
      id: row.id,
      originalFilename: row.original_filename,
      mimeType: row.mime_type,
      extractedTextStatus: 'failed',
      extractedText: null,
    };
  }

  const result = await extractPdfText(await blobToBytes(downloaded.data));
  await updateExtractionStatus(supabase, row.id, result);
  return {
    id: row.id,
    originalFilename: row.original_filename,
    mimeType: row.mime_type,
    extractedTextStatus: result.status,
    extractedText: result.text,
  };
}

export function createAttachmentResolver(
  opts: { extractPdfText?: ExtractPdfText } = {},
): {
  resolveAttachmentMessages(attachmentIds: string[], deputyCtx: DeputyContext): Promise<ModelMessage[]>;
} {
  const extractPdfText = opts.extractPdfText ?? defaultExtractPdfText;
  return {
    async resolveAttachmentMessages(attachmentIds, deputyCtx) {
      const rows = await resolveAttachmentRows(attachmentIds, deputyCtx);
      const resolved = await Promise.all(
        rows.map((row) => resolveOneAttachment(row, deputyCtx, extractPdfText)),
      );
      return buildAttachmentContextMessages(resolved);
    },
  };
}
