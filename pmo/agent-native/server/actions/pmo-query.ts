/**
 * pmo_query — the ONE Step-3 action proving PMO domain reads & writes flow
 * through PMO's RLS as the caller, via the deputy caller client.
 *
 * Two operations behind a single discriminated `op` field:
 *   - `list_companies`  (READ)  → caller.from('companies').select(...)
 *   - `create_activity` (WRITE) → caller.from('crm_activities').insert(...)
 *
 * Both go through `createCallerClient(getCallerJwt())` — the anon key + the
 * caller's RAW JWT, so RLS resolves as the caller. NEVER service_role. NEVER
 * agent-native's Drizzle tables. RLS is the enforcement authority; this action
 * just calls and surfaces the result (including cross-tenant `42501` denials —
 * never swallowed, Step 5's gate depends on observing them).
 *
 * `defineAction` shape verified against installed
 * @agent-native/core@0.84.8 dist/action.d.ts (DefineActionWithSchema +
 * ActionRunContext). Zod = v4.4.3 (Standard Schema V1 compatible).
 */
import { defineAction } from "@agent-native/core/action";
import { z } from "zod";
import { ACTIVITY_KINDS, authRequired, dbError } from "../lib/actions-shared";
import { getCallerJwt } from "../lib/deputy-store";
import { createCallerClient } from "../lib/supabase";

// ── Row shapes (mirror the verified PMO public schema) ──────────────────────

interface CompanyRow {
  id: string;
  name: string;
  type: string | null;
  created_at: string;
}

interface CrmActivityRow {
  id: string;
  org_id: string | null;
  contact_id: string;
  company_id: string | null;
  project_id: string | null;
  kind: string;
  subject: string | null;
  body: string | null;
  occurred_at: string | null;
  logged_by_id: string | null;
  created_at: string | null;
}

// ── Zod v4 schema ───────────────────────────────────────────────────────────
// Standard Schema V1 compatible; `defineAction` converts it to JSON Schema for
// the agent tool definition. Discriminated on `op` so the two operations share
// one registered action while keeping exhaustive branch typing.

const pmoQuerySchema = z.discriminatedUnion("op", [
  z.object({
    op: z.literal("list_companies"),
    /**
     * READ — list companies visible to the caller (RLS scopes by org_id).
     * `op: "list_companies"` takes no further args; RLS does the scoping.
     */
  }),
  z.object({
    op: z.literal("create_activity"),
    /** WRITE — create a CRM activity. Mirrors PMO's create_activity A3 contract. */
    contact_id: z
      .string()
      // Postgres `uuid` columns accept any 8-4-4-4-12 hex string — they do NOT
      // enforce RFC-4122 version/variant nibbles. Zod v4's `.uuid()` DOES
      // (regex pins the version nibble to [1-8] and variant to [89ab]), so it
      // rejects the legitimate dev seed fixtures here
      // (e.g. `ce000000-0000-0000-0000-000000000001`, version nibble `0`).
      // Use the looser hex-canoncial shape Postgres itself accepts.
      .regex(
        /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/,
        "Expected a UUID-shaped string (8-4-4-4-12 hex).",
      )
      .describe("Parent contact UUID. org_id is stamped by a BEFORE INSERT trigger from this contact — do NOT send org_id."),
    // M-4: canonical `crm_activity_kind` vocabulary (single source, shared with
    // create_activity's alias map in lib/actions-shared.ts).
    kind: z.enum(ACTIVITY_KINDS).describe("Activity kind (crm_activity_kind enum)."),
    subject: z
      .string()
      .optional()
      .describe("Short subject line for the activity. Optional."),
  }),
]);

export const pmoQueryAction = defineAction({
  description:
    "Read PMO companies or write a PMO CRM activity as the caller. " +
    "All data access flows through PMO's RLS via the deputy caller client " +
    "(anon key + caller JWT). Cross-tenant denials surface as a 42501 error.",
  schema: pmoQuerySchema,
  // Both ops touch PMO data as the caller — the agent loop may call this.
  agentTool: true,
  run: async (args) => {
    // ── 1. Resolve the deputy credential ───────────────────────────────────
    // No raw JWT in ActionRunContext (verified) — read it from the host
    // AsyncLocalStorage populated by server/middleware/deputy.ts.
    const jwt = getCallerJwt();
    if (!jwt) return authRequired();

    // ── 2. Build the deputy client (anon key + caller JWT) ─────────────────
    const caller = createCallerClient(jwt);

    switch (args.op) {
      // ── READ: list companies (RLS scopes to caller's org) ────────────────
      case "list_companies": {
        const { data, error } = await caller
          .from("companies")
          .select("id,name,type,created_at");
        // RLS / Postgres errors surface verbatim — never swallowed. A denial
        // (42501) must be observable by Step 5.
        if (error) return dbError(error, "pmo_query list_companies db error");
        return { rows: (data ?? []) as CompanyRow[] };
      }

      // ── WRITE: create a CRM activity ─────────────────────────────────────
      case "create_activity": {
        // org_id is NOT sent — stamped by a BEFORE INSERT trigger from the
        // parent contact. occurred_at is left to the DB default (now()) —
        // M-4: same as create_activity; the server/DB is the timestamp authority.
        const { data, error } = await caller
          .from("crm_activities")
          .insert({
            contact_id: args.contact_id,
            kind: args.kind,
            ...(args.subject === undefined ? {} : { subject: args.subject }),
          })
          .select()
          .single();
        if (error) {
          // Cross-tenant insert throws Postgres 42501 — surface it (Step 5 gate).
          return dbError(error, "pmo_query create_activity db error");
        }
        return { row: data as CrmActivityRow };
      }
    }
  },
});
