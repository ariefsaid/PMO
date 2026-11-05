/**
 * The write-routing seam (FR-EAS-030..033, AC-EAS-001/002/014/030/031/032). Pure + relative imports only.
 */
import { PmoDomain } from './contract.ts';

export type OwnershipMap = Readonly<Record<PmoDomain, string>>;
export const EMPTY_OWNERSHIP_MAP: OwnershipMap = {};

export type WriteRoute = 'pmo' | 'external';

export function routeWrite(domain: PmoDomain, map: OwnershipMap): WriteRoute {
  if (Object.keys(map).length === 0) return 'pmo';
  return map[domain] ? 'external' : 'pmo';
}
