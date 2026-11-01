/**
 * erpnext/adapterReads.ts: the ERPNext half of the adapter read contract (FR-EAS-021), in PMO domain
 * terms. Two operations: `getByExternalId` (resolve one record) and `listChangesSinceWatermark` (the
 * domain's change feed, one modified-poll cursor per kind).
 *
 * External identity (the ONE definition, matching what the sweep and webhook stamp on `external_refs`,
 * see `externalIdForKind`): party kinds carry their doctype (`Supplier:<name>`), every other kind is the
 * raw ERP document name. The `<Doctype>:<name>` form is also accepted for any doctype of the requested
 * domain; a raw name is probed against the domain's raw-named doctypes, so a name from another domain
 * never resolves here.
 */
import type { ChangesSinceWatermark, PmoDomain, PmoRecord } from '../contract.ts';
import { AdapterError } from '../contract.ts';
import type { ErpAdapterDeps } from './adapter.ts';
import { ErpError, getDoc } from './client.ts';
import { DOCTYPE_REGISTRY, type ErpDocKind } from './doctypeRegistry.ts';
import { externalIdForKind, KIND_DOMAIN, kindFromDoctype, sweepKindsForOrg } from './feedKinds.ts';
import { KINDS_NEEDING_FULL_DOC, pollFiltersForKind, sweepFieldsForKind } from './pollSpec.ts';
import { listErpChangesSinceWatermark } from './sweepCursor.ts';

export interface ErpExternalIdTarget {
  kind: ErpDocKind;
  name: string;
}

const kindsOfDomain = (domain: PmoDomain): ErpDocKind[] =>
  (Object.keys(KIND_DOMAIN) as ErpDocKind[]).filter((kind) => KIND_DOMAIN[kind] === domain);

/** The (kind, ERP name) candidates an external id can denote within `domain`; throws when it cannot belong there. */
export function erpExternalIdTargets(domain: PmoDomain, externalRecordId: string): ErpExternalIdTarget[] {
  const domainKinds = kindsOfDomain(domain);
  if (domainKinds.length === 0) {
    throw new AdapterError('commit-rejected', `erpnext adapter does not own domain '${domain}'`);
  }
  const separator = externalRecordId.indexOf(':');
  const prefixed = separator > 0 ? kindFromDoctype(externalRecordId.slice(0, separator)) : undefined;
  if (prefixed) {
    if (KIND_DOMAIN[prefixed] !== domain) {
      throw new AdapterError('commit-rejected', `external id '${externalRecordId}' is not a ${domain} identity`);
    }
    return [{ kind: prefixed, name: externalRecordId.slice(separator + 1) }];
  }
  return domainKinds
    .filter((kind) => externalIdForKind(kind, externalRecordId) === externalRecordId)
    .map((kind) => ({ kind, name: externalRecordId }));
}

function requireBodies(deps: ErpAdapterDeps, kind: ErpDocKind) {
  const fns = deps.doctypeBodies[kind];
  if (!fns) throw new AdapterError('commit-rejected', `erpnext doctype body for '${kind}' is not yet wired`);
  return fns;
}

export async function erpGetByExternalId(
  deps: ErpAdapterDeps,
  domain: PmoDomain,
  externalRecordId: string,
): Promise<PmoRecord | null> {
  const probedDoctypes = new Set<string>();
  for (const { kind, name } of erpExternalIdTargets(domain, externalRecordId)) {
    const { doctype } = DOCTYPE_REGISTRY[kind];
    // Kinds sharing one doctype (the Payment Entry kinds) are one lookup; the first kind maps it.
    if (probedDoctypes.has(doctype)) continue;
    probedDoctypes.add(doctype);
    try {
      const doc = await getDoc(deps.client, doctype, name);
      return { ...requireBodies(deps, kind).fromDoc(doc), id: externalRecordId };
    } catch (err) {
      if (err instanceof ErpError && err.status === 404) continue;
      throw err;
    }
  }
  return null;
}

/** The cursor is one modified-poll watermark per kind of the domain: `{ "<kind>": "<modified>" }`. */
function parseCursor(cursor: string | null): Record<string, string> {
  if (cursor === null || cursor === '') return {};
  try {
    const parsed: unknown = JSON.parse(cursor);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as Record<string, string>;
  } catch { /* falls through */ }
  throw new AdapterError('commit-rejected', 'erpnext change-feed cursor is malformed');
}

export async function erpListChangesSinceWatermark(
  deps: ErpAdapterDeps,
  domain: PmoDomain,
  cursor: string | null,
): Promise<ChangesSinceWatermark> {
  if (kindsOfDomain(domain).length === 0) {
    throw new AdapterError('commit-rejected', `erpnext adapter does not own domain '${domain}'`);
  }
  const scope = deps.readScope ?? {};
  const prior = parseCursor(cursor);
  const next: Record<string, string> = { ...prior };
  const changes: PmoRecord[] = [];
  let advanced = false;
  for (const { kind, doctype } of sweepKindsForOrg([domain])) {
    const poll = pollFiltersForKind(kind, scope.company ?? null);
    // A company-owned doctype with no company cannot be scoped: refuse the whole read, never return a partial feed.
    if (poll === null) throw new AdapterError('commit-rejected', `erpnext change feed for '${domain}' needs a company scope`);
    const fns = requireBodies(deps, kind);
    const listed = await listErpChangesSinceWatermark(
      {
        client: deps.client,
        doctype,
        fields: sweepFieldsForKind(kind, scope.versionMajor),
        includeAmendedFrom: DOCTYPE_REGISTRY[kind].submittable,
        fromDoc: fns.fromDoc,
        extraFilters: poll.extraFilters,
        filterRow: poll.admits,
        maxPages: scope.maxPages ?? 1,
        ...(KINDS_NEEDING_FULL_DOC.includes(kind)
          ? { hydrateDoc: async (name: string) => (await getDoc(deps.client, doctype, name)) as Record<string, unknown> }
          : {}),
      },
      prior[kind] ?? null,
    );
    changes.push(...listed.changes.map((change) => change.record));
    if (listed.nextCursor !== null) {
      next[kind] = listed.nextCursor;
      // The poll is inclusive, so the boundary row always returns: only a strictly later `modified` is progress.
      if (prior[kind] === undefined || listed.nextCursor > prior[kind]) advanced = true;
    }
  }
  return { changes, nextCursor: advanced ? JSON.stringify(next) : null };
}
