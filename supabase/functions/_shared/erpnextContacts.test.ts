import * as feed from "./erpnextContacts.ts";
import {
  contactFromDoc,
  contactToBody,
} from "../../../pmo-portal/src/lib/adapterSeam/erpnext/bodies/contact.ts";
import { DOCTYPE_BODIES } from "../../../pmo-portal/src/lib/adapterSeam/erpnext/doctypeBodies.ts";
import { resolveErpDispatchAdapter } from "../../../pmo-portal/src/lib/adapterSeam/erpnext/dispatchFactory.ts";
import {
  type DispatchMoneyOutboxDeps,
  dispatchMoneyWrite,
  type OutboxRow,
} from "../../../pmo-portal/src/lib/adapterSeam/dispatch.ts";
import { canonicalCommandDigest } from "../adapter-dispatch/moneyOutboxDeps.ts";
import { getReadModelWriter } from "../adapter-dispatch/readModelWriters.ts";
import type { SupabaseClient } from "@supabase/supabase-js";
const ORG = "00000000-0000-4000-8000-000000000073";
function equal(a: unknown, b: unknown) {
  if (JSON.stringify(a) !== JSON.stringify(b)) {
    throw new Error(`expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
  }
}
function assert(v: unknown, m: string): asserts v {
  if (!v) throw new Error(m);
}
import { contactDb } from "./erpnextContacts.fixtures.ts";
type Row = Record<string, unknown>;
const parent = { id: "company-1", org_id: ORG };
const partyRef = {
  org_id: ORG,
  domain: "companies",
  pmo_record_id: "company-1",
  external_record_id: "Customer:CUST-1",
};
const doc = {
  name: "CON-1",
  modified: "2026-10-05 10:00:00",
  first_name: "Example",
  middle_name: "Test",
  last_name: "Contact",
  email_id: "contact@example.test",
  phone: "000-001",
  links: [{ link_doctype: "Customer", link_name: "CUST-1" }],
};
Deno.test("AC-CON-001 Contact mapper preserves middle name and primary email/phone from child tables", () => {
  const mapped = contactFromDoc({
    first_name: "Example",
    middle_name: "Test",
    last_name: "Contact",
    email_ids: [{ email_id: "contact@example.test", is_primary: 1 }],
    phone_nos: [{ phone: "000-001", is_primary_phone: 1 }],
  });
  equal(mapped.full_name, "Example Test Contact");
  equal(mapped.email, "contact@example.test");
  equal(mapped.phone, "000-001");
});
Deno.test("AC-CON-001 linked Contact adopt keyed by ERP ID, retry updates same row and stale event cannot overwrite it", async () => {
  const db = contactDb({ companies: [parent], external_refs: [partyRef] });
  const apply = (feed as unknown as {
    applyErpContact: (
      c: SupabaseClient,
      o: string,
      id: string,
      r: Row,
      ms: number,
    ) => Promise<unknown>;
  }).applyErpContact;
  assert(apply, "shipped contact apply is registered");
  await apply(db.client, ORG, "Contact:CON-1", {
    ...contactFromDoc(doc),
    id: "CON-1",
    erp_contact_links: doc.links,
  }, 200);
  equal(db.rows.contacts.length, 1);
  const id = db.rows.contacts[0].id;
  equal(db.rows.contacts[0].company_id, "company-1");
  equal(db.rows.contacts[0].email, "contact@example.test");
  await apply(db.client, ORG, "Contact:CON-1", {
    ...contactFromDoc(doc),
    id: "CON-1",
    full_name: "Updated Contact",
    erp_contact_links: doc.links,
  }, 300);
  await apply(db.client, ORG, "Contact:CON-1", {
    ...contactFromDoc(doc),
    id: "CON-1",
    full_name: "Stale Contact",
    erp_contact_links: doc.links,
  }, 100);
  equal(db.rows.contacts.length, 1);
  equal(db.rows.contacts[0].id, id);
  equal(db.rows.contacts[0].full_name, "Updated Contact");
  equal(
    db.rows.external_refs.filter((r) =>
      r.external_record_id === "Contact:CON-1"
    ).length,
    1,
  );
});
Deno.test("AC-CON-002 ambiguous existing contacts and multiple adopted company links refuse without any writes", async () => {
  const apply = (feed as unknown as {
    applyErpContact: (
      c: SupabaseClient,
      o: string,
      id: string,
      r: Row,
      ms: number,
    ) => Promise<unknown>;
  }).applyErpContact;
  assert(apply, "shipped contact apply is registered");
  for (const multipleParents of [false, true]) {
    const db = contactDb({
      companies: [parent, { id: "company-2", org_id: ORG }],
      external_refs: [partyRef, {
        ...partyRef,
        pmo_record_id: "company-2",
        external_record_id: "Supplier:SUP-1",
      }],
      contacts: multipleParents ? [] : [{
        id: "a",
        org_id: ORG,
        company_id: "company-1",
        full_name: "Example Test Contact",
      }, {
        id: "b",
        org_id: ORG,
        company_id: "company-1",
        full_name: "Example Test Contact",
      }],
    });
    const links = multipleParents
      ? [...doc.links, { link_doctype: "Supplier", link_name: "SUP-1" }]
      : doc.links;
    let rejected = false;
    try {
      await apply(db.client, ORG, "Contact:CON-1", {
        ...contactFromDoc(doc),
        id: "CON-1",
        erp_contact_links: links,
      }, 200);
    } catch (e) {
      rejected = (e as { code?: string }).code === "action-required" &&
        (e as Error).message.includes("Contact:CON-1");
    }
    assert(rejected, "ambiguity must be action-required");
    equal(db.writes, []);
  }
});
Deno.test("AC-CON-003 real contact adapter creates ERP Contact with resolved party link and primary child details", async () => {
  const db = contactDb({
    companies: [parent],
    external_refs: [partyRef],
    external_org_bindings: [{
      org_id: ORG,
      external_tier: "erpnext",
      site_url: "https://erp.example.test",
      activated_at: "2026-01-01",
      version_major: 15,
      config: {},
    }],
  });
  const calls: Array<{ method: string; body?: Row }> = [];
  const fetchImpl = (async (_input: unknown, init?: RequestInit) => {
    calls.push({
      method: init?.method ?? "GET",
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    });
    return new Response(JSON.stringify({ data: doc }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
  const command = {
    domain: "companies",
    operation: "create" as const,
    record: {
      id: "new-contact",
      erp_doc_kind: "contact",
      company_id: "company-1",
      full_name: "Example Test Contact",
      email: "contact@example.test",
      phone: "000-001",
    },
  };
  const adapter = await resolveErpDispatchAdapter({
    serviceClient: db.client as never,
    orgId: ORG,
    command,
    fetchImpl,
    apiKey: "test-key",
    apiSecret: "test-secret",
    doctypeBodies: DOCTYPE_BODIES,
  });
  const result = await adapter.commit(command);
  // Non-submittable masters use the ERP POST readback, as Customer/Supplier do.
  equal(calls.map((c) => c.method), ["POST"]);
  equal(calls[0].body?.links, [{
    link_doctype: "Customer",
    link_name: "CUST-1",
  }]);
  equal(calls[0].body?.email_ids, [{
    email_id: "contact@example.test",
    is_primary: 1,
  }]);
  equal(calls[0].body?.phone_nos, [{ phone: "000-001", is_primary_phone: 1 }]);
  await getReadModelWriter("companies").upsert(
    { serviceClient: db.client as never, orgId: ORG },
    result.canonical,
    command,
  );
  equal(db.rows.contacts.length, 1);
  equal(db.rows.contacts[0].company_id, "company-1");
  equal(db.rows.contacts[0].full_name, "Example Test Contact");
  equal(db.rows.contacts[0].erp_modified, doc.modified);
});
Deno.test("contact parent in another org or unmapped refuses before any ERP write", async () => {
  for (
    const seed of [{
      companies: [{ ...parent, org_id: "other-org" }],
      external_refs: [partyRef],
    }, { companies: [parent], external_refs: [] }]
  ) {
    const db = contactDb({
      ...seed,
      external_org_bindings: [{
        org_id: ORG,
        external_tier: "erpnext",
        site_url: "https://erp.example.test",
        activated_at: "2026-01-01",
        version_major: 15,
        config: {},
      }],
    });
    let calls = 0;
    let rejected = false;
    try {
      const command = {
        domain: "companies",
        operation: "create" as const,
        record: {
          id: "c",
          erp_doc_kind: "contact",
          company_id: "company-1",
          full_name: "Example",
        },
      };
      const a = await resolveErpDispatchAdapter({
        serviceClient: db.client as never,
        orgId: ORG,
        command,
        fetchImpl: (async () => {
          calls++;
          return new Response("{}");
        }) as typeof fetch,
        apiKey: "test",
        apiSecret: "test",
        doctypeBodies: DOCTYPE_BODIES,
      });
      await a.commit(command);
    } catch {
      rejected = true;
    }
    assert(rejected, "unsafe/unmapped parent rejected");
    equal(calls, 0);
  }
});

Deno.test("Contact adoption scopes parent references and candidates to this org and never adopts unlinked masters", async () => {
  const apply = feed.applyErpContact;
  const db = contactDb({
    companies: [{ ...parent, org_id: "other-org" }],
    external_refs: [{ ...partyRef, org_id: "other-org" }],
    contacts: [{
      id: "foreign",
      org_id: "other-org",
      company_id: "company-1",
      full_name: "Example Test Contact",
    }],
  });
  let rejected = false;
  try {
    await apply(db.client, ORG, "Contact:CON-1", {
      ...contactFromDoc(doc),
      id: "CON-1",
      erp_contact_links: doc.links,
    }, 200);
  } catch (e) {
    rejected = (e as { code?: string }).code === "contact-parent-unmapped";
  }
  assert(rejected, "parent in another org cannot be linked");
  equal(db.writes, []);
  const unlinked = await apply(db.client, ORG, "Contact:CON-2", {
    ...contactFromDoc(doc),
    id: "CON-2",
    erp_contact_links: [],
  }, 200);
  equal(unlinked, { kind: "no-op" });
  equal(db.writes, []);
});
Deno.test("one matching native contact is adopted without duplicating or replacing another ERP Contact mapping", async () => {
  const db = contactDb({
    companies: [parent],
    external_refs: [partyRef],
    contacts: [{
      id: "native",
      org_id: ORG,
      company_id: "company-1",
      full_name: "Example Test Contact",
      notes: "Keep enhancement",
    }],
  });
  await feed.applyErpContact(db.client, ORG, "Contact:CON-1", {
    ...contactFromDoc(doc),
    id: "CON-1",
    erp_contact_links: doc.links,
  }, 200);
  equal(db.rows.contacts.length, 1);
  equal(db.rows.contacts[0].id, "native");
  equal(db.rows.contacts[0].notes, "Keep enhancement");
  const before = db.writes.length;
  let rejected = false;
  try {
    await feed.applyErpContact(db.client, ORG, "Contact:CON-OTHER", {
      ...contactFromDoc(doc),
      id: "CON-OTHER",
      erp_contact_links: doc.links,
    }, 300);
  } catch (e) {
    rejected = (e as { code?: string }).code === "action-required";
  }
  assert(rejected, "a different Contact ID cannot reuse a mapped row");
  equal(db.writes.length, before);
});

Deno.test("Contact body omits absent optional details and refuses missing name or parent", () => {
  const ctx = {
    refs: { contact_party_type: "Customer", contact_party_name: "CUST-1" },
    config: {},
  };
  equal(contactToBody({ id: "c", full_name: "Example Contact" }, ctx), {
    first_name: "Example Contact",
    links: [{ link_doctype: "Customer", link_name: "CUST-1" }],
  });
  for (
    const [record, context] of [[{ id: "c", full_name: "" }, ctx], [{
      id: "c",
      full_name: "Example Contact",
    }, { refs: {}, config: {} }]] as const
  ) {
    let rejected = false;
    try {
      contactToBody(record, context);
    } catch (e) {
      rejected = (e as { code?: string }).code === "commit-rejected";
    }
    assert(rejected, "invalid Contact body must refuse");
  }
  equal(contactFromDoc({ full_name: "Readback Name", mobile_no: "000-002" }), {
    full_name: "Readback Name",
    email: null,
    phone: "000-002",
  });
  equal(contactFromDoc({}), { full_name: "", email: null, phone: null });
});
Deno.test("Contact create cannot replace an existing company identity; refusal happens before any ERP write", async () => {
  const db = contactDb({
    companies: [parent],
    external_refs: [partyRef],
    external_org_bindings: [{
      org_id: ORG,
      external_tier: "erpnext",
      site_url: "https://erp.example.test",
      activated_at: "2026-01-01",
      version_major: 15,
      config: {},
    }],
  });
  const command = {
    domain: "companies",
    operation: "create" as const,
    record: {
      id: "company-1",
      erp_doc_kind: "contact",
      company_id: "company-1",
      full_name: "Example Contact",
    },
  };
  let calls = 0, rejected = false;
  try {
    const a = await resolveErpDispatchAdapter({
      serviceClient: db.client as never,
      orgId: ORG,
      command,
      fetchImpl: (async () => {
        calls++;
        return new Response(JSON.stringify({ data: doc }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }) as typeof fetch,
      apiKey: "synthetic-key",
      apiSecret: "synthetic-secret",
      doctypeBodies: DOCTYPE_BODIES,
    });
    await a.commit(command);
  } catch (e) {
    rejected = (e as { code?: string }).code === "commit-rejected";
  }
  assert(rejected, "company identity cannot become Contact identity");
  equal(calls, 0);
  equal(db.rows.external_refs, [partyRef]);
});

const binding = {
  org_id: ORG,
  external_tier: "erpnext",
  site_url: "https://erp.example.test",
  activated_at: "2026-01-01",
  version_major: 15,
  config: {},
};
for (const kind of ["customer", "supplier"]) {
  Deno.test(`${kind} create cannot replace an existing Contact identity; zero ERP writes`, async () => {
    const db = contactDb({
      contacts: [{ id: "contact-1", org_id: ORG }],
      external_org_bindings: [binding],
    });
    const command = {
      domain: "companies",
      operation: "create" as const,
      record: { id: "contact-1", erp_doc_kind: kind, name: "Example Company" },
    };
    let calls = 0, rejected = false;
    try {
      const adapter = await resolveErpDispatchAdapter({
        serviceClient: db.client as never,
        orgId: ORG,
        command,
        fetchImpl: (async () => {
          calls++;
          return new Response(
            JSON.stringify({
              data: {
                name: "PARTY-1",
                customer_name: "Example Company",
                supplier_name: "Example Company",
              },
            }),
            { headers: { "content-type": "application/json" } },
          );
        }) as typeof fetch,
        apiKey: "synthetic-key",
        apiSecret: "synthetic-secret",
        doctypeBodies: DOCTYPE_BODIES,
      });
      await adapter.commit(command);
    } catch (e) {
      rejected = (e as { code?: string }).code === "commit-rejected";
    }
    assert(rejected, "Contact identity cannot become company identity");
    equal(calls, 0);
    equal(db.writes, []);
  });
}
for (const state of ["confirmed", "committed"] as const) {
  Deno.test(`completed Contact ${state} recovery converges mirror without authoring validation or ERP writes`, async () => {
    // An already-completed historical command must remain recoverable even when authoring would refuse its identity.
    const db = contactDb({
      companies: [parent],
      external_refs: [partyRef],
      external_org_bindings: [binding],
    });
    const command = {
      domain: "companies",
      operation: "create" as const,
      idempotencyKey: "synthetic-recovery-key",
      record: {
        id: "company-1",
        erp_doc_kind: "contact",
        company_id: "company-1",
        full_name: "Example Contact",
      },
    };
    let calls = 0, mirrorWrites = 0;
    const adapter = await resolveErpDispatchAdapter({
      serviceClient: db.client as never,
      orgId: ORG,
      command,
      fetchImpl: (async () => {
        calls++;
        throw new Error("no ERP request during completed recovery");
      }) as typeof fetch,
      apiKey: "synthetic-key",
      apiSecret: "synthetic-secret",
      doctypeBodies: DOCTYPE_BODIES,
    });
    const row: OutboxRow = {
      id: "outbox-1",
      domain: "companies",
      pmoRecordId: command.record.id,
      idempotencyKey: command.idempotencyKey,
      state,
      externalRecordId: "CON-1",
      canonical: { id: command.record.id, full_name: "Example Contact" },
      claimGeneration: 1,
      payloadDigest: await canonicalCommandDigest(command),
    };
    const money = {
      readOutbox: async () => row,
      payloadDigest: await canonicalCommandDigest(command),
      recordOutboxRef: async () => 1,
      confirmOutbox: async () => 1,
    } as unknown as DispatchMoneyOutboxDeps;
    const result = await dispatchMoneyWrite({
      command,
      adapter,
      money,
      recordExternalRef: async () => {},
      writeReadModel: async (canonical, opts) => {
        equal(canonical, row.canonical);
        equal(opts, { isReplay: true });
        mirrorWrites++;
      },
    });
    equal(result.externalRecordId, "CON-1");
    equal(mirrorWrites, 1);
    equal(calls, 0);
  });
}

Deno.test("Contact canonical update preserves PMO enhancements and refuses foreign parent before mirror writes", async () => {
  const db = contactDb({
    companies: [parent],
    contacts: [{
      id: "contact-1",
      org_id: ORG,
      company_id: parent.id,
      full_name: "Before",
      title: "Example role",
      notes: "Keep note",
    }],
  });
  const command = {
    domain: "companies",
    operation: "update" as const,
    record: { id: "contact-1", erp_doc_kind: "contact", company_id: parent.id },
  };
  await getReadModelWriter("companies").upsert({
    serviceClient: db.client as never,
    orgId: ORG,
  }, {
    id: "contact-1",
    full_name: "After",
    email: "updated@example.test",
    erp_modified: doc.modified,
  }, command);
  equal(db.rows.contacts[0].title, "Example role");
  equal(db.rows.contacts[0].notes, "Keep note");
  equal(db.rows.contacts[0].full_name, "After");
  equal(db.rows.contacts[0].phone, null);
  const foreign = contactDb({
    companies: [{ ...parent, org_id: "other-org" }],
  });
  let rejected = false;
  try {
    await getReadModelWriter("companies").upsert(
      { serviceClient: foreign.client as never, orgId: ORG },
      { id: "contact-1" },
      command,
    );
  } catch (e) {
    rejected = (e as { code?: string }).code === "cross-org-link-rejected";
  }
  assert(rejected, "foreign company cannot enter contact mirror");
  equal(foreign.writes, []);
});

Deno.test("AC-CON-001 Contact adoption ignores same-name native contacts outside this org", async () => {
  const db = contactDb({
    companies: [parent],
    external_refs: [partyRef],
    contacts: [{ id: "foreign", org_id: "other-org", company_id: "company-1", full_name: "Example Test Contact" }],
  });
  await feed.applyErpContact(db.client, ORG, "Contact:CON-1", {
    ...contactFromDoc(doc),
    id: "CON-1",
    erp_contact_links: doc.links,
  }, 200);
  const mapping = db.rows.external_refs.find((r) => r.external_record_id === "Contact:CON-1");
  assert(mapping && mapping.org_id === ORG && mapping.pmo_record_id !== "foreign", "this org mints its own Contact");
  equal(db.rows.contacts.find((r) => r.id === "foreign"), { id: "foreign", org_id: "other-org", company_id: "company-1", full_name: "Example Test Contact" });
  assert(db.rows.contacts.some((r) => r.org_id === ORG && r.id === mapping.pmo_record_id), "adopted row belongs to this org");
});
Deno.test("AC-CON-002 Contact parent reference to a company outside this org refuses without writes", async () => {
  const db = contactDb({
    companies: [{ ...parent, org_id: "other-org" }],
    external_refs: [partyRef],
  });
  let code: string | undefined;
  try {
    await feed.applyErpContact(db.client, ORG, "Contact:CON-1", {
      ...contactFromDoc(doc),
      id: "CON-1",
      erp_contact_links: doc.links,
    }, 200);
  } catch (e) {
    code = (e as { code?: string }).code;
  }
  equal(code, "contact-parent-unmapped");
  equal(db.writes, []);
});
