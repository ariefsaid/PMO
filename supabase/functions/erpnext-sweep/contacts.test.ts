import { contactDb } from "../_shared/erpnextContacts.fixtures.ts";
(Deno as unknown as { serve: (...args: unknown[]) => unknown }).serve = () => ({
  finished: Promise.resolve(),
});
const { sweepOrgDoctypesLive } = await import("./index.ts");
const ORG = "00000000-0000-4000-8000-000000000073";
function assert(v: unknown, m: string): asserts v {
  if (!v) throw new Error(m);
}
Deno.test("AC-CON-001 shipped sweep hydrates linked Contact child tables and updates the ERP-ID mirror", async () => {
  const db = contactDb({
    companies: [{ id: "company-1", org_id: ORG }],
    external_refs: [{
      org_id: ORG,
      domain: "companies",
      pmo_record_id: "company-1",
      external_record_id: "Customer:CUST-1",
    }],
  });
  const oldFetch = globalThis.fetch;
  const oldEnv = Deno.env.get;
  const calls: string[] = [];
  (Deno.env as unknown as { get: (k: string) => string | undefined }).get = (
    k,
  ) =>
    ({
      TEST_BINDING_KEY: "synthetic-key",
      TEST_BINDING_SECRET: "synthetic-secret",
    } as Record<string, string>)[k];
  globalThis.fetch = (async (input) => {
    const u = new URL(String(input));
    calls.push(u.pathname);
    let data: unknown = [];
    if (u.pathname === "/api/resource/Contact") {
      data = [{
        name: "CON-1",
        modified: "2026-10-05 10:00:00",
        first_name: "Example",
      }];
    }
    if (u.pathname === "/api/resource/Contact/CON-1") {
      data = {
        name: "CON-1",
        modified: "2026-10-05 10:00:00",
        first_name: "Example",
        last_name: "Contact",
        email_ids: [{ email_id: "contact@example.test", is_primary: 1 }],
        phone_nos: [{ phone: "000-001", is_primary_phone: 1 }],
        links: [{ link_doctype: "Customer", link_name: "CUST-1" }],
      };
    }
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
    assert(!result.error, `sweep failed: ${result.error}`);
    assert(
      calls.includes("/api/resource/Contact/CON-1"),
      "must hydrate actual Contact document",
    );
    assert(db.rows.contacts.length === 1, "one contact adopted");
    const c = db.rows.contacts[0];
    assert(
      c.full_name === "Example Contact" && c.email === "contact@example.test" &&
        c.phone === "000-001",
      "native fields preserved",
    );
    assert(
      db.rows.external_refs.some((r) =>
        r.external_record_id === "Contact:CON-1"
      ),
      "Contact ID owns mapping",
    );
  } finally {
    globalThis.fetch = oldFetch;
    (Deno.env as unknown as { get: unknown }).get = oldEnv;
  }
});
