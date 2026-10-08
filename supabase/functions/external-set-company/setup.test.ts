import { assertEquals } from "@std/assert";
import { handleSetCompanyRequest, setTestJwks } from "./index.ts";
import {
  createAuthedRequest,
  createJwtAuthority,
  createTestJwksResolver,
  erp,
  installEdgeEnv,
  jsonResponse,
  restCall,
  rpcCall,
  supabaseRpc,
  supabaseSelect,
  withFetchMock,
} from "../_shared/testing/edgeTestKit.ts";
import { EXPENSES_EMPLOYABLE } from "../../../pmo-portal/src/lib/adapterSeam/erpnext/expenseEnablement.ts";
const env = installEdgeEnv();
const originalResolveDns = Deno.resolveDns;
Deno.resolveDns = ((hostname: string, recordType: string) => {
  if (recordType === 'A') return Promise.resolve(['8.8.8.8']);
  if (recordType === 'AAAA') return Promise.resolve(['2001:4860:4860::8888']);
  return Promise.reject(new Error('unexpected DNS query'));
}) as typeof Deno.resolveDns;
const authority = await createJwtAuthority(env.SUPABASE_URL);
setTestJwks(createTestJwksResolver(authority));
const binding = {
  secret_ref: "test-ref",
  status: "active",
  activated_at: "2026-10-01",
  version_major: 15,
  site_url: "https://erp.example.test",
  config: {
    company: "Example Company",
    project_map: { "project-1": "ERP-PROJECT-1" },
    default_payable_account: "Creditors - EX",
  },
};
function base(role = "Admin", active = true) {
  return [
    supabaseSelect(
      "profiles",
      (call) =>
        jsonResponse(
          call.url.searchParams.get("select") === "org_id, role" ||
            call.url.searchParams.get("select") === "org_id,role"
            ? { org_id: "org-1", role }
            : [{ id: "admin-1" }, { id: "member-2" }],
        ),
    ),
    supabaseSelect("platform_operators", () => jsonResponse(null)),
    supabaseRpc(
      "actor_authorization_state",
      () => jsonResponse({ role, active }),
    ),
    supabaseSelect("external_org_bindings", () => jsonResponse(binding)),
    supabaseRpc(
      "read_vault_secret",
      () => jsonResponse("synthetic-key:synthetic-secret"),
    ),
    supabaseRpc("log_audit", (call) => {
      assertEquals(
        (call.bodyJson as Record<string, unknown>).p_entity_id,
        null,
      );
      return jsonResponse(null);
    }),
  ];
}
async function request(body: unknown) {
  return createAuthedRequest(
    "https://edge.example.test/setup",
    body,
    await authority.mintJwt({ sub: "admin-1" }),
  );
}
Deno.test("AC-SETUP-003 Admin saves validated ERP activity and receivable defaults through atomic config patch", async () => {
  await withFetchMock([
    ...base(),
    erp(
      "erp.example.test",
      "/api/resource/Activity%20Type/Execution",
      () => jsonResponse({ data: { name: "Execution", disabled: 0 } }),
    ),
    erp(
      "erp.example.test",
      "/api/resource/Account/Debtors%20-%20EX",
      () =>
        jsonResponse({
          data: {
            name: "Debtors - EX",
            company: "Example Company",
            account_type: "Receivable",
            is_group: 0,
            disabled: 0,
          },
        }),
    ),
    supabaseRpc("merge_external_org_binding_config", () => jsonResponse(null)),
  ], async ({ calls }) => {
    const response = await handleSetCompanyRequest(
      await request({
        tier: "erpnext",
        setupAction: "save-defaults",
        activityType: "Execution",
        receivableAccount: "Debtors - EX",
      }),
    );
    assertEquals(response.status, 200);
    assertEquals(
      rpcCall(calls, "merge_external_org_binding_config")[0]?.bodyJson,
      {
        p_org_id: "org-1",
        p_external_tier: "erpnext",
        p_patch: {
          default_activity_type: "Execution",
          default_receivable_account: "Debtors - EX",
        },
      },
    );
  });
});
Deno.test("AC-SETUP-002 readiness lists actionable configuration and unmapped projects from own org", async () => {
  await withFetchMock([
    ...base(),
    supabaseSelect("external_domain_ownership", (call) => {
      assertEquals(call.url.searchParams.get("org_id"), "eq.org-1");
      return jsonResponse([{ domain: "companies" }]);
    }),
    supabaseSelect("projects", (call) => {
      assertEquals(call.url.searchParams.get("org_id"), "eq.org-1");
      return jsonResponse([{ id: "project-1", name: "Linked" }, {
        id: "project-2",
        name: "Unmapped",
        code: "SYNTH-2",
      }]);
    }),
    supabaseSelect("budget_category_account_map", () => jsonResponse([])),
    supabaseSelect(
      "erp_employees",
      () => jsonResponse([{ profile_id: "admin-1", link_state: "confirmed" }]),
    ),
  ], async () => {
    const response = await handleSetCompanyRequest(
      await request({ tier: "erpnext", setupAction: "readiness" }),
    );
    assertEquals(response.status, 200);
    const body = await response.json();
    assertEquals(body.domains, ["companies"]);
    assertEquals(body.unmappedProjects, [{
      id: "project-2",
      name: "Unmapped",
      code: "SYNTH-2",
    }]);
    assertEquals(body.defaults.default_receivable_account, null);
    assertEquals(body.budgetMappedCategories, []);
    assertEquals(body.unlinkedEmployeeCount, 1);
  });
});
Deno.test("AC-SETUP-001 Admin links a real ERP Project with concurrent config preservation", async () => {
  let patches = 0;
  const concurrentConfig = {
    ...binding.config,
    project_map: {
      ...binding.config.project_map,
      "other-project": "ERP-OTHER",
    },
    default_activity_type: "Execution",
  };
  await withFetchMock([
    supabaseSelect(
      "external_org_bindings",
      () =>
        jsonResponse({
          ...binding,
          config: patches ? concurrentConfig : binding.config,
        }),
    ),
    ...base(),
    supabaseSelect("projects", (call) => {
      assertEquals(call.url.searchParams.get("org_id"), "eq.org-1");
      assertEquals(call.url.searchParams.get("id"), "eq.project-2");
      return jsonResponse({
        id: "project-2",
        name: "Example Delivery",
        code: "SYNTH-2",
      });
    }),
    erp(
      "erp.example.test",
      "/api/resource/Project/ERP-SELECTED",
      () =>
        jsonResponse({
          data: {
            name: "ERP-SELECTED",
            project_name: "Example Delivery",
            company: "Example Company",
            is_active: "Yes",
          },
        }),
    ),
    {
      label: "conditional-config-patch",
      method: "PATCH",
      pathname: "/rest/v1/external_org_bindings",
      response: (call) => {
        assertEquals(call.url.searchParams.get("org_id"), "eq.org-1");
        assertEquals(call.url.searchParams.get("external_tier"), "eq.erpnext");
        assertEquals(
          JSON.parse(call.url.searchParams.get("config")!.slice(3)),
          patches ? concurrentConfig : binding.config,
        );
        patches++;
        if (patches === 1) return jsonResponse([]);
        assertEquals(call.bodyJson, {
          config: {
            ...concurrentConfig,
            project_map: {
              ...concurrentConfig.project_map,
              "project-2": "ERP-SELECTED",
            },
          },
        });
        return jsonResponse([{ org_id: "org-1" }]);
      },
    },
  ], async () => {
    const response = await handleSetCompanyRequest(
      await request({
        tier: "erpnext",
        setupAction: "link-project",
        projectId: "project-2",
        erpProject: "ERP-SELECTED",
      }),
    );
    assertEquals(response.status, 200);
    assertEquals((await response.json()).erpProject, "ERP-SELECTED");
    assertEquals(patches, 2);
  });
});
Deno.test("project link in another org refuses before any ERP or configuration write", async () => {
  await withFetchMock([
    ...base(),
    supabaseSelect("projects", () => jsonResponse(null)),
  ], async ({ calls }) => {
    const response = await handleSetCompanyRequest(
      await request({
        tier: "erpnext",
        setupAction: "link-project",
        projectId: "foreign-project",
        erpProject: "ERP-SELECTED",
      }),
    );
    assertEquals(response.status, 404);
    assertEquals(
      calls.filter((call) => call.url.host === "erp.example.test").length,
      0,
    );
    assertEquals(calls.filter((call) => call.method === "PATCH").length, 0);
  });
});
Deno.test("AC-SETUP-001 project creation stores the ERP returned identity and retry resolves the existing project without another POST", async () => {
  let created = false, posts = 0;
  await withFetchMock([
    ...base(),
    supabaseSelect("projects", () =>
      jsonResponse({
        id: "project-2",
        name: "Example Delivery",
        code: "SYNTH-2",
      })),
    erp("erp.example.test", "/api/resource/Project", (call) => {
      if (call.method === "POST") {
        posts++;
        created = true;
        assertEquals(call.bodyJson, {
          project_name: "Example Delivery",
          company: "Example Company",
        });
        return jsonResponse({
          data: {
            name: "PROJ-00042",
            project_name: "Example Delivery",
            company: "Example Company",
            is_active: "Yes",
          },
        });
      }
      const filters = JSON.parse(call.url.searchParams.get("filters")!);
      if (filters[1][0] === "name") {
        assertEquals(filters, [["company", "=", "Example Company"], [
          "name",
          "=",
          "SYNTH-2",
        ]]);
        return jsonResponse({ data: [] });
      }
      assertEquals(filters, [["company", "=", "Example Company"], [
        "project_name",
        "=",
        "Example Delivery",
      ]]);
      return jsonResponse({
        data: created
          ? [{
            name: "PROJ-00042",
            project_name: "Example Delivery",
            company: "Example Company",
            is_active: "Yes",
          }]
          : [],
      });
    }),
    {
      label: "project-config-patch",
      method: "PATCH",
      pathname: "/rest/v1/external_org_bindings",
      response: (call) => {
        assertEquals(
          (call.bodyJson as { config: { project_map: unknown } }).config
            .project_map,
          { "project-1": "ERP-PROJECT-1", "project-2": "PROJ-00042" },
        );
        return jsonResponse([{ org_id: "org-1" }]);
      },
    },
  ], async () => {
    for (let retry = 0; retry < 2; retry++) {
      const response = await handleSetCompanyRequest(
        await request({
          tier: "erpnext",
          setupAction: "ensure-project",
          projectId: "project-2",
        }),
      );
      assertEquals(response.status, 200);
      assertEquals((await response.json()).erpProject, "PROJ-00042");
    }
    assertEquals(posts, 1);
  });
});
Deno.test("Project Manager may ensure a project but cannot edit Admin defaults or relink it", async () => {
  for (const setupAction of ["save-defaults", "link-project"]) {
    await withFetchMock(base("Project Manager"), async ({ calls }) => {
      const response = await handleSetCompanyRequest(
        await request({
          tier: "erpnext",
          setupAction,
          projectId: "project-2",
          erpProject: "ERP-SELECTED",
          activityType: "Execution",
          receivableAccount: "Debtors - EX",
        }),
      );
      assertEquals(response.status, 403);
      assertEquals(
        calls.filter((call) => call.url.host === "erp.example.test").length,
        0,
      );
    });
  }
  await withFetchMock([
    ...base("Project Manager"),
    supabaseSelect("projects", () =>
      jsonResponse({
        id: "project-2",
        name: "Example Delivery",
        code: "SYNTH-2",
      })),
    erp("erp.example.test", "/api/resource/Project", () =>
      jsonResponse({
        data: [{
          name: "ERP-FOUND",
          project_name: "Example Delivery",
          company: "Example Company",
          is_active: "Yes",
        }],
      })),
    {
      label: "project-config-patch",
      method: "PATCH",
      pathname: "/rest/v1/external_org_bindings",
      response: () => jsonResponse([{ org_id: "org-1" }]),
    },
  ], async () => {
    const response = await handleSetCompanyRequest(
      await request({
        tier: "erpnext",
        setupAction: "ensure-project",
        projectId: "project-2",
      }),
    );
    assertEquals(response.status, 200);
  });
});
Deno.test("disabled or other-company ERP account refuses with zero configuration writes", async () => {
  for (
    const account of [{
      name: "Debtors - EX",
      company: "Other Company",
      account_type: "Receivable",
      disabled: 0,
      is_group: 0,
    }, {
      name: "Debtors - EX",
      company: "Example Company",
      account_type: "Receivable",
      disabled: 1,
      is_group: 0,
    }]
  ) {
    await withFetchMock([
      ...base(),
      erp(
        "erp.example.test",
        "/api/resource/Activity%20Type/Execution",
        () => jsonResponse({ data: { name: "Execution" } }),
      ),
      erp(
        "erp.example.test",
        "/api/resource/Account/Debtors%20-%20EX",
        () => jsonResponse({ data: account }),
      ),
      supabaseRpc(
        "merge_external_org_binding_config",
        () => jsonResponse(null),
      ),
    ], async ({ calls }) => {
      const response = await handleSetCompanyRequest(
        await request({
          tier: "erpnext",
          setupAction: "save-defaults",
          activityType: "Execution",
          receivableAccount: "Debtors - EX",
        }),
      );
      assertEquals(response.status, 422);
      assertEquals(
        rpcCall(calls, "merge_external_org_binding_config").length,
        0,
      );
    });
  }
});
Deno.test("non-Admin and inactive Admin setup requests refuse before ERP reads or config writes", async () => {
  for (
    const [role, active] of [["Engineer", true], ["Finance", true], [
      "Admin",
      false,
    ]] as const
  ) {
    await withFetchMock(base(role, active), async ({ calls }) => {
      const response = await handleSetCompanyRequest(
        await request({
          tier: "erpnext",
          setupAction: "save-defaults",
          activityType: "Execution",
          receivableAccount: "Debtors - EX",
        }),
      );
      assertEquals(response.status, 403);
      assertEquals(
        calls.filter((call) => call.url.host === "erp.example.test").length,
        0,
      );
      assertEquals(
        rpcCall(calls, "merge_external_org_binding_config").length,
        0,
      );
    });
  }
});
Deno.test("a Project from another ERP Company refuses before any mapping write", async () => {
  await withFetchMock([
    ...base(),
    supabaseSelect(
      "projects",
      () => jsonResponse({ id: "project-2", name: "Example Delivery" }),
    ),
    erp(
      "erp.example.test",
      "/api/resource/Project/ERP-SELECTED",
      () =>
        jsonResponse({
          data: {
            name: "ERP-SELECTED",
            company: "Other Company",
            is_active: "Yes",
          },
        }),
    ),
    {
      label: "config-write",
      method: "PATCH",
      pathname: "/rest/v1/external_org_bindings",
      response: () => jsonResponse([{ org_id: "org-1" }]),
    },
  ], async ({ calls }) => {
    const response = await handleSetCompanyRequest(
      await request({
        tier: "erpnext",
        setupAction: "link-project",
        projectId: "project-2",
        erpProject: "ERP-SELECTED",
      }),
    );
    assertEquals(response.status, 422);
    assertEquals(calls.filter((call) => call.method === "PATCH").length, 0);
  });
});
Deno.test("ERP Project search uses both actual code and name within the configured Company", async () => {
  const searchedFields: string[] = [];
  await withFetchMock([
    ...base(),
    erp("erp.example.test", "/api/resource/Project", (call) => {
      const filters = JSON.parse(call.url.searchParams.get("filters")!);
      assertEquals(filters[0], ["company", "=", "Example Company"]);
      assertEquals(filters[1], ["is_active", "=", "Yes"]);
      searchedFields.push(filters[2][0]);
      return jsonResponse({
        data: [{
          name: "PROJ-00042",
          project_name: "Example Delivery",
          company: "Example Company",
          is_active: "Yes",
        }],
      });
    }),
  ], async () => {
    const response = await handleSetCompanyRequest(
      await request({
        tier: "erpnext",
        setupAction: "list-projects",
        query: "Example",
      }),
    );
    assertEquals(response.status, 200);
    assertEquals((await response.json()).projects, [{
      name: "PROJ-00042",
      project_name: "Example Delivery",
      company: "Example Company",
      is_active: "Yes",
    }]);
    assertEquals(searchedFields, ["name", "project_name"]);
  });
});
Deno.test("setup rejects malformed bodies and default values at the authenticated boundary", async () => {
  for (
    const body of [null, [], {
      tier: "erpnext",
      setupAction: "save-defaults",
      activityType: {},
      receivableAccount: "Debtors - EX",
    }]
  ) {
    await withFetchMock(base(), async () => {
      const response = await handleSetCompanyRequest(await request(body));
      assertEquals(response.status, 400);
    });
  }
});
Deno.test("default identity must come from enabled scalar ERP masters before any config write", async () => {
  await withFetchMock([
    ...base(),
    erp(
      "erp.example.test",
      "/api/resource/Activity%20Type/Execution",
      () => jsonResponse({ data: { disabled: 0 } }),
    ),
    erp(
      "erp.example.test",
      "/api/resource/Account/Debtors%20-%20EX",
      () =>
        jsonResponse({
          data: {
            name: "Debtors - EX",
            company: "Example Company",
            account_type: "Receivable",
            is_group: 0,
            disabled: 0,
          },
        }),
    ),
    supabaseRpc("merge_external_org_binding_config", () => jsonResponse(null)),
  ], async ({ calls }) => {
    const response = await handleSetCompanyRequest(
      await request({
        tier: "erpnext",
        setupAction: "save-defaults",
        activityType: "Execution",
        receivableAccount: "Debtors - EX",
      }),
    );
    assertEquals(response.status, 422);
    assertEquals(rpcCall(calls, "merge_external_org_binding_config").length, 0);
  });
});
Deno.test("Admin employs a supported ERP domain under the authenticated org and actor after its read probe", async () => {
  await withFetchMock([
    ...base(),
    ...["Timesheet", "Employee", "Activity Type"].map((doctype) =>
      erp(
        "erp.example.test",
        `/api/resource/${encodeURIComponent(doctype)}`,
        () => jsonResponse({ data: [] }),
      )
    ),
    supabaseRpc("admin_change_domain_ownership", () => jsonResponse(null)),
  ], async ({ calls }) => {
    const response = await handleSetCompanyRequest(
      await request({
        tier: "erpnext",
        setupAction: "employ-domain",
        domain: "timesheets",
        orgId: "foreign-org",
        actorId: "foreign-actor",
      }),
    );
    assertEquals(response.status, 200);
    assertEquals(rpcCall(calls, "admin_change_domain_ownership")[0]?.bodyJson, {
      p_org_id: "org-1",
      p_external_tier: "erpnext",
      p_domain: "timesheets",
      p_action: "employ",
      p_actor_id: "admin-1",
    });
  });
});
Deno.test("Admin party onboarding forwards only the authenticated org to the existing service handler", async () => {
  await withFetchMock([...base(), {
    label: "party-onboard",
    method: "POST",
    pathname: "/functions/v1/erpnext-onboard",
    response: (call) => {
      assertEquals(call.bodyJson, { orgId: "org-1" });
      return jsonResponse({ ok: true });
    },
  }], async () => {
    const response = await handleSetCompanyRequest(
      await request({
        tier: "erpnext",
        setupAction: "onboard-parties",
        orgId: "foreign-org",
      }),
    );
    assertEquals(response.status, 200);
  });
});
Deno.test("project ensure searches the PMO code before creating a new ERP Project", async () => {
  await withFetchMock([
    ...base(),
    supabaseSelect("projects", () =>
      jsonResponse({
        id: "project-2",
        name: "Renamed Delivery",
        code: "SYNTH-2",
      })),
    erp("erp.example.test", "/api/resource/Project", (call) => {
      assertEquals(call.method, "GET");
      const filters = JSON.parse(call.url.searchParams.get("filters")!);
      assertEquals(filters[0], ["company", "=", "Example Company"]);
      return jsonResponse({
        data: filters[1][0] === "name"
          ? [{
            name: "SYNTH-2",
            project_name: "Original Delivery",
            company: "Example Company",
            is_active: "Yes",
          }]
          : [],
      });
    }),
    {
      label: "project-config-patch",
      method: "PATCH",
      pathname: "/rest/v1/external_org_bindings",
      response: (call) => {
        assertEquals(
          (call.bodyJson as { config: { project_map: Record<string, string> } })
            .config.project_map["project-2"],
          "SYNTH-2",
        );
        return jsonResponse([{ org_id: "org-1" }]);
      },
    },
  ], async () => {
    const response = await handleSetCompanyRequest(
      await request({
        tier: "erpnext",
        setupAction: "ensure-project",
        projectId: "project-2",
      }),
    );
    assertEquals(response.status, 200);
    assertEquals((await response.json()).erpProject, "SYNTH-2");
  });
});
Deno.test("an existing project mapping is checked against the active connected ERP Company before reuse", async () => {
  await withFetchMock([
    ...base(),
    supabaseSelect(
      "projects",
      () => jsonResponse({ id: "project-1", name: "Linked" }),
    ),
    erp(
      "erp.example.test",
      "/api/resource/Project/ERP-PROJECT-1",
      () =>
        jsonResponse({
          data: {
            name: "ERP-PROJECT-1",
            company: "Other Company",
            is_active: "Yes",
          },
        }),
    ),
  ], async ({ calls }) => {
    const response = await handleSetCompanyRequest(
      await request({
        tier: "erpnext",
        setupAction: "ensure-project",
        projectId: "project-1",
      }),
    );
    assertEquals(response.status, 422);
    assertEquals(calls.filter((call) => call.method === "PATCH").length, 0);
  });
});
Deno.test("project choices never expose a returned record outside the requested Company and active scope", async () => {
  await withFetchMock([
    ...base(),
    erp("erp.example.test", "/api/resource/Project", () =>
      jsonResponse({
        data: [{
          name: "OTHER",
          project_name: "Other",
          company: "Other Company",
          is_active: "Yes",
        }],
      })),
  ], async () => {
    const response = await handleSetCompanyRequest(
      await request({
        tier: "erpnext",
        setupAction: "list-projects",
        query: "",
      }),
    );
    assertEquals(response.status, 422);
  });
});
Deno.test("domain setup refuses unreadable masters and unsupported domains before ownership writes", async () => {
  for (const domain of ["timesheets", "tasks"]) {
    await withFetchMock([
      ...base(),
      ...["Timesheet", "Employee", "Activity Type"].map((doctype) =>
        erp(
          "erp.example.test",
          `/api/resource/${encodeURIComponent(doctype)}`,
          () => jsonResponse({ exc_type: "PermissionError" }, { status: 403 }),
        )
      ),
      supabaseRpc("admin_change_domain_ownership", () => jsonResponse(null)),
    ], async ({ calls }) => {
      const response = await handleSetCompanyRequest(
        await request({
          tier: "erpnext",
          setupAction: "employ-domain",
          domain,
        }),
      );
      assertEquals(response.status, domain === "timesheets" ? 422 : 400);
      assertEquals(rpcCall(calls, "admin_change_domain_ownership").length, 0);
    });
  }
});
Deno.test("project map persistence is bound to the ERP site used for the returned identity", async () => {
  let patches = 0;
  await withFetchMock([
    supabaseSelect("external_org_bindings", () =>
      jsonResponse({
        ...binding,
        site_url: patches
          ? "https://another-erp.example.test"
          : binding.site_url,
      })),
    ...base(),
    supabaseSelect(
      "projects",
      () => jsonResponse({ id: "project-2", name: "Delivery", code: null }),
    ),
    erp(
      "erp.example.test",
      "/api/resource/Project/ERP-SELECTED",
      () =>
        jsonResponse({
          data: {
            name: "ERP-SELECTED",
            company: "Example Company",
            is_active: "Yes",
          },
        }),
    ),
    {
      label: "site-bound-config-patch",
      method: "PATCH",
      pathname: "/rest/v1/external_org_bindings",
      response: (call) => {
        assertEquals(
          call.url.searchParams.get("site_url"),
          "eq.https://erp.example.test",
        );
        patches++;
        return jsonResponse([]);
      },
    },
  ], async ({ calls }) => {
    const response = await handleSetCompanyRequest(
      await request({
        tier: "erpnext",
        setupAction: "link-project",
        projectId: "project-2",
        erpProject: "ERP-SELECTED",
      }),
    );
    assertEquals(response.status, 422);
    assertEquals(calls.filter((call) => call.method === "PATCH").length, 1);
  });
});

