import type { SupabaseClient } from "@supabase/supabase-js";
import type { PmoRecord } from "../../../pmo-portal/src/lib/adapterSeam/contract.ts";
import {
  applyInboundChange,
  type ApplyOutcome,
} from "../../../pmo-portal/src/lib/adapterSeam/applyEngine.ts";
import { findPmoRecordId } from "../../../pmo-portal/src/lib/adapterSeam/refs.ts";
import { ERPNEXT_TIER } from "../../../pmo-portal/src/lib/adapterSeam/erpnext/adapter.ts";
import { AppError } from "../../../pmo-portal/src/lib/appError.ts";
import { createErpFeedDeps, surfaceActionRequired } from "./erpnextFeedDeps.ts";
import { IN_FLIGHT_OUTBOX_STATES } from "./inFlightAnchorProbe.ts";

/** AppErrors thrown by applyErpContact's own deliberate refusals (not by a DB/network fault). */
const contactRefusals = new WeakSet<object>();
function refuse(message: string, code: string): AppError {
  const err = new AppError(message, code);
  contactRefusals.add(err);
  return err;
}

/**
 * Feed entry (sweep + webhook): the genuine action-required refusals (two adopted companies, an
 * ambiguous match, a row already mapped to another ERP Contact) are terminal for that ONE document —
 * raise the notice and rethrow under the classified `contact-not-adopted` code so `feedErrorPolicy`
 * skips it instead of wedging the watermark. The TRANSIENT refusals (`contact-parent-unmapped`: the
 * Customer is adopted on a later tick, since Contact is swept first; `command-reconciling`: an outbound
 * create is in flight) and any DB/network fault propagate unchanged, so the feed halts and re-polls them.
 * The only caller of `applyErpContact` directly is this wrapper; no onboarding caller exists.
 */
export async function applyErpContactFeed(
  serviceClient: SupabaseClient,
  orgId: string,
  externalRecordId: string,
  canonical: PmoRecord,
  sourceModMs: number,
): Promise<ApplyOutcome> {
  try {
    return await applyErpContact(serviceClient, orgId, externalRecordId, canonical, sourceModMs);
  } catch (err) {
    if (!(err instanceof AppError) || !contactRefusals.has(err) || err.code !== "action-required") throw err;
    await surfaceActionRequired(serviceClient, orgId, "contact-not-adopted", {
      erpName: externalRecordId,
      reason: err.code,
    });
    throw new AppError(err.message, "contact-not-adopted");
  }
}

/** Contact masters share the generic claim-first feed, with parent and mixed-state matching first. */
export async function applyErpContact(
  serviceClient: SupabaseClient,
  orgId: string,
  externalRecordId: string,
  canonical: PmoRecord,
  sourceModMs: number,
): Promise<ApplyOutcome> {
  const links = Array.isArray(canonical.erp_contact_links)
    ? canonical.erp_contact_links as Array<
      { link_doctype?: string; link_name?: string }
    >
    : [];
  if (
    !links.some((link) =>
      (link.link_doctype === "Customer" || link.link_doctype === "Supplier") &&
      link.link_name
    )
  ) return { kind: "no-op" };
  const companyIds = new Set<string>();
  let unresolvedParent = false;
  for (const link of links) {
    if (
      link.link_doctype !== "Customer" && link.link_doctype !== "Supplier"
    ) continue;
    if (!link.link_name) { unresolvedParent = true; continue; }
    const id = await findPmoRecordId(
      serviceClient as never,
      orgId,
      "companies",
      `${link.link_doctype}:${link.link_name}`,
    );
    if (!id) { unresolvedParent = true; continue; }
    const { data, error } = await serviceClient.from("companies").select("id")
      .eq("org_id", orgId).eq("id", id).maybeSingle();
    if (error) throw new AppError(error.message, error.code);
    if (!data) { unresolvedParent = true; continue; }
    companyIds.add(id);
  }
  if (unresolvedParent && companyIds.size > 0) {
    throw refuse(`${externalRecordId}: Contact has unresolved company links; resolve manually`, "action-required");
  }
  if (companyIds.size === 0) {
    throw refuse(
      `${externalRecordId}: Contact has no adopted company link`,
      "contact-parent-unmapped",
    );
  }
  if (companyIds.size !== 1) {
    throw refuse(
      `${externalRecordId}: Contact links match multiple adopted companies; resolve manually`,
      "action-required",
    );
  }
  const companyId = [...companyIds][0];
  const pinned = { ...canonical, company_id: companyId };
  const deps = createErpFeedDeps(serviceClient, orgId, "contact");
  deps.adoptAtomically = {
    ...deps.adoptAtomically!,
    claimExternalRef: async (mapping) => {
      const { error } = await serviceClient.from("external_refs").insert({
        org_id: orgId,
        domain: mapping.domain,
        pmo_record_id: mapping.pmoRecordId,
        external_tier: mapping.externalTier,
        external_record_id: mapping.externalRecordId,
      });
      if (error) throw new AppError(error.message, error.code);
    },
  };
  const existingId = await deps.resolvePmoRecordId(externalRecordId);
  if (!existingId) {
    // Anchorless outbound Contact creates retain adoption authority until resolved.
    // Query at adoption time: the outbox is persisted before any ERP create can be visible.
    const { data: inFlight, error: outboxError } = await serviceClient.from("external_command_outbox")
      .select("id").eq("org_id", orgId).eq("domain", "companies")
      .eq("operation", "create").eq("payload->>erp_doc_kind", "contact")
      .in("state", [...IN_FLIGHT_OUTBOX_STATES]).limit(1).maybeSingle();
    if (outboxError) throw new AppError(outboxError.message, outboxError.code);
    if (inFlight) throw refuse("Contact adoption awaits outbound command resolution", "command-reconciling");
    const { data, error } = await serviceClient.from("contacts").select("id")
      .eq("org_id", orgId).eq("company_id", companyId).eq(
        "full_name",
        String(canonical.full_name),
      );
    if (error) throw new AppError(error.message, error.code);
    const candidates = (data ?? []) as Array<{ id: string }>;
    if (candidates.length > 1) {
      throw refuse(
        `${externalRecordId}: Ambiguous Contact match; resolve manually`,
        "action-required",
      );
    }
    if (candidates.length === 1) {
      const id = candidates[0].id;
      // A matched row cannot be silently repointed from another ERP Contact ID.
      const { data: mapping, error: mappingError } = await serviceClient.from(
        "external_refs",
      ).select("external_record_id").eq("org_id", orgId).eq(
        "domain",
        "companies",
      ).eq("pmo_record_id", id).maybeSingle();
      if (mappingError) {
        throw new AppError(mappingError.message, mappingError.code);
      }
      if (mapping) {
        throw refuse(
          `${externalRecordId}: Contact already belongs to another ERP Contact; resolve manually`,
          "action-required",
        );
      }
      const atomic = deps.adoptAtomically!;
      deps.adoptAtomically = {
        ...atomic,
        newPmoRecordId: () => id,
        mintWithId: async (rec, ms, pmoId) => deps.updateMirror(pmoId, rec, ms),
      };
    }
  }
  return applyInboundChange(
    { tier: ERPNEXT_TIER, domain: "companies" },
    externalRecordId,
    pinned,
    sourceModMs,
    deps,
  );
}
