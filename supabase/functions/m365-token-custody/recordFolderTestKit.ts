// recordFolderTestKit.ts — shared SYNTHETIC fixtures for the record-folder served-handler tests.
// It contains no production logic: tests import the shipped `handler` from ./index.ts themselves and this
// kit only supplies the mocked PostgREST / Graph boundary (globalThis.fetch) and a synthetic connection.

import { createClient } from "@supabase/supabase-js";
import { encryptToken, serializeEnvelope } from "./crypto.ts";
import type { HandlerDeps } from "./types.ts";
import {
  createJwtAuthority,
  createTestJwksResolver,
  type FetchCall,
  type FetchMockContext,
  jsonResponse,
  type MockRoute,
  withFetchMock,
} from "../_shared/testing/edgeTestKit.ts";

export const SUPABASE_URL = "https://edge-test.supabase.test";
export const ORG = "synthetic-org";
export const USER = "synthetic-folder-user";
export const SITE = "synthetic.example.invalid,site-guid,web-guid";
export const DRIVE = "synthetic-drive";
export const ROOT = "synthetic-root-id";
export const PROJECT_ID = "10200000-0000-0000-0000-000000000201";
export const CASE_ID = "10200000-0000-0000-0000-000000000401";
export const SETTINGS_STAMP = "2026-10-21T09:00:00.123456+00:00";
export const FULL_SCOPES = ["Files.Read", "Files.Read.All", "Sites.Read.All", "Sites.Selected", "offline_access"];
export const READ_SCOPES = ["Files.Read", "Files.Read.All", "Sites.Read.All", "offline_access"];

export type GraphRoute = {
  method: string;
  match: string | RegExp;
  respond: (call: FetchCall, path: string) => Response | Promise<Response>;
};
export const gget = (match: string | RegExp, respond: GraphRoute["respond"]): GraphRoute => ({ method: "GET", match, respond });
export const gpost = (match: string | RegExp, respond: GraphRoute["respond"]): GraphRoute => ({ method: "POST", match, respond });

export interface World {
  role: string;
  /** Rows returned for the caller-RLS parent read (projects / procurements). */
  parent: unknown[] | ((call: FetchCall) => unknown[]);
  parentError?: unknown;
  /** Rows returned for the folder register read. */
  documents: unknown[] | ((call: FetchCall) => unknown[]);
  settings: unknown[] | { error: { code: string; message: string } };
  scopes: string[];
  connectionStatus: "active" | "stale" | "revoked";
  connectionMissing: boolean;
  graph: GraphRoute[];
  link: (call: FetchCall) => Response;
  created: (call: FetchCall) => Response;
  candidates: (call: FetchCall) => Response;
  /** `rate_limit_hit` answer: true = under the limit. */
  rate: (call: FetchCall) => Response;
  /** Make the stored access token already expired so the first Graph call refreshes it. */
  accessExpired: boolean;
  /** Microsoft token endpoint (refresh). */
  refresh: (call: FetchCall) => Response | Promise<Response>;
}

export const projectRow = (over: Record<string, unknown> = {}) => ({
  id: PROJECT_ID, org_id: ORG, code: "P-100", name: "Synthetic project", ...over,
});
export const caseRow = (over: Record<string, unknown> = {}) => ({
  id: CASE_ID, org_id: ORG, code: "IMP-7", pr_number: "PR-0042", title: "Synthetic case",
  created_at: "2026-03-05T10:00:00Z", ...over,
});
export const settingsRow = (over: Record<string, unknown> = {}) => ({
  default_site_id: SITE, default_drive_id: DRIVE, updated_at: SETTINGS_STAMP, ...over,
});

export function newWorld(over: Partial<World> = {}): World {
  return {
    role: "Project Manager",
    parent: [projectRow()],
    documents: [],
    settings: [settingsRow()],
    scopes: FULL_SCOPES,
    connectionStatus: "active",
    connectionMissing: false,
    graph: [],
    link: () => jsonResponse({ document_id: "10200000-0000-0000-0000-0000000009aa", state: "linked" }),
    created: () => new Response(null, { status: 204 }),
    candidates: () => jsonResponse([]),
    rate: () => jsonResponse(true),
    accessExpired: false,
    refresh: () => jsonResponse({ access_token: "synthetic-refreshed", refresh_token: "synthetic-rotated", expires_in: 3600 }),
    ...over,
  };
}

const OBJECT_HEADERS = { headers: { "content-type": "application/vnd.pgrst.object+json" } };
const KEK_BYTES = new Uint8Array(32).fill(7);
const b64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes)).replace(/=/g, "").replaceAll("+", "-").replaceAll("/", "_");

