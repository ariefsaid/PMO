import type { SupabaseClient } from "@supabase/supabase-js";
import { AppError } from "../../../pmo-portal/src/lib/appError.ts";
import { fetchAllRowsByKeyset } from "../../../pmo-portal/src/lib/pagedRead.ts";
import {
  createDoc,
  type ErpClientDeps,
  ErpError,
  getDoc,
  listDocsByFilters,
} from "../../../pmo-portal/src/lib/adapterSeam/erpnext/client.ts";
import {
  type ErpAccountFacts,
  expenseAccountProblem,
  isExpenseAccountKey,
} from "../../../pmo-portal/src/lib/adapterSeam/erpnext/expenseAccountRules.ts";
import { EXPENSES_EMPLOYABLE } from "../../../pmo-portal/src/lib/adapterSeam/erpnext/expenseEnablement.ts";
import {
  ACTIVATION_PROBE_TOTAL_BUDGET_MS,
  assertErpReadPermissions,
} from "../../../pmo-portal/src/lib/adapterSeam/erpnext/binding.ts";
import { sweepKindsForOrg } from "../../../pmo-portal/src/lib/adapterSeam/erpnext/feedKinds.ts";

export interface ErpSetupBody {
  setupAction?: string;
  activityType?: string;
  receivableAccount?: string;
  projectId?: string;
  erpProject?: string;
  query?: string;
  domain?: string;
  /** #775 phase B — `save-expense-account` / `clear-expense-account` (FR-EXP-112). */
  accountKey?: string;
  erpAccount?: string;
}
export interface ErpSetupContext {
  serviceClient: SupabaseClient;
  orgId: string;
  actorId: string;
  company: string;
  config: Record<string, unknown>;
  client: ErpClientDeps;
}
/** Admin setup uses the existing atomic org config patch, keeping every unrelated setting. */
export async function applyErpSetup(
  body: ErpSetupBody,
  ctx: ErpSetupContext,
): Promise<unknown> {
  if (body.setupAction === "employ-domain") {
    return await employErpDomain(body, ctx);
  }
  if (body.setupAction === "onboard-parties") {
    const { data, error } = await ctx.serviceClient.functions.invoke(
      "erpnext-onboard",
      { body: { orgId: ctx.orgId } },
    );
    if (error || data?.ok !== true) {
      throw new AppError(
        "Party onboarding did not complete; retry from setup",
        "config-rejected",
      );
    }
    return { ok: true };
  }
  if (body.setupAction === "list-projects") {
    return await listErpProjects(body, ctx);
  }
  if (body.setupAction === "ensure-project") {
    return await ensureErpProject(body, ctx);
  }
  if (body.setupAction === "link-project") {
    return await linkErpProject(body, ctx);
  }
  if (body.setupAction === "save-expense-account") {
    return await saveExpenseAccount(body, ctx);
  }
  if (body.setupAction === "clear-expense-account") {
    return await clearExpenseAccount(body, ctx);
  }
  if (body.setupAction === "readiness") return await readErpSetup(ctx);
  if (body.setupAction !== "save-defaults") {
    throw new AppError("Unknown ERP setup action", "BAD_REQUEST");
  }
  if (
    typeof body.activityType !== "string" ||
    typeof body.receivableAccount !== "string" || !body.activityType.trim() ||
    !body.receivableAccount.trim()
  ) {
    throw new AppError(
      "Activity type and receivable account are required",
      "BAD_REQUEST",
    );
  }
  const activity = await getDoc(
    ctx.client,
    "Activity Type",
    body.activityType.trim(),
  ) as Record<string, unknown>;
  const account = await getDoc(
    ctx.client,
    "Account",
    body.receivableAccount.trim(),
  ) as Record<string, unknown>;
  if (
    typeof activity.name !== "string" || !activity.name.trim() ||
    typeof account.name !== "string" || !account.name.trim() ||
    activity.disabled || account.disabled || account.is_group ||
    account.account_type !== "Receivable" || account.company !== ctx.company
  ) {
    throw new AppError(
      "Choose an enabled activity type and a receivable account for the connected Company",
      "config-rejected",
    );
  }
  const { error } = await ctx.serviceClient.rpc(
    "merge_external_org_binding_config",
    {
      p_org_id: ctx.orgId,
      p_external_tier: "erpnext",
      p_patch: {
        default_activity_type: activity.name,
        default_receivable_account: account.name,
      },
    },
  );
  if (error) throw new AppError(error.message, error.code);
  const { error: auditError } = await ctx.serviceClient.rpc("log_audit", {
    p_action: "integration.setup_defaults",
    p_org_id: ctx.orgId,
    p_actor_id: ctx.actorId,
    p_entity_id: null,
    p_detail: { tier: "erpnext" },
  });
  if (auditError) throw new AppError(auditError.message, auditError.code);
  return { ok: true };
}