Deno.test("AC-BAM-007 readiness counts each category with a push account exactly once", async () => {
  await withFetchMock([
    ...base(),
    supabaseSelect("external_domain_ownership", () => jsonResponse([])),
    supabaseSelect("projects", () => jsonResponse([])),
    supabaseSelect("budget_category_account_map", () =>
      jsonResponse([
        { id: "m1", category: "Labor", erp_account: "Salary - EX", is_push_target: true },
        { id: "m2", category: "Labor", erp_account: "Allowances - EX", is_push_target: false },
        { id: "m3", category: "Materials", erp_account: "Materials - EX", is_push_target: false },
        { id: "m4", category: "Equipment", erp_account: "Equipment - EX", is_push_target: true },
      ])),
    supabaseSelect("erp_employees", () => jsonResponse([])),
  ], async () => {
    const response = await handleSetCompanyRequest(
      await request({ tier: "erpnext", setupAction: "readiness" }),
    );
    assertEquals(response.status, 200);
    const body = await response.json();
    assertEquals(body.budgetMappedCategories, ["Labor", "Equipment"]);
  });
});

// ── #775 phase B — the expense account map is written only through these validating actions (DD-EXP-16). ──
const ACCOUNT = (name: string, over: Record<string, unknown> = {}) =>
  jsonResponse({
    data: {
      name, company: "Example Company", root_type: "Liability", account_type: "Payable", is_group: 0, disabled: 0,
      account_currency: "IDR", ...over,
    },
  });
