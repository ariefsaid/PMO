import { supabase } from '@/src/lib/supabase/client';
import { invokeWithTimeout } from '@/src/lib/supabase/invokeWithTimeout';
import { PreviewFailure, type PreviewFailureKind, type PreviewResult } from '@/src/components/documents/types';
import {
  validPreviewEmbedUrl,
  type PreviewDocumentRequest,
  type PreviewDocumentResponse,
} from '../../../../supabase/functions/_shared/microsoftDocumentPreview';

export type { PreviewDocumentRequest } from '../../../../supabase/functions/_shared/microsoftDocumentPreview';

const FUNCTION_NAME = 'm365-token-custody';

/** The typed identity a caller names; `Omit` over the union would collapse it, so the action is dropped per member. */
export type PreviewRequestInput = PreviewDocumentRequest extends infer R ? (R extends unknown ? Omit<R, 'action'> : never) : never;

/** The wire error code of a failed invoke, plus Microsoft's throttling hint when the server sent one. */
export async function parseInvokeFailure(error: unknown): Promise<{ code?: string; retryAfter?: number }> {
  const context = (error as { context?: Response } | null)?.context;
  if (!context || typeof context.clone !== 'function') return {};
  const header = Number(context.headers?.get?.('Retry-After'));
  try {
    const body = (await context.clone().json()) as { error?: unknown; retry_after_seconds?: unknown };
    const retry = typeof body?.retry_after_seconds === 'number' ? body.retry_after_seconds : header;
    return {
      code: typeof body?.error === 'string' ? body.error : undefined,
      retryAfter: Number.isFinite(retry) && retry > 0 ? Math.min(Math.floor(retry), 30) : undefined,
    };
  } catch {
    return { retryAfter: Number.isFinite(header) && header > 0 ? Math.min(Math.floor(header), 30) : undefined };
  }
}

const KIND_BY_CODE: Record<string, PreviewFailureKind> = {
  SOURCE_ACCESS_DENIED: 'access_denied',
  NOT_CONNECTED: 'not_connected',
  CONNECTION_STALE: 'connection_stale',
  CONNECTION_REVOKED: 'connection_stale',
  SCOPE_INSUFFICIENT: 'consent_needed',
  SOURCE_NOT_FOUND: 'not_found',
  PREVIEW_UNSUPPORTED: 'unsupported',
  RATE_LIMITED: 'rate_limited',
};

/**
 * Ask custody for an embeddable Microsoft preview of one typed document identity, with the caller's OWN
 * connection. The browser never names a drive, item or URL. The returned URL is short-lived: it is handed
 * straight to the viewer's state and never written to a cache, log or storage (NFR-002).
 */
export async function previewMicrosoftDocument(
  request: PreviewRequestInput,
  signal?: AbortSignal,
): Promise<PreviewResult> {
  const { data, error } = await invokeWithTimeout(
    supabase.functions.invoke<PreviewDocumentResponse>(FUNCTION_NAME, {
      body: { action: 'preview_document', ...request },
    }),
  );
  if (signal?.aborted) throw new PreviewFailure('unavailable');
  if (error) {
    const { code, retryAfter } = await parseInvokeFailure(error);
    const throttled = code === 'GRAPH_ERROR' && retryAfter !== undefined;
    throw new PreviewFailure(throttled ? 'rate_limited' : (code && KIND_BY_CODE[code]) || 'unavailable', retryAfter);
  }
  const url = data && typeof data === 'object' ? (data as Partial<PreviewDocumentResponse>).get_url : undefined;
  if (!validPreviewEmbedUrl(url)) throw new PreviewFailure('unavailable');
  return { mode: 'embed', provider: 'microsoft', url };
}