async function employErpDomain(body: ErpSetupBody, ctx: ErpSetupContext) {
  // #775 phase B (FR-EXP-118, DD-EXP-22) — `expenses` opens only with #901 (`EXPENSES_EMPLOYABLE`). Until then it
  // is refused before any probe or write, so no org can start posting approvals PMO could not cleanly cancel.
  if (body.domain === "expenses" && !EXPENSES_EMPLOYABLE) {
    throw new AppError(
      "Expense postings are not available yet: they need the ledger mirror update that ships with the next release",
      "config-rejected",
    );
  }
  if (
    typeof body.domain !== "string" ||
    !["companies", "procurement", "revenue", "timesheets", "expenses"].includes(body.domain)
  ) throw new AppError("Choose a supported ERP domain", "BAD_REQUEST");
  const doctypes = [
    ...new Set(sweepKindsForOrg([body.domain]).map((row) => row.doctype)),
  ];
  const failures = await assertErpReadPermissions(ctx.client, { doctypes }, {
    concurrency: 4,
    totalBudgetMs: ACTIVATION_PROBE_TOTAL_BUDGET_MS,
  });
  if (failures.length) {
    throw new AppError(
      "Grant the integration user read access to this domain before employing it",
      "config-rejected",
    );
  }
  const { error } = await ctx.serviceClient.rpc(
    "admin_change_domain_ownership",
    {
      p_org_id: ctx.orgId,
      p_external_tier: "erpnext",
      p_domain: body.domain,
      p_action: "employ",
      p_actor_id: ctx.actorId,
    },
  );
  if (error) throw new AppError(error.message, error.code);
  return { ok: true };
}

const DEFAULT_KEYS = [
  "company",
  "default_payable_account",
  "default_expense_account",
  "default_cash_account",
  "default_bank_account",
  "cost_center",
  "default_receivable_account",
  "default_activity_type",
] as const;
async function readErpSetup(ctx: ErpSetupContext) {
  const read = (table: string, columns: string, active = false) =>
    fetchAllRowsByKeyset<{ id: string; [key: string]: unknown }>(
      (after, limit) => {
        let query = ctx.serviceClient.from(table).select(columns).eq(
          "org_id",
          ctx.orgId,
        ).order("id").limit(limit);
        if (active) query = query.eq("status", "active");
        if (table === "projects") query = query.is("archived_at", null);
        if (after) query = query.gt("id", after);
        return query as never;
      },
    );
  const [ownership, projects, accounts, members, employees] = await Promise.all(
    [
      ctx.serviceClient.from("external_domain_ownership").select("domain").eq(
        "org_id",
        ctx.orgId,
      ).eq("external_tier", "erpnext"),
      read("projects", "id,name,code"),
      read("budget_category_account_map", "id,category,erp_account,is_push_target"),
      read("profiles", "id", true),
      read("erp_employees", "id,profile_id,link_state"),
    ],
  );
  if (ownership.error) {
    throw new AppError(ownership.error.message, ownership.error.code);
  }
  const linkedProfiles = new Set(
    employees.filter((row) => row.link_state === "confirmed").map((row) =>
      row.profile_id
    ),
  );
  const projectMap = (ctx.config.project_map ?? {}) as Record<string, unknown>;
  return {
    defaults: Object.fromEntries(
      DEFAULT_KEYS.map(
        (key) => [
          key,
          typeof ctx.config[key] === "string" && String(ctx.config[key]).trim()
            ? ctx.config[key]
            : null,
        ],
      ),
    ),
    domains: (ownership.data ?? []).map((row) => row.domain).sort(),
    unmappedProjects: projects.filter((row) =>
      typeof projectMap[row.id] !== "string" ||
      !String(projectMap[row.id]).trim()
    ),
    // #768 FR-BAM-009: a category may list several accounts; it is push-ready only when one is its push
    // account, and it counts ONCE however many accounts it lists ("N of 8 configured").
    budgetMappedCategories: [
      ...new Set(
        accounts.filter((row) =>
          row.is_push_target === true &&
          typeof row.erp_account === "string" && row.erp_account.trim()
        ).map((row) => row.category),
      ),
    ],
    unlinkedEmployeeCount:
      members.filter((row) => !linkedProfiles.has(row.id)).length,
  };
}

