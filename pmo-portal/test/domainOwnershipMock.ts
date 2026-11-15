import { useSyncExternalStore } from 'react';
import { vi } from 'vitest';
import { routeDomainWrite, subscribeOwnershipCache } from '@/src/lib/adapterSeam/ownershipCache';

export const ownershipMock = { override: null as null | 'unknown' | 'error', retry: vi.fn() };
export function useDomainOwnershipMode(domain: string) {
  const route = useSyncExternalStore(subscribeOwnershipCache, () => routeDomainWrite(domain));
  return { mode: ownershipMock.override ?? route, retry: ownershipMock.retry };
}
