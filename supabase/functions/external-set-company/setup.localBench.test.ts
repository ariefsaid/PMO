/**
 * [Deno] The ERP setup actions run against the org's STORED binding, so a developer's served lane
 * (local Supabase + `ERPNEXT_ALLOW_LOCAL_BENCH=1`) must reach the plain-http local bench through the
 * shared host guard's allowance (#1318), while the same binding stays refused without the flag.
 *
 * Verify: cd supabase/functions/external-set-company && deno test setup.localBench.test.ts --allow-env --allow-net --allow-read
 */
import { assertEquals } from "@std/assert";
import { handleSetCompanyRequest, setTestJwks } from "./index.ts";
import {
  createAuthedRequest,
  createJwtAuthority,
  createTestJwksResolver,
  erp,
  installEdgeEnv,
  jsonResponse,
  supabaseRpc,
  supabaseSelect,
  withFetchMock,
} from "../_shared/testing/edgeTestKit.ts";

// The SUPABASE_URL `supabase functions serve` gives a served function.
const env = installEdgeEnv({ SUPABASE_URL: "http://kong:8000" });
const authority = await createJwtAuthority(env.SUPABASE_URL);
setTestJwks(createTestJwksResolver(authority));

const BENCH_HOST = "host.docker.internal:8080";
const binding = {
  secret_ref: "local-bench",
  status: "active",
  activated_at: "2026-10-01",
  version_major: 15,
  site_url: `http://${BENCH_HOST}`,
  config: { company: "Example Company" },
};

function routes() {
  return [
    supabaseSelect("profiles", () => jsonResponse({ org_id: "org-1", role: "Admin" })),
    supabaseSelect("platform_operators", () => jsonResponse(null)),
    supabaseRpc("actor_authorization_state", () => jsonResponse({ role: "Admin", active: true })),
    supabaseSelect("external_org_bindings", () => jsonResponse(binding)),
    supabaseRpc("read_vault_secret", () => jsonResponse("synthetic-key:synthetic-secret")),
    erp(BENCH_HOST, "/api/resource/Project", () =>
      jsonResponse({ data: [{ name: "PROJ-1", project_name: "Bench project", company: "Example Company", is_active: "Yes" }] })),
  ];
}

async function listProjects() {
  return handleSetCompanyRequest(createAuthedRequest(
    "https://edge.example.test/setup",
    { tier: "erpnext", setupAction: "list-projects" },
    await authority.mintJwt({ sub: "admin-1" }),
  ));
}

Deno.test("local bench: setup actions reach the stored bench binding when the allowance is on", async () => {
  Deno.env.set("ERPNEXT_ALLOW_LOCAL_BENCH", "1");
  try {
    await withFetchMock(routes(), async ({ calls }) => {
      const response = await listProjects();
      assertEquals(response.status, 200);
      assertEquals(calls.filter((call) => call.url.host === BENCH_HOST).length > 0, true);
    });
  } finally {
    Deno.env.delete("ERPNEXT_ALLOW_LOCAL_BENCH");
  }
});

Deno.test("local bench: setup actions refuse the same binding without the allowance flag", async () => {
  Deno.env.delete("ERPNEXT_ALLOW_LOCAL_BENCH");
  await withFetchMock(routes(), async ({ calls }) => {
    const response = await listProjects();
    assertEquals(response.status, 422);
    assertEquals((await response.json()).message, "ERPNext site URL is not allowed");
    assertEquals(calls.filter((call) => call.url.host === BENCH_HOST).length, 0);
  });
});

Deno.test({
  name: "local bench: env restored",
  fn: () => env.restore(),
});