async function ownProject(body: ErpSetupBody, ctx: ErpSetupContext) {
  if (!body.projectId || typeof body.projectId !== "string") {
    throw new AppError("Choose a PMO project", "BAD_REQUEST");
  }
  const { data, error } = await ctx.serviceClient.from("projects").select(
    "id,name,code",
  ).eq("org_id", ctx.orgId).eq("id", body.projectId).is("archived_at", null)
    .maybeSingle();
  if (error) throw new AppError(error.message, error.code);
  if (!data) throw new AppError("Project is unavailable", "NOT_FOUND");
  return data as { id: string; name: string; code: string | null };
}
async function linkErpProject(body: ErpSetupBody, ctx: ErpSetupContext) {
  const project = await ownProject(body, ctx);
  if (!body.erpProject || typeof body.erpProject !== "string") {
    throw new AppError("Choose an ERPNext Project", "BAD_REQUEST");
  }
  const erpProject = await getDoc(
    ctx.client,
    "Project",
    body.erpProject,
  ) as Record<string, unknown>;
  assertErpProject(erpProject, ctx.company);
  await saveProjectMap(ctx, project.id, erpProject.name as string);
  return { ok: true, erpProject: erpProject.name };
}
function assertErpProject(
  project: Record<string, unknown>,
  company: string,
): void {
  if (
    project.company !== company || project.is_active !== "Yes" ||
    typeof project.name !== "string" || !project.name.trim()
  ) {
    throw new AppError(
      "Choose an active Project for the connected ERPNext Company",
      "config-rejected",
    );
  }
}
/** Conditional writes preserve nested project mappings as well as concurrent scalar settings. */
async function saveProjectMap(
  ctx: ErpSetupContext,
  projectId: string,
  erpProject: string,
) {
  let prior = ctx.config;
  for (let attempt = 0; attempt < 4; attempt++) {
    const map = prior.project_map ?? {};
    if (typeof map !== "object" || map === null || Array.isArray(map)) {
      throw new AppError(
        "ERP project mappings need administrator repair",
        "config-rejected",
      );
    }
    const { data, error } = await ctx.serviceClient.from(
      "external_org_bindings",
    )
      .update({
        config: { ...prior, project_map: { ...map, [projectId]: erpProject } },
      })
      .eq("org_id", ctx.orgId).eq("external_tier", "erpnext").eq(
        "status",
        "active",
      )
      .eq("site_url", ctx.client.baseUrl)
      .eq("config", JSON.stringify(prior)).select("org_id");
    if (error) throw new AppError(error.message, error.code);
    if (data?.length) return;
    const { data: current, error: readError } = await ctx.serviceClient.from(
      "external_org_bindings",
    ).select("config,status,site_url").eq("org_id", ctx.orgId).eq(
      "external_tier",
      "erpnext",
    ).maybeSingle();
    if (readError) throw new AppError(readError.message, readError.code);
    if (
      !current || current.status !== "active" ||
      current.site_url !== ctx.client.baseUrl ||
      current.config?.company !== ctx.company
    ) {
      throw new AppError(
        "The ERP connection changed; reload and try again",
        "config-rejected",
      );
    }
    prior = current.config as Record<string, unknown>;
  }
  throw new AppError(
    "ERP settings changed concurrently; reload and try again",
    "config-rejected",
  );
}

async function ensureErpProject(body: ErpSetupBody, ctx: ErpSetupContext) {
  const project = await ownProject(body, ctx);
  const mapped = (ctx.config.project_map as Record<string, unknown> | undefined)
    ?.[project.id];
  if (typeof mapped === "string" && mapped) {
    const existing = await getDoc(ctx.client, "Project", mapped) as Record<
      string,
      unknown
    >;
    assertErpProject(existing, ctx.company);
    if (existing.name !== mapped) {
      throw new AppError(
        "The ERP Project identity changed; ask an Admin to choose the link",
        "config-rejected",
      );
    }
    return { ok: true, erpProject: mapped };
  }
  const fields = ["name", "project_name", "company", "is_active"];
  const scope: Array<[string, string, string]> = [[
    "company",
    "=",
    ctx.company,
  ]];
  const candidates = await Promise.all([
    project.code
      ? listDocsByFilters(
        ctx.client,
        "Project",
        [...scope, ["name", "=", project.code]],
        fields,
        2,
      )
      : Promise.resolve([]),
    listDocsByFilters(
      ctx.client,
      "Project",
      [...scope, ["project_name", "=", project.name]],
      fields,
      2,
    ),
  ]);
  const matches = [
    ...new Map(candidates.flat().map((row) => [row.name, row])).values(),
  ];
  if (matches.length > 1) {
    throw new AppError(
      "Multiple ERP Projects match; ask an Admin to choose the link",
      "config-rejected",
    );
  }
  // ERPNext requires unique project_name. A retry looks up the landed master before any new POST.
  const target = matches[0] ??
    await createDoc(ctx.client, "Project", {
      project_name: project.name,
      company: ctx.company,
    }) as Record<string, unknown>;
  assertErpProject(target, ctx.company);
  await saveProjectMap(ctx, project.id, target.name as string);
  return { ok: true, erpProject: target.name };
}

