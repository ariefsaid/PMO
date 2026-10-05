import type { SupabaseClient } from "@supabase/supabase-js";
import type { PmoRecord } from "../../../pmo-portal/src/lib/adapterSeam/contract.ts";
import {
  applyInboundChange,
  type ApplyOutcome,
} from "../../../pmo-portal/src/lib/adapterSeam/applyEngine.ts";
import { findPmoRecordId } from "../../../pmo-portal/src/lib/adapterSeam/refs.ts";
import { ERPNEXT_TIER } from "../../../pmo-portal/src/lib/adapterSeam/erpnext/adapter.ts";
import { AppError } from "../../../pmo-portal/src/lib/appError.ts";
import { createErpFeedDeps } from "./erpnextFeedDeps.ts";

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
  for (const link of links) {
    if (
      (link.link_doctype !== "Customer" && link.link_doctype !== "Supplier") ||
      !link.link_name
    ) continue;
    const id = await findPmoRecordId(
      serviceClient as never,
      orgId,
      "companies",
      `${link.link_doctype}:${link.link_name}`,
    );
    if (!id) continue;
    const { data, error } = await serviceClient.from("companies").select("id")
      .eq("org_id", orgId).eq("id", id).maybeSingle();
    if (error) throw new AppError(error.message, error.code);
    if (data) companyIds.add(id);
  }
  if (companyIds.size === 0) {
    throw new AppError(
      `${externalRecordId}: Contact has no adopted company link`,
      "contact-parent-unmapped",
    );
  }
  if (companyIds.size !== 1) {
    throw new AppError(
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
    const { data, error } = await serviceClient.from("contacts").select("id")
      .eq("org_id", orgId).eq("company_id", companyId).eq(
        "full_name",
        String(canonical.full_name),
      );
    if (error) throw new AppError(error.message, error.code);
    const candidates = (data ?? []) as Array<{ id: string }>;
    if (candidates.length > 1) {
      throw new AppError(
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
        throw new AppError(
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
