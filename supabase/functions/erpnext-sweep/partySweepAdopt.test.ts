/**
 * #935 [Deno] — the SWEEP must adopt each new ERP Supplier under its OWN doctype-encoded external id.
 *
 * `supplierFromDoc` returned `id: 'placeholder'`, and `runSweep` keys the apply on
 * `change.record.id` — so the FIRST natively-created ERP Supplier claimed
 * `external_record_id = 'placeholder'` and every later one resolved to that SAME PMO company,
 * overwriting it. The production link shape (onboarding + webhook) is `Supplier:<docname>`
 * (`partyAdopt.externalIdFor` / `externalIdForKind`); the sweep-adopted party must land in the
 * SAME shape so existing refs keep matching instead of re-adopting as duplicates.
 *
 * These tests drive the SHIPPED handler (`sweepOrgDoctypesLive`) with a stubbed `fetch` + the
 * fake Supabase client, and assert at the two seams the defect was visible in:
 *   • TWO new ERP Suppliers adopt as TWO PMO companies under TWO `Supplier:<name>` refs, and
 *   • an already-linked `Supplier:<name>` ref UPDATES its mirror — never a second ref/row.
 *
 * Verify: deno test supabase/functions/erpnext-sweep/ --config supabase/functions/erpnext-sweep/deno.json
 */
import { contactDb } from "../_shared/erpnextContacts.fixtures.ts";

(Deno as unknown as { serve: (...args: unknown[]) => unknown }).serve = () => ({
  finished: Promise.resolve(),
});
const { sweepOrgDoctypesLive } = await import("./index.ts");

const ORG = "00000000-0000-4000-8000-000000000935";

function assert(v: unknown, m: string): asserts v {
  if (!v) throw new Error(m);
}

/** Sweep a companies-owned org whose ERP serves exactly `suppliers` on the Supplier list endpoint. */
async function runPartySweep(
  suppliers: Array<Record<string, unknown>>,
  seed: Record<string, Array<Record<string, unknown>>> = {},
) {
  const db = contactDb({
    companies: [],
    profiles: [{ id: "admin-1", org_id: ORG, status: "active", role: "Admin" }],
    notifications: [],
    ...seed,
  });
  const oldEnv = Deno.env.get;
  const oldFetch = globalThis.fetch;
  (Deno.env as unknown as { get: (k: string) => string | undefined }).get = (k) =>
    ({
      TEST_BINDING_KEY: "synthetic-key",
      TEST_BINDING_SECRET: "synthetic-secret",
    } as Record<string, string>)[k];
  globalThis.fetch = (async (input) => {
    const u = new URL(String(input));
    const data = u.pathname === "/api/resource/Supplier" ? suppliers : [];
    return new Response(JSON.stringify({ data }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
  try {
    const result = await sweepOrgDoctypesLive(db.client, {
      orgId: ORG,
      siteUrl: "https://erp.example.test",
      secretRef: "test-binding",
      company: "Example Company",
      config: {},
      ownedDomains: ["companies"],
      versionMajor: 15,
    });
    return { result, db };
  } finally {
    globalThis.fetch = oldFetch;
    (Deno.env as unknown as { get: unknown }).get = oldEnv;
  }
}

Deno.test(
  "#935 TWO new ERP Suppliers adopt as TWO PMO companies under TWO Supplier:<name> refs",
  async () => {
    const { result, db } = await runPartySweep([
      { name: "SUP-001", modified: "2026-10-08 09:00:00", docstatus: 0, supplier_name: "Acme Co", tax_id: "TAX-1" },
      { name: "SUP-002", modified: "2026-10-08 09:05:00", docstatus: 0, supplier_name: "Globex", tax_id: "TAX-2" },
    ]);
    assert(!result.error, `sweep failed: ${result.error}`);
    assert(result.applied === 2, `both suppliers must apply — applied=${result.applied}`);

    // TWO mirror companies (the defect minted ONE and overwrote it with the second).
    assert(db.rows.companies.length === 2, `two companies expected, got ${db.rows.companies.length}`);
    const names = db.rows.companies.map((c) => c.name).sort();
    assert(
      JSON.stringify(names) === JSON.stringify(["Acme Co", "Globex"]),
      `both display names must be adopted — got ${names.join(", ")}`,
    );
    assert(db.rows.companies.every((c) => c.type === "Vendor"), "each adopt is a Vendor company");

    // TWO refs in the PRODUCTION shape, mapping the two suppliers to two DISTINCT PMO ids.
    const refs = db.rows.external_refs.filter((r) => r.org_id === ORG && r.domain === "companies");
    const byId = new Map(refs.map((r) => [r.external_record_id, r]));
    assert(
      byId.size === 2 && byId.has("Supplier:SUP-001") && byId.has("Supplier:SUP-002"),
      `refs must be Supplier:SUP-001 + Supplier:SUP-002 — got [${refs.map((r) => r.external_record_id).join(", ")}]`,
    );
    const acmeId = byId.get("Supplier:SUP-001")?.pmo_record_id;
    const globexId = byId.get("Supplier:SUP-002")?.pmo_record_id;
    assert(!!acmeId && !!globexId && acmeId !== globexId, "the two refs must resolve to two DISTINCT PMO companies");
    const acme = db.rows.companies.find((c) => c.id === acmeId);
    const globex = db.rows.companies.find((c) => c.id === globexId);
    assert(acme?.name === "Acme Co" && globex?.name === "Globex", "each ref maps to ITS OWN adopted company");
  },
);

Deno.test(
  "#935 an already-linked Supplier:<name> ref is UPDATED, not duplicated (and no second company row)",
  async () => {
    const { result, db } = await runPartySweep(
      [
        { name: "SUP-EXIST", modified: "2026-10-08 09:00:00", docstatus: 0, supplier_name: "Renewed Co", tax_id: "TAX-9" },
      ],
      {
        companies: [{
          id: "company-1",
          org_id: ORG,
          name: "Old Name",
          type: "Vendor",
          erp_supplier_name: "Old Name",
          erp_modified: "2026-10-01T00:00:00.000Z",
        }],
        external_refs: [{
          org_id: ORG,
          domain: "companies",
          pmo_record_id: "company-1",
          external_record_id: "Supplier:SUP-EXIST",
        }],
      },
    );
    assert(!result.error, `sweep failed: ${result.error}`);
    assert(result.applied === 1, `the linked supplier must apply as an update — applied=${result.applied}`);

    // ONE mirror row (no duplicate adopt), its source-mod stamp advanced by the update. The stamp
    // is the ERP `modified` parsed exactly as the pipeline parses it (TZ-agnostic oracle).
    assert(db.rows.companies.length === 1, `no second company row — got ${db.rows.companies.length}`);
    assert(
      db.rows.companies[0].erp_modified === new Date(Date.parse("2026-10-08 09:00:00")).toISOString(),
      `the update must stamp erp_modified — got ${db.rows.companies[0].erp_modified}`,
    );
    assert(
      db.writes.some((w) => w.table === "companies" && w.op === "update"),
      "the mirror row must be UPDATED",
    );

    // ONE ref, still the SAME mapping — never a second external_refs row.
    const refs = db.rows.external_refs.filter(
      (r) => r.org_id === ORG && r.domain === "companies" && r.external_record_id === "Supplier:SUP-EXIST",
    );
    assert(refs.length === 1, `exactly one Supplier:SUP-EXIST ref — got ${refs.length}`);
    assert(refs[0].pmo_record_id === "company-1", "the mapping stays bound to the existing PMO company");
  },
);