async function connectionRow(world: World) {
  const encrypted = await encryptToken("synthetic-access-token", KEK_BYTES);
  const hex = Array.from(serializeEnvelope(encrypted.iv, encrypted.ciphertext), (b) => b.toString(16).padStart(2, "0")).join("");
  const refresh = await encryptToken("synthetic-refresh-token", KEK_BYTES);
  const refreshHex = Array.from(serializeEnvelope(refresh.iv, refresh.ciphertext), (b) => b.toString(16).padStart(2, "0")).join("");
  return {
    id: "synthetic-connection", org_id: ORG, user_id: USER, entra_tenant_id: "synthetic-tenant",
    entra_user_object_id: null, scopes: world.scopes, refresh_token_ciphertext: `\\x${refreshHex}`,
    access_token_ciphertext: `\\x${hex}`, access_token_expires_at: new Date(Date.now() + (world.accessExpired ? -1_000 : 3_600_000)).toISOString(),
    refresh_token_expires_at: null, key_id: "kek-v1", status: world.connectionStatus,
    connected_at: new Date().toISOString(), last_refresh_at: null, updated_at: new Date().toISOString(),
  };
}

export function graphPath(call: FetchCall): string {
  return decodeURIComponent(call.url.pathname).replace(/^\/v1\.0/, "");
}
export const graphCalls = (calls: FetchCall[]) => calls.filter((call) => call.url.host === "graph.microsoft.com");
export const graphSummary = (calls: FetchCall[]) => graphCalls(calls).map((call) => `${call.method} ${graphPath(call)}`);
export const rpcBodies = (calls: FetchCall[], fn: string) =>
  calls.filter((call) => call.url.pathname === `/rest/v1/rpc/${fn}`).map((call) => call.bodyJson as Record<string, unknown>);
export const tableCalls = (calls: FetchCall[], table: string) => calls.filter((call) => call.url.pathname === `/rest/v1/${table}`);

function routesFor(world: World, connection: Record<string, unknown>): MockRoute[] {
  const table = (name: string, responder: (call: FetchCall) => Response): MockRoute => ({
    label: name, method: "GET", pathname: `/rest/v1/${name}`, response: responder,
  });
  const rows = (data: unknown[]) => jsonResponse(data);
  const parentRows = (call: FetchCall) => rows(typeof world.parent === "function" ? world.parent(call) : world.parent);
  const documentRows = (call: FetchCall) => rows(typeof world.documents === "function" ? world.documents(call) : world.documents);
  return [
    { label: "membership", pathname: "/rest/v1/rpc/m365_membership_state", response: () => jsonResponse({ state: "active", org_id: ORG, role: world.role }) },
    table("org_features", () => jsonResponse({ enabled: true }, OBJECT_HEADERS)),
    table("projects", (call) => world.parentError ? jsonResponse(world.parentError, { status: 500 }) : parentRows(call)),
    table("procurements", (call) => world.parentError ? jsonResponse(world.parentError, { status: 500 }) : parentRows(call)),
    table("project_documents", documentRows),
    table("procurement_documents", documentRows),
    table("org_m365_document_settings", () => {
      const settings = world.settings;
      return Array.isArray(settings) ? rows(settings) : jsonResponse(settings.error, { status: 403 });
    }),
    table("ms_graph_connections", () =>
      world.connectionMissing
        ? jsonResponse({ message: "none" }, { status: 406 })
        : jsonResponse(connection, OBJECT_HEADERS)),
    { label: "link", pathname: "/rest/v1/rpc/m365_link_record_folder", response: (call) => world.link(call) },
    { label: "created", pathname: "/rest/v1/rpc/m365_record_folder_created", response: (call) => world.created(call) },
    { label: "candidates", pathname: "/rest/v1/rpc/m365_record_folder_candidates", response: (call) => world.candidates(call) },
    { label: "pkce-state", method: "POST", pathname: "/rest/v1/m365_pkce_states", response: () => new Response(null, { status: 201 }) },
    { label: "rate", pathname: "/rest/v1/rpc/rate_limit_hit", response: (call) => world.rate(call) },
    { label: "token", host: "login.microsoftonline.com", response: (call) => world.refresh(call) },
    { label: "error-events", method: "POST", pathname: "/rest/v1/error_events", response: () => new Response(null, { status: 201 }) },
    {
      label: "graph", host: "graph.microsoft.com",
      response: async (call) => {
        const path = graphPath(call);
        const route = world.graph.find((r) => r.method === call.method && (typeof r.match === "string" ? r.match === path : r.match.test(path)));
        if (!route) throw new Error(`Unexpected Graph call: ${call.method} ${path}`);
        return await route.respond(call, path);
      },
    },
  ];
}

