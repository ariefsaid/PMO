import { contactDb } from "../_shared/erpnextContacts.fixtures.ts";
let handler: (r: Request) => Promise<Response>;
(Deno as unknown as { serve: (h: typeof handler) => unknown }).serve = (h) => {
  handler = h;
  return { finished: Promise.resolve() };
};
await import("./index.ts");
const ORG = "00000000-0000-4000-8000-000000000073";
function assert(v: unknown, m: string): asserts v {
  if (!v) throw new Error(m);
}
function fixture() {
  const db = contactDb({
    companies: [{ id: "company-1", org_id: ORG }],
    external_refs: [{
      org_id: ORG,
      domain: "companies",
      pmo_record_id: "company-1",
      external_record_id: "Customer:CUST-1",
    }],
    external_org_bindings: [{
      org_id: ORG,
      external_tier: "erpnext",
      site_url: "https://erp.example.test",
      secret_ref: "test-binding",
      activated_at: "2026-01-01",
    }],
  });
  const oldEnv = Deno.env.get, oldFetch = globalThis.fetch;
  const oldInterval = globalThis.setInterval;
  const intervals: ReturnType<typeof setInterval>[] = [];
  globalThis.setInterval = ((...args: Parameters<typeof setInterval>) => {
    const id = oldInterval(...args);
    intervals.push(id);
    return id;
  }) as typeof setInterval;
  const calls: string[] = [];
  (Deno.env as unknown as { get: (k: string) => string | undefined }).get = (
    k,
  ) =>
    ({
      SUPABASE_URL: "https://supabase.example.test",
      SUPABASE_SERVICE_ROLE_KEY: "synthetic-service-token",
      TEST_BINDING_KEY: "synthetic-key",
      TEST_BINDING_SECRET: "synthetic-secret",
    } as Record<string, string>)[k];
  globalThis.fetch = (async (input, init?: RequestInit) => {
    const u = new URL(String(input));
    calls.push(u.pathname);
    let data: unknown = [];
    if (u.pathname.startsWith("/rest/v1/")) {
      const table = u.pathname.split("/").at(-1)!;
      let q = db.client.from(table).select("*");
      if (init?.method === "POST") {
        const row = JSON.parse(String(init.body));
        await db.client.from(table).insert(row);
        return new Response(null, { status: 201 });
      }
      for (const [k, v] of u.searchParams) {
        if (v.startsWith("eq.")) q = q.eq(k, v.slice(3));
      }
      data = (await q).data;
      return new Response(JSON.stringify(data), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (u.pathname === "/api/resource/Contact") {
      data = [{ name: "CON-1", modified: "2026-10-05 10:00:00" }];
    }
    if (u.pathname === "/api/resource/Contact/CON-1") {
      data = {
        name: "CON-1",
        modified: "2026-10-05 10:00:00",
        first_name: "Example",
        last_name: "Contact",
        email_id: "contact@example.test",
        phone: "000-001",
        links: [{ link_doctype: "Customer", link_name: "CUST-1" }],
      };
    }
    return new Response(JSON.stringify({ data }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
  return {
    db,
    calls,
    restore: () => {
      intervals.forEach(clearInterval);
      globalThis.setInterval = oldInterval;
      globalThis.fetch = oldFetch;
      (Deno.env as unknown as { get: unknown }).get = oldEnv;
    },
  };
}
const req = (authorized: boolean) =>
  new Request("https://function.example.test", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      Authorization: authorized
        ? "Bearer synthetic-service-token"
        : "Bearer invalid",
    },
    body: JSON.stringify({ orgId: ORG }),
  });
Deno.test("AC-CON-001 shipped onboarding hydrates ERP Contact and reconciles same ID on retry", async () => {
  const f = fixture();
  try {
    for (let i = 0; i < 2; i++) {
      const r = await handler(req(true));
      const body = await r.json();
      assert(r.status === 200, `onboard ${r.status}: ${JSON.stringify(body)}`);
    }
    assert(
      f.calls.includes("/api/resource/Contact/CON-1"),
      "onboarding must fetch full Contact links",
    );
    assert(f.db.rows.contacts.length === 1, "retry must not duplicate contact");
    assert(
      f.db.rows.contacts[0].company_id === "company-1" &&
        f.db.rows.contacts[0].email === "contact@example.test",
      "linked native fields retained",
    );
  } finally {
    f.restore();
  }
});
Deno.test("contact onboarding rejects unauthorized bearer before any DB or ERP call", async () => {
  const f = fixture();
  try {
    const r = await handler(req(false));
    assert(r.status === 401, "unauthorized");
    assert(f.calls.length === 0, "no effects before authorization");
  } finally {
    f.restore();
  }
});