const companyRouteWith = (defaultPayable: string | null) =>
  erp("erp.example.test", "/api/resource/Company/Example%20Company",
    () => jsonResponse({ data: { name: "Example Company", default_currency: "IDR", default_payable_account: defaultPayable } }));
const companyRoute = companyRouteWith("Creditors - EX");
const mapWrite = (method: string) => ({
  label: `expense_account_map ${method}`, method, pathname: "/rest/v1/expense_account_map",
  response: () => (method === "POST" ? jsonResponse(null, { status: 201 }) : new Response(null, { status: 204 })),
});

Deno.test("AC-EXP-120 an Admin cannot map the supplier payable account (Creditors) as employee payable", async () => {
  const result = await withFetchMock([
    ...base(), companyRoute, mapWrite("POST"),
    erp("erp.example.test", "/api/resource/Account/Creditors%20-%20EX", () => ACCOUNT("Creditors - EX")),
  ], async ({ calls }) => {
    const res = await handleSetCompanyRequest(await request({
      tier: "erpnext", setupAction: "save-expense-account", accountKey: "employee_payable", erpAccount: "Creditors - EX",
    }));
    return { status: res.status, text: await res.text(), calls };
  });
  assertEquals(result.status, 422);
  assertEquals(result.text.includes("supplier payable"), true, result.text);
  assertEquals(restCall(result.calls, "expense_account_map").length, 0);
  assertEquals(rpcCall(result.calls, "log_audit").length, 0);
});

