import { contactDb } from "../_shared/erpnextContacts.fixtures.ts";
(Deno as unknown as { serve: (...args: unknown[]) => unknown }).serve = () => ({
  finished: Promise.resolve(),
});
const { sweepOrgDoctypesLive } = await import("./index.ts");
const ORG = "00000000-0000-4000-8000-000000000073";
function assert(v: unknown, m: string): asserts v {
  if (!v) throw new Error(m);
}
async function runContactSweep(seed: Record<string, Array<Record<string, unknown>>> = {}, links = [{ link_doctype: "Customer", link_name: "CUST-1" }], docLinks: Record<string, typeof links> = { "CON-1": links }) {
  const db = contactDb({
    companies: [{ id: "company-1", org_id: ORG }],
    profiles: [{ id: "admin-1", org_id: ORG, status: "active", role: "Admin" }],
    notifications: [],
    ...seed,
    external_refs: seed.external_refs ?? [{
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
      data = Object.keys(docLinks).map((name, i) => ({
        name,
        modified: `2026-10-05 10:00:0${i}`,
        first_name: "Example",
      }));
    }
    const named = u.pathname.match(/^\/api\/resource\/Contact\/(.+)$/)?.[1];
    if (named && docLinks[named]) {
      data = {
        name: named,
        modified: `2026-10-05 10:00:0${Object.keys(docLinks).indexOf(named)}`,
        first_name: "Example",
        last_name: named === "CON-1" ? "Contact" : named,
        email_ids: [{ email_id: "contact@example.test", is_primary: 1 }],
        phone_nos: [{ phone: "000-001", is_primary_phone: 1 }],
        links: docLinks[named],
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
    return { result, calls, db };
  } finally {
    globalThis.fetch = oldFetch;
    (Deno.env as unknown as { get: unknown }).get = oldEnv;
  }
}

Deno.test("AC-CON-001 shipped sweep hydrates linked Contact child tables and updates the ERP-ID mirror", async () => {
  const { result, calls, db } = await runContactSweep();
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
});

Deno.test("AC-CON-001 sweep defers unmapped Contact adoption during unresolved outbound create", async () => {
  for (const state of ['pending', 'committing', 'committed', 'quarantined', 'held']) {
    const { result, db } = await runContactSweep({ external_command_outbox: [{ org_id: ORG, domain: 'companies', operation: 'create', state, payload: { erp_doc_kind: 'contact' } }] });
    // #828: the refusal is kept (no mirror, no mapping) but is terminal for this ONE document — it no
    // longer halts the sweep; an operator notice is raised instead.
    assert(!result.error, `refused Contact must not halt the sweep (${state}): ${result.error}`);
    assert(db.rows.contacts.length === 0, 'no competing mirror');
    assert(!db.rows.external_refs.some(r => r.external_record_id === 'Contact:CON-1'), 'no competing mapping');
    assert(db.rows.notifications.length === 1, `operator notice raised (${state})`);
  }
});
Deno.test("AC-CON-002 sweep requires all recognized parent links to resolve", async () => {
  const party = { org_id: ORG, domain: 'companies', pmo_record_id: 'company-1', external_record_id: 'Customer:CUST-1' };
  for (const foreign of [false, true]) {
    const { result, db } = await runContactSweep({
      companies: [{ id: 'company-1', org_id: ORG }, { id: 'company-foreign', org_id: 'other-org' }],
      external_refs: [party, ...(foreign ? [{ org_id: 'other-org', domain: 'companies', pmo_record_id: 'company-foreign', external_record_id: 'Supplier:OTHER' }] : [])],
    }, [{ link_doctype: 'Customer', link_name: 'CUST-1' }, { link_doctype: 'Supplier', link_name: 'OTHER' }]);
    assert(!result.error, 'refused Contact is skipped, not a halt (#828)');
    assert(db.rows.notifications.length === 1, 'unresolved recognized parent raises an operator notice');
    assert(db.rows.contacts.length === 0, 'no ambiguous mirror');
    assert(!db.rows.external_refs.some(r => r.external_record_id === 'Contact:CON-1'), 'no ambiguous mapping');
  }
});

Deno.test("AC-CON-001 mapped Contact updates continue during a neighboring unresolved create", async () => {
  const { result, db } = await runContactSweep({
    contacts: [{ id: 'contact-existing', org_id: ORG, company_id: 'company-1', full_name: 'Earlier Contact', erp_modified: '2026-01-01' }],
    external_refs: [{ org_id: ORG, domain: 'companies', pmo_record_id: 'company-1', external_record_id: 'Customer:CUST-1' }, { org_id: ORG, domain: 'companies', pmo_record_id: 'contact-existing', external_record_id: 'Contact:CON-1' }],
    external_command_outbox: [{ org_id: ORG, domain: 'companies', operation: 'create', state: 'held', payload: { erp_doc_kind: 'contact' } }],
  });
  assert(!result.error, `mapped update failed: ${result.error}`);
  assert(db.rows.contacts.length === 1 && db.rows.contacts[0].full_name === 'Example Contact', 'known mapping continues converging');
});
Deno.test("AC-CON-001 Contact adoption is unaffected by unrelated or completed commands", async () => {
  for (const row of [
    { org_id: 'other-org', domain: 'companies', operation: 'create', state: 'held', payload: { erp_doc_kind: 'contact' } },
    { org_id: ORG, domain: 'companies', operation: 'create', state: 'held', payload: { erp_doc_kind: 'supplier' } },
    { org_id: ORG, domain: 'companies', operation: 'create', state: 'confirmed', payload: { erp_doc_kind: 'contact' } },
    { org_id: ORG, domain: 'companies', operation: 'update', state: 'committing', payload: { erp_doc_kind: 'contact' } },
  ]) {
    const { result, db } = await runContactSweep({ external_command_outbox: [row] });
    assert(!result.error, `unrelated row stopped adoption: ${result.error}`);
    assert(db.rows.contacts.length === 1, 'native Contact adopted');
  }
});
Deno.test("AC-CON-002 duplicate links to one adopted parent are consistent and unrelated links remain ignored", async () => {
  const { result, db } = await runContactSweep({}, [
    { link_doctype: 'Customer', link_name: 'CUST-1' },
    { link_doctype: 'Customer', link_name: 'CUST-1' },
    { link_doctype: 'Project', link_name: 'OTHER' },
  ]);
  assert(!result.error, `consistent links failed: ${result.error}`);
  assert(db.rows.contacts.length === 1, 'consistent parent adopted');
});

Deno.test("AC-CON-003 #828 a refused Contact does not block a later Contact's update, and a notice is raised for the refused one", async () => {
  const two = [{ link_doctype: "Customer", link_name: "CUST-1" }, { link_doctype: "Customer", link_name: "CUST-2" }];
  const one = [{ link_doctype: "Customer", link_name: "CUST-1" }];
  const { result, db } = await runContactSweep({
    companies: [{ id: "company-1", org_id: ORG }, { id: "company-2", org_id: ORG }],
    external_refs: [
      { org_id: ORG, domain: "companies", pmo_record_id: "company-1", external_record_id: "Customer:CUST-1" },
      { org_id: ORG, domain: "companies", pmo_record_id: "company-2", external_record_id: "Customer:CUST-2" },
    ],
  }, one, { "CON-A": two, "CON-B": one });
  assert(!result.error, `refused Contact must not halt the sweep: ${result.error}`);
  assert(!db.rows.external_refs.some((r) => r.external_record_id === "Contact:CON-A"), "the refusal itself is kept");
  assert(db.rows.external_refs.some((r) => r.external_record_id === "Contact:CON-B"), "later Contact still adopted");
  assert(db.rows.contacts.length === 1 && db.rows.contacts[0].full_name === "Example CON-B", "later Contact mirrored");
  assert(db.rows.notifications.length === 1, "one notice for the refused Contact");
  const n = (db.rows.notifications[0] as Record<string, Record<string, unknown>>)["0"]; // the fixture spreads the inserted batch
  assert((n.metadata as Record<string, unknown>).action_required === "contact-not-adopted" && (n.metadata as Record<string, unknown>).erpName === "Contact:CON-A", "notice names the refused Contact");
  assert(db.writes.some((w) => w.table === "external_sync_watermarks"), "watermark advances past the refused Contact");
});
