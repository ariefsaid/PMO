import { AppError, toAppError } from '@/src/lib/appError';
import { supabase } from '@/src/lib/supabase/client';

export const REFERENCE_SEARCH_LIMIT = 8 as const;

export type ReferenceHitKind = 'project' | 'invoice' | 'receipt';

export interface ReferenceHit {
  kind: ReferenceHitKind;
  id: string;
  title: string;
  context: string | null;
  reference: string;
  aliases: string[];
  exact: boolean;
}

export interface ReferenceSearchPage {
  items: ReferenceHit[];
  hasMore: boolean;
}

interface ReferenceSearchRpcResponse {
  data: unknown;
  error: { message: string; code?: string; details?: string } | null;
}

interface ReferenceSearchRpcClient {
  rpc(
    functionName: 'search_record_references',
    args: { p_query: string; p_limit: typeof REFERENCE_SEARCH_LIMIT },
  ): PromiseLike<ReferenceSearchRpcResponse>;
}

function isReferenceHit(value: unknown): value is ReferenceHit {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const hit = value as Record<string, unknown>;
  return (
    (hit.kind === 'project' || hit.kind === 'invoice' || hit.kind === 'receipt') &&
    typeof hit.id === 'string' && hit.id.length > 0 &&
    typeof hit.title === 'string' && hit.title.length > 0 &&
    (hit.context === null || typeof hit.context === 'string') &&
    typeof hit.reference === 'string' && hit.reference.length > 0 &&
    Array.isArray(hit.aliases) && hit.aliases.length > 0 && hit.aliases.every((alias) => typeof alias === 'string' && alias.length > 0) &&
    typeof hit.exact === 'boolean'
  );
}

function isReferenceSearchPage(value: unknown): value is ReferenceSearchPage {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const page = value as Record<string, unknown>;
  return (
    Array.isArray(page.items) &&
    page.items.length <= REFERENCE_SEARCH_LIMIT &&
    page.items.every(isReferenceHit) &&
    typeof page.hasMore === 'boolean'
  );
}

/** Query-specific, server-bounded lookup. The RPC and RLS enforce the caller's read scope. */
export async function searchRecordReferences(query: string): Promise<ReferenceSearchPage> {
  const rpcClient = supabase as unknown as ReferenceSearchRpcClient;
  const { data, error } = await rpcClient.rpc('search_record_references', {
    p_query: query,
    p_limit: REFERENCE_SEARCH_LIMIT,
  });
  if (error) throw toAppError(error);
  if (!isReferenceSearchPage(data)) throw new AppError('Reference search returned an invalid response');
  return data;
}
