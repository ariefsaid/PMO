/** Shared reference-mapping helpers for the ERPNext dispatch preparation (T-31 / ADP-021 /
 *  XG04-004): the pieces MORE THAN ONE domain's resolver needs, so the domains can never drift
 *  apart about what a mapping means. `dispatchFactory.ts` re-exports the public seam; the
 *  per-domain resolvers live in `dispatchBudget.ts` / `dispatchTimesheet.ts` /
 *  `dispatchProcurement.ts` / `dispatchRevenue.ts` and their gates in `dispatchPreflight.ts`. */
import type { AdapterCommand } from '../contract.ts';
import { resolveExternalRef, type ExternalRefsLookupClient } from '../refs.ts';
import type { DispatchServiceClient } from './dispatchTypes.ts';

/** Strips the `"<Doctype>:<name>"` encoding (task 3.2's companies-domain adopt convention, reused
 *  generically by `adapter.ts`'s `parseExternalId`) down to the bare ERP `name` the body-builders
 *  expect in `ctx.refs.supplier`. Returns the value unmodified if it carries no doctype prefix.
 *
 * ⚑ ONE definition for every read path (ADP-022: the factory used to carry two identical local
 * copies, so a parsing correction had to be made twice). Both call sites — the case-vendor
 * resolution (`resolveCaseSupplierName`, via `procurements.vendor_id`) and the command's own
 * `vendorId` fallback (`resolveSupplierRef`) — go through this helper, and the external-reference
 * format (prefixed AND bare) is covered at the factory seam by `dispatchFactory.test.ts`. */
export function stripDoctypePrefix(externalId: string): string {
  const idx = externalId.indexOf(':');
  return idx === -1 ? externalId : externalId.slice(idx + 1);
}

/** The command's own `vendorId` -> the ERP Supplier raw name, via `external_refs` (companies
 *  domain). `null` when the command carries no vendorId, or no mapping is recorded. The ctx spread
 *  uses it as the fallback for kinds that resolve no case supplier (MR/RFQ/SQ — task 4.6/4.7). */
export async function resolveSupplierRef(serviceClient: DispatchServiceClient, orgId: string, command: AdapterCommand): Promise<string | null> {
  const vendorId = (command.record as { vendorId?: unknown }).vendorId;
  if (typeof vendorId !== 'string' || vendorId.length === 0) return null;
  const externalRecordId = await resolveExternalRef(serviceClient as unknown as ExternalRefsLookupClient, orgId, 'companies', vendorId);
  return externalRecordId ? stripDoctypePrefix(externalRecordId) : null;
}

/** PMO `projectId` -> the ERP project name, via the binding's `config.project_map` override (Director
 *  ruling §6.1 — search-by-`project_name` + auto-create is a fast-follow; the map is the source of
 *  truth today). `null` = no projectId, or a projectId this binding has no ERP mapping for. ONE
 *  definition, shared by the ref resolution and the SI project gate (`dispatchPreflight`) — they
 *  must never disagree about what "the ERP project resolved" means. */
export function resolveErpProjectName(config: Record<string, unknown> | undefined, projectId: string | null | undefined): string | null {
  const projectMap = (config?.project_map as Record<string, string> | undefined) ?? {};
  return projectId ? (projectMap[projectId] ?? null) : null;
}