const ENV_NAMES = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_ANON_KEY", "M365_TOKEN_KEK"] as const;
let authority: Awaited<ReturnType<typeof createJwtAuthority>> | null = null;

export interface Scenario extends FetchMockContext {
  /** POST the body to the shipped handler as the synthetic user. */
  call(body: unknown): Promise<Response>;
  token: string;
  /** Real supabase-js clients (fetch mocked) for exercising the narrow production adapter directly. */
  deps: HandlerDeps;
}

export function makeScenarioRunner(
  handler: (req: Request) => Promise<Response>,
  setTestJwks: (resolver: ReturnType<typeof createTestJwksResolver>) => void,
) {
  return async function run<T>(world: World, fn: (scenario: Scenario) => Promise<T>): Promise<T> {
    authority ??= await createJwtAuthority(SUPABASE_URL);
    const token = await authority.mintJwt({ sub: USER });
    setTestJwks(createTestJwksResolver(authority));
    const previous = Object.fromEntries(ENV_NAMES.map((name) => [name, Deno.env.get(name)]));
    Deno.env.set("SUPABASE_URL", SUPABASE_URL);
    Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "synthetic-service-key");
    Deno.env.set("SUPABASE_ANON_KEY", "synthetic-anon-key");
    Deno.env.set("M365_TOKEN_KEK", b64url(KEK_BYTES));
    try {
      const connection = await connectionRow(world);
      return await withFetchMock(routesFor(world, connection), (ctx) =>
        fn({
          ...ctx,
          token,
          deps: {
            env: {
              m365TenantId: "synthetic-tenant", m365ClientId: "synthetic-client", m365ClientSecret: "synthetic-secret",
              m365RedirectUri: "https://example.invalid/callback", m365TokenKek: b64url(KEK_BYTES),
              supabaseUrl: SUPABASE_URL, jwtIssuer: `${SUPABASE_URL}/auth/v1`, siteUrl: "https://example.invalid",
              allowedOrigin: "https://example.invalid",
            },
            serviceClient: createClient(SUPABASE_URL, "synthetic-service-key", { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } }) as never,
            callerClient: createClient(SUPABASE_URL, "synthetic-anon-key", { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }, global: { headers: { Authorization: `Bearer ${token}` } } }) as never,
            userId: USER,
          },
          call: (body) =>
            handler(new Request("http://edge.test/m365-token-custody", {
              method: "POST",
              headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
              body: JSON.stringify(body),
            })),
        }));
    } finally {
      for (const name of ENV_NAMES) {
        const value = previous[name];
        if (value === undefined) Deno.env.delete(name);
        else Deno.env.set(name, value);
      }
    }
  };
}

// ── Graph item factories ──────────────────────────────────────────────────────

export const webUrl = (id: string) => `https://example.invalid/sites/synthetic/${id}`;
export function folderItem(id: string, name: string, parentId: string, over: Record<string, unknown> = {}) {
  return {
    id, name, webUrl: webUrl(id), folder: { childCount: 0 },
    parentReference: { driveId: DRIVE, id: parentId, path: `/drives/${DRIVE}/root:` },
    ...over,
  };
}
export const graphError = (status: number, code: string, headers: Record<string, string> = {}) =>
  jsonResponse({ error: { code, message: "synthetic upstream text" } }, { status, headers });
export const notFound = () => graphError(404, "itemNotFound");
export const SITE_DRIVES = `/sites/${SITE}/drives`;
export const okDrives = () => gget(SITE_DRIVES, () => jsonResponse({ value: [{ id: DRIVE }] }));
export const okRoot = () => gget(`/drives/${DRIVE}/root`, () => jsonResponse({ id: ROOT, folder: { childCount: 1 }, parentReference: { driveId: DRIVE } }));

// ── convention-parent discovery (children listing of the convention parent, never a drive-wide search) ──
export const PROJECTS_ID = "projects-id";
export const child = (parent: string, name: string) => `/drives/${DRIVE}/items/${parent}:/${name}`;
export const childrenOf = (parent: string) => `/drives/${DRIVE}/items/${parent}/children`;
export const projectsFolder = () => gget(child(ROOT, "Projects"), () => jsonResponse(folderItem(PROJECTS_ID, "Projects", ROOT)));
/** Root + Projects + a listing of Projects answered by `respond`. */
export const discoverProjects = (respond: GraphRoute["respond"]): GraphRoute[] => [okRoot(), projectsFolder(), gget(childrenOf(PROJECTS_ID), respond)];
/** A listing of Projects with no children (root and Projects themselves are supplied by the test). */
export const emptyListing = () => gget(childrenOf(PROJECTS_ID), () => jsonResponse({ value: [] }));
export const emptyDiscovery = (): GraphRoute[] => discoverProjects(() => jsonResponse({ value: [] }));