async function listErpProjects(body: ErpSetupBody, ctx: ErpSetupContext) {
  const query = typeof body.query === "string"
    ? body.query.trim().slice(0, 120)
    : "";
  const scope: Array<[string, string, string]> = [
    ["company", "=", ctx.company],
    ["is_active", "=", "Yes"],
  ];
  const fields = ["name", "project_name", "company", "is_active"];
  const rows = query
    ? (await Promise.all(
      ["name", "project_name"].map((field) =>
        listDocsByFilters(
          ctx.client,
          "Project",
          [...scope, [field, "like", `%${query}%`]],
          fields,
          100,
        )
      ),
    )).flat()
    : await listDocsByFilters(ctx.client, "Project", scope, fields, 100);
  rows.forEach((row) => assertErpProject(row, ctx.company));
  return {
    projects: [...new Map(rows.map((row) => [row.name, row])).values()],
  };
}

/** #775 phase B (FR-EXP-112, DD-EXP-16) — the ONLY writer of expense_account_map. Reads the account and the company
 *  currency from ERPNext and applies the shared rule; a refusal writes nothing. */
async function saveExpenseAccount(body: ErpSetupBody, ctx: ErpSetupContext) {
  if (!isExpenseAccountKey(body.accountKey)) {
    throw new AppError("Choose an expense account key", "BAD_REQUEST");
  }
  const name = typeof body.erpAccount === "string" ? body.erpAccount.trim() : "";
  if (!name || name.length > 140) {
    throw new AppError("An ERP account is required", "BAD_REQUEST");
  }
  let account: Record<string, unknown> | null = null;
  try {
    account = await getDoc(ctx.client, "Account", name) as Record<string, unknown>;
  } catch (err) {
    if (!(err instanceof ErpError && err.status === 404)) throw err;
  }
  const company = await getDoc(ctx.client, "Company", ctx.company) as Record<string, unknown>;
  const problem = expenseAccountProblem(
    body.accountKey,
    account ? ({ ...account, name } as ErpAccountFacts) : null,
    {
      company: ctx.company,
      companyCurrency: typeof company.default_currency === "string" ? company.default_currency : null,
      defaultPayableAccount: typeof ctx.config.default_payable_account === "string"
        ? ctx.config.default_payable_account
        : null,
    },
  );
  if (problem) throw new AppError(problem, "config-rejected");
  const { error } = await ctx.serviceClient.from("expense_account_map").upsert(
    {
      org_id: ctx.orgId,
      account_key: body.accountKey,
      erp_account: name,
      updated_by: ctx.actorId,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "org_id,account_key" },
  );
  if (error) throw new AppError(error.message, error.code);
  await auditExpenseAccount(ctx, { key: body.accountKey, account: name });
  return { ok: true };
}

async function clearExpenseAccount(body: ErpSetupBody, ctx: ErpSetupContext) {
  if (!isExpenseAccountKey(body.accountKey)) {
    throw new AppError("Choose an expense account key", "BAD_REQUEST");
  }
  const { error } = await ctx.serviceClient.from("expense_account_map").delete()
    .eq("org_id", ctx.orgId).eq("account_key", body.accountKey);
  if (error) throw new AppError(error.message, error.code);
  await auditExpenseAccount(ctx, { key: body.accountKey, account: null });
  return { ok: true };
}

async function auditExpenseAccount(ctx: ErpSetupContext, detail: Record<string, unknown>) {
  const { error } = await ctx.serviceClient.rpc("log_audit", {
    p_action: "integration.expense_account_map",
    p_org_id: ctx.orgId,
    p_actor_id: ctx.actorId,
    p_entity_id: null,
    p_detail: detail,
  });
  if (error) throw new AppError(error.message, error.code);
}