// The supplier payable account is what ERPNext's Company names NOW — the binding's stored copy can be stale.
Deno.test("AC-EXP-120 the Creditors refusal reads the live ERPNext company, not the stored binding config", async () => {
  const save = (account: string, company: ReturnType<typeof companyRouteWith>) =>
    withFetchMock([
      ...base(), company, mapWrite("POST"),
      erp("erp.example.test", `/api/resource/Account/${encodeURIComponent(account)}`, () => ACCOUNT(account)),
    ], async ({ calls }) => {
      const res = await handleSetCompanyRequest(await request({
        tier: "erpnext", setupAction: "save-expense-account", accountKey: "employee_payable", erpAccount: account,
      }));
      return { status: res.status, text: await res.text(), calls };
    });
  // The stored config still says "Creditors - EX"; ERPNext's company now names another account.
  const repointed = await save("Supplier Payables - EX", companyRouteWith("Supplier Payables - EX"));
  assertEquals(repointed.status, 422, repointed.text);
  assertEquals(repointed.text.includes("supplier payable"), true, repointed.text);
  assertEquals(restCall(repointed.calls, "expense_account_map").length, 0);
  // A company that names no default payable account cannot confirm any employee payable account (fail closed).
  const unnamed = await save("Employee Payable - EX", companyRouteWith(null));
  assertEquals(unnamed.status, 422, unnamed.text);
  assertEquals(restCall(unnamed.calls, "expense_account_map").length, 0);
});

