import { routeDomainWrite } from '@/src/lib/adapterSeam/ownershipCache';

/**
 * #769: is the optional external reference ("Group ref") PMO's to ask for on this org?
 *
 * Only when the procurement domain is PMO-owned. On a flipped (ERP-owned) org the create is
 * dispatched to the ERP adapter, which never carries `external_ref` (it is not part of any ERP
 * payload) — so the value a user typed would be silently dropped. Asking for a fact and discarding
 * it is worse than not asking (same ruling as `taxIsPmoAuthored`), so the forms do not render it.
 */
export function groupRefIsPmoAuthored(): boolean {
  return routeDomainWrite('procurement') !== 'external';
}
