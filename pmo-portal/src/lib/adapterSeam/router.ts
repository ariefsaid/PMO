/**
 * The write-routing seam (FR-EAS-030..033, AC-EAS-001/002/014/030/031/032). Pure + relative imports only.
 */
import { PmoDomain } from './contract.ts';
import { pendingPushAfterWrite, type PendingPushState } from './pendingPush.ts';

export type OwnershipMap = Readonly<Record<PmoDomain, string>>;
export const EMPTY_OWNERSHIP_MAP: OwnershipMap = {};

export type WriteRoute = 'pmo' | 'external';

export function routeRead(_domain: PmoDomain): 'dal' {
  return 'dal';
}

export function routeWrite(domain: PmoDomain, map: OwnershipMap): WriteRoute {
  if (Object.keys(map).length === 0) return 'pmo';
  return map[domain] ? 'external' : 'pmo';
}

export interface ExecuteWriteDeps<TPayload, TResult> {
  domain: PmoDomain;
  ownershipMap: OwnershipMap;
  payload: TPayload;
  directWrite: (payload: TPayload) => Promise<TResult>;
  dispatchWrite: (payload: TPayload) => Promise<TResult>;
}

export async function executeWrite<TPayload, TResult>(
  deps: ExecuteWriteDeps<TPayload, TResult>,
): Promise<TResult> {
  return routeWrite(deps.domain, deps.ownershipMap) === 'external'
    ? deps.dispatchWrite(deps.payload)
    : deps.directWrite(deps.payload);
}

export async function executeWriteWithPendingPush<TPayload, TResult>(
  deps: ExecuteWriteDeps<TPayload, TResult>,
): Promise<{ result: TResult; pendingPush: PendingPushState }> {
  const route = routeWrite(deps.domain, deps.ownershipMap);
  try {
    const result = await executeWrite(deps);
    return { result, pendingPush: pendingPushAfterWrite(route, { ok: true }) };
  } catch (err) {
    return Promise.reject(Object.assign(err instanceof Error ? err : new Error(String(err)), {
      pendingPush: pendingPushAfterWrite(route, { ok: false, err }),
    }));
  }
}