Deno.test("AC-EXP-120 an Admin cannot map an untyped advance account", async () => {
  const result = await withFetchMock([
    ...base(), companyRoute, mapWrite("POST"),
    erp("erp.example.test", "/api/resource/Account/Advances%20-%20EX", () => ACCOUNT("Advances - EX", { root_type: "Asset", account_type: "" })),
  ], async ({ calls }) => {
    const res = await handleSetCompanyRequest(await request({
      tier: "erpnext", setupAction: "save-expense-account", accountKey: "employee_advance", erpAccount: "Advances - EX",
    }));
    return { status: res.status, text: await res.text(), calls };
  });
  assertEquals(result.status, 422, result.text);
  assertEquals(restCall(result.calls, "expense_account_map").length, 0);
});

Deno.test("AC-EXP-120 an account ERPNext does not have is refused, not saved", async () => {
  const result = await withFetchMock([
    ...base(), companyRoute, mapWrite("POST"),
    erp("erp.example.test", "/api/resource/Account/Ghost%20-%20EX", () => jsonResponse({ exc_type: "DoesNotExistError" }, { status: 404 })),
  ], async ({ calls }) => {
    const res = await handleSetCompanyRequest(await request({
      tier: "erpnext", setupAction: "save-expense-account", accountKey: "Travel", erpAccount: "Ghost - EX",
    }));
    return { status: res.status, text: await res.text(), calls };
  });
  assertEquals(result.status, 422, result.text);
  assertEquals(result.text.includes("does not exist"), true, result.text);
  assertEquals(restCall(result.calls, "expense_account_map").length, 0);
});

