import { AppError } from '../../../../pmo-portal/src/lib/appError.ts';
import type { PmoRecord } from '../../../../pmo-portal/src/lib/adapterSeam/contract.ts';
import type { ExternalRefsLookupClient } from '../../../../pmo-portal/src/lib/adapterSeam/refs.ts';
import type { ReadModelWriterCtx } from './types.ts';

/** Round-7 B10 — the REQUIRED-link org guard for the procurement mirrors (the defence-in-depth half;
 *  `dispatchPreflight.assertCommandLinksSameOrg` is the pre-flight that refuses before any ERP write).
 *
 *  These writers run as SERVICE ROLE, so RLS does not protect them: they used to copy the command's
 *  `procurementId`/`vendorId`/`invoiceId` verbatim into an insert stamped with the CALLER's org_id,
 *  producing a PMO row with cross-tenant procurement links. The writers are reachable without the
 *  pre-flight (the sweep's recovery path reconstructs a command from the frozen outbox payload and
 *  finalizes it directly), so the check belongs here too.
 *
 *  Unlike the revenue links this guard is for NOT-NULL FKs: a vanished row cannot be tolerated by
 *  nulling (the insert would fail on the constraint anyway), so `missing` throws the SAME classified
 *  error as cross-org rather than a raw 23503. Defined below `checkLinkSameOrg`/`resolveLinkOrNull`
 *  is not possible (hoisting is fine for function declarations) — it reuses them, never a second copy. */
export async function requireOwnOrgLink(ctx: ReadModelWriterCtx, table: string, id: string): Promise<void> {
  if ((await checkLinkSameOrg(ctx, table, id)) === 'missing') {
    throw new AppError(
      `cross-org link rejected: ${table} '${id}' does not exist in org '${ctx.orgId}'`,
      'cross-org-link-rejected',
    );
  }
}

/** Slice-6 task 6.10/6.11 (FR-ENA-052/053, NFR-ENA-DOC-001): writes an `external_ref_lineage` row for
 *  a PMO-INITIATED cancel or amend (the OUTBOUND counterpart to the inbound apply path's
 *  `lineage.ts` applyCancel/applyAmend, which slice 8 wires for webhook/sweep events). Called from
 *  the invoice/payment mirror writers AFTER the mirror upsert — the lineage row is the audit record of
 *  the supersession, separate from the mirror state itself. A docstatus-2 doc with no `amended_from` is
 *  a CANCEL (superseded name, no successor); a doc carrying `erp_amended_from` is an AMEND (the old
 *  name superseded by the new mirror name). Any other canonical (a fresh create, a draft update) is a
 *  no-op — a regular mirror supersedes nothing. Slice 6 has no inbound sweep, so this runs exactly once
 *  per finalized command (the outbox guarantees at-most-once finalize). The `domain` param stamps the
 *  lineage row's OWN domain (procurement OR revenue) — shared by both money-doc writers, never hardcoded. */
export async function recordOutboundLineage(
  ctx: ReadModelWriterCtx,
  canonical: PmoRecord,
  domain: 'procurement' | 'revenue',
  erpName: string | undefined,
): Promise<void> {
  if (!erpName) return;
  const docstatus = canonical.erp_docstatus as number | null | undefined;
  const amendedFrom = (canonical.erp_amended_from as string | null | undefined) ?? null;
  if (docstatus === 2 && !amendedFrom) {
    const { error } = await ctx.serviceClient.from('external_ref_lineage').insert({
      org_id: ctx.orgId,
      domain,
      pmo_record_id: canonical.id,
      superseded_external_record_id: erpName,
      successor_external_record_id: null,
      reason: 'cancelled',
      erp_docstatus: 2,
    });
    if (error) throw new AppError(error.message, error.code);
    return;
  }
  if (amendedFrom) {
    const { error } = await ctx.serviceClient.from('external_ref_lineage').insert({
      org_id: ctx.orgId,
      domain,
      pmo_record_id: canonical.id,
      superseded_external_record_id: amendedFrom,
      successor_external_record_id: erpName,
      reason: 'amended',
      erp_docstatus: null,
    });
    if (error) throw new AppError(error.message, error.code);
  }
}
/** Luna SF7 + re-audit BLOCK #11: cross-org FK guard, TOCTOU-tolerant.
 *
 *  The service-role writer bypasses RLS, so before copying a PMO-side link
 *  (customer_id/project_id/sales_invoice_id) from the command into a created row it verifies the
 *  referenced row belongs to ctx.orgId — otherwise the writer would silently link a sales invoice /
 *  incoming payment to ANOTHER org's record.
 *
 *  Two OUTCOMES, deliberately distinguished (BLOCK #11):
 *   - `'cross-org'` — the row EXISTS under a different org. Still a hard, classified
 *     'cross-org-link-rejected' throw: a genuine tenancy violation, which `dispatchFactory`'s
 *     pre-flight already refuses BEFORE any ERP write, so reaching here means something is badly wrong.
 *   - `'missing'`   — the row is GONE. By construction this can only be a delete that landed inside
 *     the residual pre-flight→outbox-insert window (the pre-flight fails closed on a missing row, and
 *     0109's in-flight-command delete guard blocks deletes from the outbox INSERT onward). At this
 *     point the ERP money document ALREADY EXISTS, so throwing would leave real money permanently
 *     invisible to PMO (every finalize retry re-hits the same missing FK). The caller therefore
 *     tolerates it by NULLING that one link — the invoice lands in the existing Unassigned bucket /
 *     the receipt becomes on-account, both operator-recoverable states.
 *
 *  Same client idiom as `findPmoRecordId` (`as unknown as ExternalRefsLookupClient`). */
type LinkCheck = 'ok' | 'missing';

export async function checkLinkSameOrg(ctx: ReadModelWriterCtx, table: string, id: string): Promise<LinkCheck> {
  const { data, error } = await (ctx.serviceClient as unknown as ExternalRefsLookupClient)
    .from(table)
    .select('org_id')
    .eq('id', id)
    .maybeSingle();
  if (error) throw new AppError(error.message, error.code);
  const row = data as { org_id: string } | null;
  if (row === null || row === undefined) return 'missing';
  if (row.org_id !== ctx.orgId) {
    throw new AppError(
      `cross-org link rejected: ${table} '${id}' does not belong to org '${ctx.orgId}'`,
      'cross-org-link-rejected',
    );
  }
  return 'ok';
}

/** Resolve a create-time link to the id to store: the id itself when it still resolves in this org,
 *  or `null` when the referenced row vanished in the TOCTOU window (BLOCK #11). Throws on a genuine
 *  cross-org link. A null/absent link is passed through untouched — no lookup fired. */
export async function resolveLinkOrNull(
  ctx: ReadModelWriterCtx,
  table: string,
  id: string | undefined | null,
): Promise<string | null> {
  if (!id) return null;
  return (await checkLinkSameOrg(ctx, table, id)) === 'ok' ? id : null;
}