Deno.test("AC-EXP-120 a valid account is upserted (trimmed) with the actor and audited", async () => {
  const result = await withFetchMock([
    ...base(), companyRoute, mapWrite("POST"),
    erp("erp.example.test", "/api/resource/Account/Employee%20Payable%20-%20EX", () => ACCOUNT("Employee Payable - EX")),
  ], async ({ calls }) => {
    const res = await handleSetCompanyRequest(await request({
      tier: "erpnext", setupAction: "save-expense-account", accountKey: "employee_payable", erpAccount: " Employee Payable - EX ",
    }));
    return { status: res.status, text: await res.text(), calls };
  });
  assertEquals(result.status, 200, result.text);
  const write = restCall(result.calls, "expense_account_map", "POST")[0];
  const row = write.bodyJson as Record<string, unknown>;
  assertEquals([row.org_id, row.account_key, row.erp_account, row.updated_by], ["org-1", "employee_payable", "Employee Payable - EX", "admin-1"]);
  assertEquals(write.url.searchParams.get("on_conflict"), "org_id,account_key");
  const audit = rpcCall(result.calls, "log_audit");
  assertEquals(audit.length, 1);
  assertEquals((audit[0].bodyJson as Record<string, unknown>).p_action, "integration.expense_account_map");
});

Deno.test("AC-EXP-120 clear-expense-account deletes the key in this org and audits it", async () => {
  const result = await withFetchMock([...base(), mapWrite("DELETE")], async ({ calls }) => {
    const res = await handleSetCompanyRequest(await request({ tier: "erpnext", setupAction: "clear-expense-account", accountKey: "Meals" }));
    return { status: res.status, calls };
  });
  assertEquals(result.status, 200);
  const del = restCall(result.calls, "expense_account_map", "DELETE")[0];
  assertEquals(del.url.searchParams.get("account_key"), "eq.Meals");
  assertEquals(del.url.searchParams.get("org_id"), "eq.org-1");
  assertEquals(rpcCall(result.calls, "log_audit").length, 1);
});

Deno.test("AC-EXP-120 a Project Manager is refused; an unknown key or a blank account is a bad request", async () => {
  const pm = await withFetchMock([...base("Project Manager")], async () =>
    (await handleSetCompanyRequest(await request({ tier: "erpnext", setupAction: "save-expense-account", accountKey: "Meals", erpAccount: "Meals - EX" }))).status);
  assertEquals(pm, 403);
  const bogus = await withFetchMock([...base()], async () =>
    (await handleSetCompanyRequest(await request({ tier: "erpnext", setupAction: "save-expense-account", accountKey: "Bogus", erpAccount: "X" }))).status);
  assertEquals(bogus, 400);
  const blank = await withFetchMock([...base()], async () =>
    (await handleSetCompanyRequest(await request({ tier: "erpnext", setupAction: "save-expense-account", accountKey: "Meals", erpAccount: "   " }))).status);
  assertEquals(blank, 400);
  const clearBogus = await withFetchMock([...base()], async () =>
    (await handleSetCompanyRequest(await request({ tier: "erpnext", setupAction: "clear-expense-account", accountKey: "Bogus" }))).status);
  assertEquals(clearBogus, 400);
});

// ── #775 phase B — the `expenses` employ switch (FR-EXP-118, DD-EXP-22). It opens only with #901 (the release guard
// `EXPENSES_EMPLOYABLE`, bound to the shipped GL fetch by expenseEnablement.test.ts); until then it refuses cleanly.
Deno.test("AC-EXP-128 employ-domain expenses: refused before #901 with nothing probed or written; once open, probes then records", async () => {
  const result = await withFetchMock([
    ...base(),
    {
      label: "erp read probes", host: "erp.example.test", method: "GET", pathname: /^\/api\/resource\//,
      response: () => jsonResponse({ data: [] }),
    },
    supabaseRpc("admin_change_domain_ownership", () => jsonResponse(null)),
  ], async ({ calls }) => {
    const res = await handleSetCompanyRequest(await request({ tier: "erpnext", setupAction: "employ-domain", domain: "expenses" }));
    return { status: res.status, text: await res.text(), calls };
  });
  const probed = result.calls.filter((c) => c.url.host === "erp.example.test").map((c) => decodeURIComponent(c.url.pathname));
  if (!EXPENSES_EMPLOYABLE) {
    assertEquals(result.status, 422, result.text);
    assertEquals(result.text.includes("not available yet"), true, result.text);
    assertEquals(probed, []);
    assertEquals(rpcCall(result.calls, "admin_change_domain_ownership").length, 0);
    return;
  }
  assertEquals(result.status, 200, result.text);
  assertEquals((rpcCall(result.calls, "admin_change_domain_ownership")[0].bodyJson as Record<string, unknown>).p_domain, "expenses");
  for (const doctype of ["Journal Entry", "Payment Entry", "Employee"]) {
    assertEquals(probed.some((p) => p.includes(`/api/resource/${doctype}`)), true, `${doctype} was not probed`);
  }
});

Deno.test("AC-EXP-128 the other domains are unchanged by the expenses guard", async () => {
  const result = await withFetchMock([
    ...base(),
    {
      label: "erp read probes", host: "erp.example.test", method: "GET", pathname: /^\/api\/resource\//,
      response: () => jsonResponse({ data: [] }),
    },
    supabaseRpc("admin_change_domain_ownership", () => jsonResponse(null)),
  ], async ({ calls }) => {
    const res = await handleSetCompanyRequest(await request({ tier: "erpnext", setupAction: "employ-domain", domain: "timesheets" }));
    return { status: res.status, calls };
  });
  assertEquals(result.status, 200);
  assertEquals((rpcCall(result.calls, "admin_change_domain_ownership")[0].bodyJson as Record<string, unknown>).p_domain, "timesheets");
});
