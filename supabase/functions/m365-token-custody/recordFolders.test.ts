// recordFolders.test.ts — served `ensure_record_folder` (ADR-0089, AC-M365DOC-069/071/073). Imports the
// SHIPPED handler from ./index.ts and mocks only globalThis.fetch (PostgREST + Graph boundary). Synthetic
// ids/hosts only.
import { assert, assertEquals, assertFalse, assertStringIncludes } from "@std/assert";
import { FakeTime } from "@std/testing/time";
import {
  CASE_ID,
  caseRow,
  DRIVE,
  emptySearch,
  folderItem,
  gget,
  gpost,
  graphCalls,
  graphError,
  graphSummary,
  makeScenarioRunner,
  newWorld,
  notFound,
  okDrives,
  okRoot,
  PROJECT_ID,
  projectRow,
  READ_SCOPES,
  ROOT,
  rpcBodies,
  SEARCH,
  searchHit,
  settingsRow,
  SITE,
  tableCalls,
  USER,
  webUrl,
} from "./recordFolderTestKit.ts";
import { jsonResponse } from "../_shared/testing/edgeTestKit.ts";

const { handler, setTestJwks } = await import("./index.ts");
const run = makeScenarioRunner(handler, setTestJwks);

const ensureProject = { action: "ensure_record_folder", kind: "project", id: PROJECT_ID };
const ensureCase = { action: "ensure_record_folder", kind: "procurement", id: CASE_ID };
const LINK_ID = "10200000-0000-0000-0000-0000000009aa";

Deno.test("AC-M365DOC-069 served ensure parser accepts exactly {action,kind,id} and refuses everything else before any read", async () => {
  await run(newWorld(), async ({ call, calls }) => {
    for (
      const bad of [
        { ...ensureProject, drive_id: "x" },
        { ...ensureProject, name: "Folder" },
        { ...ensureProject, parent: "x" },
        { ...ensureProject, org_id: "other-org" },
        { ...ensureProject, id: "not-a-uuid" },
        { ...ensureProject, kind: "budget" },
        { action: "ensure_record_folder", kind: "project" },
        [ensureProject],
        "ensure_record_folder",
      ]
    ) {
      const response = await call(bad);
      assertEquals(response.status, 400, JSON.stringify(bad));
      assertEquals((await response.json()).error, "BAD_REQUEST");
    }
    assertEquals(calls.filter((c) => c.url.pathname.startsWith("/rest/v1/") && c.url.pathname !== "/rest/v1/rpc/m365_membership_state").length, 0);
    assertEquals(graphCalls(calls).length, 0);
  });
});

Deno.test("AC-M365DOC-069 served ensure reads the parent and register under the CALLER JWT and refuses non-writers, unreadable and wrong-org parents before Graph", async (t) => {
  await t.step("caller JWT on parent / register / settings reads", async () => {
    await run(newWorld({ documents: [{ id: LINK_ID, ms_linked_at: "2026-01-01T00:00:00Z" }] }), async ({ call, calls, token }) => {
      assertEquals((await call(ensureProject)).status, 200);
      for (const table of ["projects", "project_documents"]) {
        const [read] = tableCalls(calls, table);
        assertEquals(read?.headers.get("authorization"), `Bearer ${token}`, table);
      }
      const [parent] = tableCalls(calls, "projects");
      assertEquals(parent!.url.searchParams.get("select"), "id,org_id,code,name"); // code, never pmo_project_number
    });
  });
  for (const role of ["Engineer", "Viewer", "Operator"]) {
    await t.step(`role ${role} is refused before the parent is read`, async () => {
      await run(newWorld({ role }), async ({ call, calls }) => {
        const response = await call(ensureProject);
        assertEquals(response.status, 403);
        assertEquals(tableCalls(calls, "projects").length, 0);
        assertEquals(graphCalls(calls).length, 0);
      });
    });
  }
  await t.step("unreadable and wrong-org parents get the same safe denial and never reach Graph", async () => {
    for (const parent of [[], [projectRow({ org_id: "other-org" })], [projectRow({ id: "10200000-0000-0000-0000-0000000fffff" })]]) {
      await run(newWorld({ parent }), async ({ call, calls }) => {
        const response = await call(ensureProject);
        assertEquals(response.status, 403);
        const body = await response.json();
        assertEquals(body, { error: "FORBIDDEN", message: "You cannot create a folder for this record." });
        assertEquals(tableCalls(calls, "project_documents").length, 0);
        assertEquals(graphCalls(calls).length, 0);
      });
    }
  });
});

Deno.test("AC-M365DOC-069 a record that already has a folder reference makes NO connection, settings or Graph call", async () => {
  for (const [kind, body, parent, docs] of [
    ["project", ensureProject, [projectRow()], "project_documents"],
    ["procurement", ensureCase, [caseRow()], "procurement_documents"],
  ] as const) {
    await run(newWorld({ parent: [...parent], documents: [{ id: LINK_ID, ms_linked_at: "2026-01-01T00:00:00Z" }] }), async ({ call, calls }) => {
      const response = await call(body);
      assertEquals(response.status, 200);
      assertEquals(await response.json(), { state: "already_linked", document_id: LINK_ID }, kind);
      const read = tableCalls(calls, docs)[0]!.url.searchParams;
      assertEquals(read.get("source"), "eq.onedrive");
      assertEquals(read.get("ms_item_kind"), "eq.folder");
      assertEquals(tableCalls(calls, "ms_graph_connections").length, 0);
      assertEquals(tableCalls(calls, "org_m365_document_settings").length, 0);
      assertEquals(graphCalls(calls).length, 0);
      assertEquals(rpcBodies(calls, "m365_link_record_folder").length, 0);
    });
  }
});

Deno.test("AC-M365DOC-071 settings and identifiers degrade to safe outcomes with no Graph call and the record untouched", async (t) => {
  const outcome = async (world: ReturnType<typeof newWorld>, body = ensureProject) =>
    await run(world, async ({ call, calls }) => {
      const response = await call(body);
      assertEquals(response.status, 200);
      assertEquals(graphCalls(calls).length, 0);
      assertEquals(calls.filter((c) => c.method !== "GET" && !c.url.pathname.includes("/rpc/m365_membership_state")).length, 0);
      return (await response.json()) as Record<string, unknown>;
    });
  await t.step("no settings row / cleared default / settings read denied => default_unset", async () => {
    for (
      const settings of [
        [],
        [settingsRow({ default_site_id: null, default_drive_id: null })],
        [settingsRow({ default_drive_id: "  " })],
        { error: { code: "42501", message: "denied" } },
      ]
    ) assertEquals(await outcome(newWorld({ settings })), { state: "default_unset" });
  });
  await t.step("project without a usable code => missing_identifier", async () => {
    for (const code of [null, "", "   ", "..", "***", "P\u0001-1"]) {
      assertEquals(await outcome(newWorld({ parent: [projectRow({ code })] })), { state: "missing_identifier" }, String(code));
    }
  });
  await t.step("case identity is coalesce(pr_number, code); neither => missing_identifier; bad timestamp too", async () => {
    assertEquals(await outcome(newWorld({ parent: [caseRow({ pr_number: null, code: null })] }), ensureCase), { state: "missing_identifier" });
    assertEquals(await outcome(newWorld({ parent: [caseRow({ pr_number: " ", code: "" })] }), ensureCase), { state: "missing_identifier" });
    assertEquals(await outcome(newWorld({ parent: [caseRow({ created_at: "not-a-date" })] }), ensureCase), { state: "missing_identifier" });
  });
  await t.step("case with a null project still resolves (project is irrelevant to folder identity)", async () => {
    const world = newWorld({ parent: [caseRow({ project_id: null })], settings: [] });
    assertEquals(await outcome(world, ensureCase), { state: "default_unset" });
  });
});

Deno.test("AC-M365DOC-070 ensure requires the stored Sites.Selected consent BEFORE any token refresh or Graph call; reads keep working on old consent", async (t) => {
  await t.step("old read-only consent => SCOPE_INSUFFICIENT, no refresh and no Graph", async () => {
    await run(newWorld({ scopes: READ_SCOPES }), async ({ call, calls }) => {
      const response = await call(ensureProject);
      assertEquals(response.status, 403);
      assertEquals((await response.json()).error, "SCOPE_INSUFFICIENT");
      assertEquals(calls.filter((c) => c.url.host === "login.microsoftonline.com").length, 0);
      assertEquals(graphCalls(calls).length, 0);
    });
  });
  await t.step("the caller's OWN connection row is used (org + user filters)", async () => {
    await run(newWorld({ scopes: READ_SCOPES }), async ({ call, calls }) => {
      await call(ensureProject);
      const query = tableCalls(calls, "ms_graph_connections")[0]!.url.searchParams;
      assertEquals(query.get("org_id"), "eq.synthetic-org");
      assertEquals(query.get("user_id"), `eq.${USER}`);
    });
  });
  for (const status of ["stale", "revoked"] as const) {
    await t.step(`${status} connection keeps the standard envelope`, async () => {
      await run(newWorld({ connectionStatus: status }), async ({ call, calls }) => {
        const response = await call(ensureProject);
        assertEquals((await response.json()).error, status === "stale" ? "CONNECTION_STALE" : "CONNECTION_REVOKED");
        assertEquals(graphCalls(calls).length, 0);
      });
    });
  }
  await t.step("no connection => NOT_CONNECTED", async () => {
    await run(newWorld({ connectionMissing: true }), async ({ call, calls }) => {
      assertEquals((await (await call(ensureProject)).json()).error, "NOT_CONNECTED");
      assertEquals(graphCalls(calls).length, 0);
    });
  });
  for (const scopes of [["Files.Read", "Sites.Selected"], ["Files.Read", "https://graph.microsoft.com/Sites.Selected"]]) {
    await t.step(`bare or Graph-qualified Sites.Selected (${scopes[1]}) is accepted`, async () => {
      await run(newWorld({ scopes, graph: [emptySearch(), gget(`/sites/${SITE}/drives`, () => jsonResponse({ value: [] }))] }), async ({ call }) => {
        const response = await call(ensureProject);
        assert(response.status !== 403 || (await response.json()).error !== "SCOPE_INSUFFICIENT");
      });
    });
  }
});

// ── search / link (A18, A19) ───────────────────────────────────────────────────

const PROJECT_PARENT = "/Projects";
const hit = (id: string, name = "P-100 Synthetic project") => searchHit(id, name, PROJECT_PARENT);
const pageUrl = (skip: string, path = `/drives/${DRIVE}/root/search(q='P-100')`) =>
  `https://graph.microsoft.com/v1.0${encodeURI(path).replace(/'/g, "%27")}?$top=100&$skiptoken=${skip}`;

Deno.test("AC-M365DOC-069 complete-versus-uncertain search: only an exhausted well-formed chain may link or create", async (t) => {
  const linkOnly = (graph: ReturnType<typeof newWorld>["graph"]) => newWorld({ graph });
  await t.step("one unique match links it with ONE caller-RLS RPC carrying the exact reference and settings snapshot", async () => {
    const world = linkOnly([gget(SEARCH, () => jsonResponse({ value: [hit("match-1"), searchHit("other", "P-100 elsewhere", "/Archive"), { id: "f", name: "P-100.pdf", file: {} }] }))]);
    await run(world, async ({ call, calls, token }) => {
      const response = await call(ensureProject);
      assertEquals(await response.json(), { state: "linked", document_id: LINK_ID });
      assertEquals(graphSummary(calls).every((line) => line.startsWith("GET ")), true);
      const [rpc] = rpcBodies(calls, "m365_link_record_folder");
      assertEquals(rpc, {
        p_kind: "project",
        p_record_id: PROJECT_ID,
        p_reference: { drive_id: DRIVE, item_id: "match-1", web_url: webUrl("match-1"), name: "P-100 Synthetic project", item_kind: "folder" },
        p_default_site_id: SITE,
        p_default_drive_id: DRIVE,
        p_settings_updated_at: "2026-10-21T09:00:00.123456+00:00",
      });
      const rpcCall = calls.find((c) => c.url.pathname.endsWith("m365_link_record_folder"))!;
      assertEquals(rpcCall.headers.get("authorization"), `Bearer ${token}`); // caller JWT, not the service key
      assertEquals(rpcBodies(calls, "m365_record_folder_created").length, 0);
      assertEquals(calls.filter((c) => c.method !== "GET" && c.url.host === "graph.microsoft.com").length, 0);
    });
  });
  await t.step("matching is case-insensitive prefix on the SANITIZED code; apostrophes are doubled in the query", async () => {
    await run(newWorld({ parent: [projectRow({ code: "P/9'x" })], graph: [gget(SEARCH, (_c, path) => {
      assertStringIncludes(path, "q='P 9''x'");
      return jsonResponse({ value: [hit("m", "p 9'x lower-case prefix")] });
    })] }), async ({ call }) => {
      assertEquals((await (await call(ensureProject)).json()).state, "linked");
    });
  });
  await t.step("an RPC already_linked winning a race propagates; an RPC error or empty result never becomes success", async () => {
    const graph = [gget(SEARCH, () => jsonResponse({ value: [hit("match-1")] }))];
    await run(newWorld({ graph, link: () => jsonResponse({ document_id: LINK_ID, state: "already_linked" }) }), async ({ call }) => {
      assertEquals(await (await call(ensureProject)).json(), { state: "already_linked", document_id: LINK_ID });
    });
    for (
      const link of [
        () => jsonResponse(null),
        () => jsonResponse({ state: "linked" }),
        () => jsonResponse({ document_id: LINK_ID, state: "weird" }),
        () => jsonResponse({ message: "boom" }, { status: 500 }),
      ]
    ) {
      await run(newWorld({ graph, link }), async ({ call }) => {
        const response = await call(ensureProject);
        assert(response.status >= 400, "failed link must not be a success");
      });
    }
    await run(newWorld({ graph, link: () => jsonResponse({ code: "42501", message: "denied" }, { status: 403 }) }), async ({ call }) => {
      assertEquals((await call(ensureProject)).status, 403);
    });
    await run(newWorld({ graph, link: () => jsonResponse({ code: "23514", message: "m365 default changed", details: "m365-default-changed" }, { status: 400 }) }), async ({ call }) => {
      const response = await call(ensureProject);
      assertEquals(response.status, 502);
      assertStringIncludes((await response.json()).message, "default library changed");
    });
  });
  await t.step("several matches link none and ask for a choice; duplicate hits count once", async () => {
    await run(linkOnly([gget(SEARCH, () => jsonResponse({ value: [hit("a"), hit("b", "P-100 second")] }))]), async ({ call, calls }) => {
      assertEquals(await (await call(ensureProject)).json(), { state: "needs_choice" });
      assertEquals(rpcBodies(calls, "m365_link_record_folder").length, 0);
    });
    await run(linkOnly([gget(SEARCH, () => jsonResponse({ value: [hit("a"), hit("a")] }))]), async ({ call }) => {
      assertEquals((await (await call(ensureProject)).json()).state, "linked");
    });
  });
  await t.step("a unique match on page 1 plus an ambiguous one on page 3 never links early", async () => {
    let page = 0;
    const world = linkOnly([gget(SEARCH, () => {
      page += 1;
      return jsonResponse(page === 1
        ? { value: [hit("a")], "@odata.nextLink": pageUrl("p2") }
        : page === 2
        ? { value: [], "@odata.nextLink": pageUrl("p3") }
        : { value: [hit("b", "P-100 second")] });
    })]);
    await run(world, async ({ call, calls }) => {
      assertEquals(await (await call(ensureProject)).json(), { state: "needs_choice" });
      assertEquals(page, 3);
      assertEquals(rpcBodies(calls, "m365_link_record_folder").length, 0);
    });
  });
  await t.step("uncertain searches (4th page, unsafe or cyclic link, malformed folder, failure) never link or create", async () => {
    const uncertain: Array<[string, ReturnType<typeof newWorld>["graph"]]> = [];
    let n = 0;
    uncertain.push(["fourth page", [gget(SEARCH, () => jsonResponse({ value: [], "@odata.nextLink": pageUrl(`s${(n += 1)}`) }))]]);
    uncertain.push(["foreign host", [gget(SEARCH, () => jsonResponse({ value: [], "@odata.nextLink": "https://evil.invalid/v1.0/x?$top=100" }))]]);
    uncertain.push(["cyclic", [gget(SEARCH, () => jsonResponse({ value: [], "@odata.nextLink": pageUrl("same") }))]]);
    uncertain.push(["folder without a webUrl", [gget(SEARCH, () => jsonResponse({ value: [{ ...hit("a"), webUrl: "javascript:x" }] }))]]);
    uncertain.push(["folder without a path", [gget(SEARCH, () => jsonResponse({ value: [{ id: "a", name: "P-100 x", webUrl: webUrl("a"), folder: {}, parentReference: { driveId: DRIVE } }] }))]]);
    uncertain.push(["non-array value", [gget(SEARCH, () => jsonResponse({ value: "nope" }))]]);
    uncertain.push(["oversized page", [gget(SEARCH, () => jsonResponse({ value: Array.from({ length: 101 }, (_, i) => hit(`x${i}`, `zzz ${i}`)) }))]]);
    uncertain.push(["search refused", [gget(SEARCH, () => graphError(403, "accessDenied"))]]);
    uncertain.push(["search 503", [gget(SEARCH, () => graphError(503, "serviceNotAvailable"))]]);
    for (const [label, graph] of uncertain) {
      await run(newWorld({ graph }), async ({ call, calls }) => {
        const response = await call(ensureProject);
        assertEquals(response.status, 502, label);
        const body = await response.json();
        assertEquals(body.error, "GRAPH_ERROR", label);
        assertFalse(JSON.stringify(body).includes("synthetic upstream text"), label);
        assertEquals(calls.filter((c) => c.method === "POST" && c.url.host === "graph.microsoft.com").length, 0, label);
        assertEquals(rpcBodies(calls, "m365_link_record_folder").length, 0, label);
        assertEquals(rpcBodies(calls, "m365_record_folder_created").length, 0, label);
      });
    }
  });
});

// ── create (A20, A21, A22, A23) ────────────────────────────────────────────────

const created = (id: string, name: string, parentId: string) => new Response(JSON.stringify(folderItem(id, name, parentId)), { status: 201, headers: { "content-type": "application/json" } });
const child = (parent: string, name: string) => `/drives/${DRIVE}/items/${parent}:/${name}`;
const childrenOf = (parent: string) => `/drives/${DRIVE}/items/${parent}/children`;
const postedName = (call: { bodyJson?: unknown }) => (call.bodyJson as { name: string }).name;

Deno.test("AC-M365DOC-069 default drive is bound to the default site and parents are resolved only from server convention segments", async (t) => {
  const base = [emptySearch(), okDrives(), okRoot()];
  await t.step("configured drive in the default site: Projects exists => leaf POST under it", async () => {
    await run(newWorld({ graph: [...base,
      gget(child(ROOT, "Projects"), () => jsonResponse(folderItem("projects-id", "Projects", ROOT))),
      gpost(childrenOf("projects-id"), (c) => created("leaf-id", postedName(c), "projects-id")),
    ] }), async ({ call, calls }) => {
      assertEquals(await (await call(ensureProject)).json(), { state: "created", document_id: LINK_ID });
      assertEquals(graphSummary(calls).filter((l) => l.startsWith("POST ")), [`POST ${childrenOf("projects-id")}`]);
      assertEquals(calls.some((c) => c.url.pathname.includes("/me/drive")), false); // never the caller's OneDrive
    });
  });
  await t.step("foreign configured drive, paginated membership, page cap and missing root all refuse before any write", async () => {
    const cases: Array<[string, ReturnType<typeof newWorld>["graph"]]> = [
      ["foreign drive", [emptySearch(), gget(`/sites/${SITE}/drives`, () => jsonResponse({ value: [{ id: "someone-else" }] }))]],
      ["membership refused", [emptySearch(), gget(`/sites/${SITE}/drives`, () => graphError(403, "accessDenied"))]],
      ["membership cap", [emptySearch(), gget(`/sites/${SITE}/drives`, () => jsonResponse({ value: [], "@odata.nextLink": `https://graph.microsoft.com/v1.0/sites/${encodeURIComponent(SITE)}/drives?$top=100&$skiptoken=${Math.random()}` }))]],
      ["root missing", [emptySearch(), okDrives(), gget(`/drives/${DRIVE}/root`, () => notFound())]],
      ["root in another drive", [emptySearch(), okDrives(), gget(`/drives/${DRIVE}/root`, () => jsonResponse({ id: ROOT, folder: {}, parentReference: { driveId: "other" } }))]],
      ["file named Projects", [...base, gget(child(ROOT, "Projects"), () => jsonResponse({ ...folderItem("projects-id", "Projects", ROOT), folder: undefined, file: {} }))]],
    ];
    for (const [label, graph] of cases) {
      await run(newWorld({ graph }), async ({ call, calls }) => {
        const response = await call(ensureProject);
        assertEquals(response.status, 502, label);
        assertEquals(calls.filter((c) => c.method === "POST" && c.url.host === "graph.microsoft.com").length, 0, label);
        assertEquals(rpcBodies(calls, "m365_record_folder_created").length, 0, label);
      });
    }
  });
  await t.step("a paginated membership list is followed (pinned continuation) and finds the drive on page 2", async () => {
    let page = 0;
    await run(newWorld({ graph: [emptySearch(),
      gget(`/sites/${SITE}/drives`, () => {
        page += 1;
        return jsonResponse(page === 1
          ? { value: [{ id: "other" }], "@odata.nextLink": `https://graph.microsoft.com/v1.0/sites/${encodeURIComponent(SITE)}/drives?$top=100&$skiptoken=s2` }
          : { value: [{ id: DRIVE }] });
      }),
      okRoot(),
      gget(child(ROOT, "Projects"), () => jsonResponse(folderItem("projects-id", "Projects", ROOT))),
      gpost(childrenOf("projects-id"), (c) => created("leaf-id", postedName(c), "projects-id")),
    ] }), async ({ call }) => {
      assertEquals((await (await call(ensureProject)).json()).state, "created");
      assertEquals(page, 2);
    });
  });
  await t.step("a default that changes between search and first write is refused with NO write", async () => {
    let reads = 0;
    const world = newWorld({ graph: [emptySearch(), okDrives(), okRoot()] });
    const original = world.settings;
    Object.defineProperty(world, "settings", { get: () => (reads += 1) >= 2 ? [settingsRow({ updated_at: "2026-10-21T09:30:00+00:00" })] : original });
    await run(world, async ({ call, calls }) => {
      const response = await call(ensureProject);
      assertEquals(response.status, 502);
      assertStringIncludes((await response.json()).message, "default library changed");
      assertEquals(calls.filter((c) => c.method === "POST" && c.url.host === "graph.microsoft.com").length, 0);
    });
  });
});

Deno.test("AC-M365DOC-069 lazy convention ancestors are created parent-first, only when missing, with folder-only bodies", async (t) => {
  const leafName = "P-100 Synthetic project";
  await t.step("missing Projects => Projects then leaf; each 201 is audited once, existing ancestors are not", async () => {
    await run(newWorld({ graph: [emptySearch(), okDrives(), okRoot(),
      gget(child(ROOT, "Projects"), () => notFound()),
      gpost(childrenOf(ROOT), (c) => created("projects-id", postedName(c), ROOT)),
      gpost(childrenOf("projects-id"), (c) => created("leaf-id", postedName(c), "projects-id")),
    ] }), async ({ call, calls }) => {
      assertEquals((await (await call(ensureProject)).json()).state, "created");
      const posts = graphCalls(calls).filter((c) => c.method === "POST");
      assertEquals(posts.map((c) => c.bodyJson), [
        { name: "Projects", folder: {}, "@microsoft.graph.conflictBehavior": "fail" },
        { name: leafName, folder: {}, "@microsoft.graph.conflictBehavior": "fail" },
      ]);
      assertEquals(rpcBodies(calls, "m365_record_folder_created"), [
        { p_actor_id: USER, p_kind: "project", p_record_id: PROJECT_ID, p_drive_id: DRIVE, p_item_id: "projects-id" },
        { p_actor_id: USER, p_kind: "project", p_record_id: PROJECT_ID, p_drive_id: DRIVE, p_item_id: "leaf-id" },
      ]);
    });
  });
  await t.step("procurement: missing Procurement and missing UTC year; year follows created_at in UTC", async () => {
    await run(newWorld({ parent: [caseRow({ created_at: "2025-12-31T23:30:00-05:00" })], graph: [emptySearch(), okDrives(), okRoot(),
      gget(child(ROOT, "Procurement"), () => notFound()),
      gpost(childrenOf(ROOT), (c) => created("proc-id", postedName(c), ROOT)),
      gget(child("proc-id", "2026"), () => notFound()),
      gpost(childrenOf("proc-id"), (c) => created(postedName(c) === "2026" ? "year-id" : "leaf-id", postedName(c), "proc-id")),
      gpost(childrenOf("year-id"), (c) => created("leaf-id", postedName(c), "year-id")),
    ] }), async ({ call, calls }) => {
      const body = await (await call(ensureCase)).json();
      assertEquals(body.state, "created");
      assertEquals(graphCalls(calls).filter((c) => c.method === "POST").map((c) => postedName(c)), ["Procurement", "2026", "PR-0042 Synthetic case"]);
      assertEquals(rpcBodies(calls, "m365_record_folder_created").length, 3);
      const search = graphCalls(calls).find((c) => SEARCH.test(c.url.pathname === "" ? "" : decodeURIComponent(c.url.pathname).replace(/^\/v1\.0/, "")))!;
      assertStringIncludes(decodeURIComponent(search.url.pathname), "q='PR-0042'"); // pr_number, not code
    });
  });
  await t.step("all ancestors present => only the leaf POST and one receipt", async () => {
    await run(newWorld({ graph: [emptySearch(), okDrives(), okRoot(),
      gget(child(ROOT, "Projects"), () => jsonResponse(folderItem("projects-id", "Projects", ROOT))),
      gpost(childrenOf("projects-id"), (c) => created("leaf-id", postedName(c), "projects-id")),
    ] }), async ({ call, calls }) => {
      await call(ensureProject);
      assertEquals(rpcBodies(calls, "m365_record_folder_created").length, 1);
      assertEquals(graphCalls(calls).filter((c) => c.method === "POST").length, 1);
    });
  });
});

Deno.test("AC-M365DOC-069 race-safe leaf creation: one 409 re-read, never a second POST, rename or suffix", async (t) => {
  const prelude = [emptySearch(), okDrives(), okRoot(), gget(child(ROOT, "Projects"), () => jsonResponse(folderItem("projects-id", "Projects", ROOT)))];
  const leaf = child("projects-id", "P-100 Synthetic project");
  await t.step("409 nameAlreadyExists on the leaf => exact-path read => linked, NOT created, no receipt", async () => {
    await run(newWorld({ graph: [...prelude,
      gpost(childrenOf("projects-id"), () => graphError(409, "nameAlreadyExists")),
      gget(leaf, () => jsonResponse(folderItem("winner-id", "P-100 Synthetic project", "projects-id"))),
    ] }), async ({ call, calls }) => {
      assertEquals(await (await call(ensureProject)).json(), { state: "linked", document_id: LINK_ID });
      assertEquals(graphCalls(calls).filter((c) => c.method === "POST").length, 1);
      assertEquals(rpcBodies(calls, "m365_record_folder_created").length, 0);
      assertEquals((rpcBodies(calls, "m365_link_record_folder")[0]!.p_reference as { item_id: string }).item_id, "winner-id");
    });
  });
  await t.step("409 on a convention ancestor reuses the winner exactly once", async () => {
    await run(newWorld({ graph: [emptySearch(), okDrives(), okRoot(),
      gget(child(ROOT, "Projects"), (() => { let n = 0; return () => (n += 1) === 1 ? notFound() : jsonResponse(folderItem("projects-id", "Projects", ROOT)); })()),
      gpost(childrenOf(ROOT), () => graphError(409, "nameAlreadyExists")),
      gpost(childrenOf("projects-id"), (c) => created("leaf-id", postedName(c), "projects-id")),
    ] }), async ({ call, calls }) => {
      assertEquals((await (await call(ensureProject)).json()).state, "created");
      assertEquals(graphCalls(calls).filter((c) => c.method === "POST" && c.url.pathname.endsWith(`${ROOT}/children`)).length, 1);
    });
  });
  const refusals: Array<[string, ReturnType<typeof newWorld>["graph"]]> = [
    ["409 with another code", [...prelude, gpost(childrenOf("projects-id"), () => graphError(409, "resourceLocked"))]],
    ["404 after the conflict", [...prelude, gpost(childrenOf("projects-id"), () => graphError(409, "nameAlreadyExists")), gget(leaf, () => notFound())]],
    ["a file wins the name", [...prelude, gpost(childrenOf("projects-id"), () => graphError(409, "nameAlreadyExists")), gget(leaf, () => jsonResponse({ id: "f", name: "P-100 Synthetic project", webUrl: webUrl("f"), file: {}, parentReference: { driveId: DRIVE, id: "projects-id" } }))]],
    ["winner in another drive", [...prelude, gpost(childrenOf("projects-id"), () => graphError(409, "nameAlreadyExists")), gget(leaf, () => jsonResponse(folderItem("w", "P-100 Synthetic project", "projects-id", { parentReference: { driveId: "other", id: "projects-id" } })))]],
    ["winner under another parent", [...prelude, gpost(childrenOf("projects-id"), () => graphError(409, "nameAlreadyExists")), gget(leaf, () => jsonResponse(folderItem("w", "P-100 Synthetic project", "elsewhere")))]],
    ["winner with another name", [...prelude, gpost(childrenOf("projects-id"), () => graphError(409, "nameAlreadyExists")), gget(leaf, () => jsonResponse(folderItem("w", "Something else", "projects-id")))]],
  ];
  for (const [label, graph] of refusals) {
    await t.step(`refused: ${label}`, async () => {
      await run(newWorld({ graph }), async ({ call, calls }) => {
        const response = await call(ensureProject);
        assertEquals(response.status, 502, label);
        assertEquals(graphCalls(calls).filter((c) => c.method === "POST").length, 1, label);
        assertEquals(rpcBodies(calls, "m365_link_record_folder").length, 0, label);
      });
    });
  }
  await t.step("a created leaf with an invalid result is refused and never audited or linked", async () => {
    await run(newWorld({ graph: [...prelude, gpost(childrenOf("projects-id"), () => new Response(JSON.stringify({ id: "x" }), { status: 201 }))] }), async ({ call, calls }) => {
      assertEquals((await call(ensureProject)).status, 502);
      assertEquals(rpcBodies(calls, "m365_record_folder_created").length, 0);
      assertEquals(rpcBodies(calls, "m365_link_record_folder").length, 0);
    });
  });
  await t.step("a later invocation after the PMO record was renamed makes zero Microsoft calls", async () => {
    await run(newWorld({ parent: [projectRow({ name: "Renamed" })], documents: [{ id: LINK_ID, ms_linked_at: "2026-10-21T00:00:00Z" }] }), async ({ call, calls }) => {
      assertEquals((await (await call(ensureProject)).json()).state, "already_linked");
      assertEquals(graphCalls(calls).length, 0);
    });
  });
});

Deno.test("AC-M365DOC-073 every confirmed 201 is audited before continuing; 409, matches and failures never are", async (t) => {
  const prelude = [emptySearch(), okDrives(), okRoot(), gget(child(ROOT, "Projects"), () => jsonResponse(folderItem("projects-id", "Projects", ROOT)))];
  await t.step("audit RPC failure stops before the link and keeps the 201 as a safe failure", async () => {
    await run(newWorld({
      graph: [...prelude, gpost(childrenOf("projects-id"), (c) => created("leaf-id", postedName(c), "projects-id"))],
      created: () => jsonResponse({ message: "boom" }, { status: 500 }),
    }), async ({ call, calls }) => {
      const response = await call(ensureProject);
      assertEquals(response.status, 502);
      assertStringIncludes((await response.json()).message, "could not be recorded");
      assertEquals(rpcBodies(calls, "m365_record_folder_created").length, 1);
      assertEquals(rpcBodies(calls, "m365_link_record_folder").length, 0);
      assertEquals(calls.filter((c) => c.method === "DELETE").length, 0);
    });
  });
  await t.step("a link failure AFTER the receipt keeps the receipt and never deletes anything in Graph", async () => {
    await run(newWorld({
      graph: [...prelude, gpost(childrenOf("projects-id"), (c) => created("leaf-id", postedName(c), "projects-id"))],
      link: () => jsonResponse({ code: "23514", message: "m365 default changed", details: "m365-default-changed" }, { status: 400 }),
    }), async ({ call, calls }) => {
      assertEquals((await call(ensureProject)).status, 502);
      assertEquals(rpcBodies(calls, "m365_record_folder_created").length, 1);
      assertEquals(calls.filter((c) => c.method === "DELETE" || c.method === "PATCH").length, 0);
    });
  });
  await t.step("Graph 403 / network failure on create => no receipt", async () => {
    for (const failing of [() => graphError(403, "accessDenied"), () => { throw new Error("socket closed"); }]) {
      await run(newWorld({ graph: [...prelude, gpost(childrenOf("projects-id"), failing)] }), async ({ call, calls }) => {
        const response = await call(ensureProject);
        assert(response.status >= 400);
        assertEquals(rpcBodies(calls, "m365_record_folder_created").length, 0);
      });
    }
  });
});

Deno.test("AC-M365DOC-071 failure table: stable codes, generic denial, rate limit, spent budget and a changed default never leak or compensate", async (t) => {
  const prelude = [emptySearch(), okDrives(), okRoot(), gget(child(ROOT, "Projects"), () => jsonResponse(folderItem("projects-id", "Projects", ROOT)))];
  const assertSafe = async (response: Response, label: string, calls: { method: string; url: URL }[]) => {
    const body = await response.json();
    assertEquals(Object.keys(body).sort(), ["error", "message"], label);
    assertFalse(JSON.stringify(body).includes("synthetic"), label);
    assertEquals(calls.filter((c) => ["DELETE", "PATCH", "PUT"].includes(c.method)).length, 0, label);
    return body;
  };
  await t.step("Graph 403 on create => FORBIDDEN, 429 / 503 => GRAPH_ERROR, no second POST", async () => {
    for (const [status, code, expected] of [[403, "accessDenied", "FORBIDDEN"], [429, "activityLimitReached", "GRAPH_ERROR"], [503, "serviceNotAvailable", "GRAPH_ERROR"]] as const) {
      await run(newWorld({ graph: [...prelude, gpost(childrenOf("projects-id"), () => graphError(status, code))] }), async ({ call, calls }) => {
        const response = await call(ensureProject);
        const body = await assertSafe(response, String(status), calls);
        assertEquals(body.error, expected);
        assertEquals(graphCalls(calls).filter((c) => c.method === "POST").length, 1);
      });
    }
  });
  await t.step("stale / revoked / scope envelopes are the standard ones", async () => {
    await run(newWorld({ connectionStatus: "revoked" }), async ({ call, calls }) => {
      const body = await assertSafe(await call(ensureProject), "revoked", calls);
      assertEquals(body.error, "CONNECTION_REVOKED");
    });
  });
  await t.step("the 15 second Graph budget is shared: a spent budget refuses further Graph work", async () => {
    const time = new FakeTime();
    try {
      await run(newWorld({ graph: [
        gget(SEARCH, () => { time.tick(16_000); return jsonResponse({ value: [] }); }),
        okDrives(), okRoot(),
      ] }), async ({ call, calls }) => {
        const response = await call(ensureProject);
        assertEquals(response.status, 502);
        assertEquals(graphCalls(calls).length, 1); // the membership read was refused without a fetch
        assertEquals(graphCalls(calls).filter((c) => c.method === "POST").length, 0);
      });
    } finally {
      time.restore();
    }
  });
  await t.step("a hung Graph call is aborted at min(5s, remaining) and is a failure, never absence", async () => {
    const time = new FakeTime();
    try {
      await run(newWorld({ graph: [
        gget(SEARCH, (call) => new Promise<Response>((_resolve, reject) => call.signal.addEventListener("abort", () => reject(new Error("aborted"))))),
      ] }), async ({ call, calls }) => {
        let settled = false;
        const pending = call(ensureProject).finally(() => (settled = true));
        for (let i = 0; i < 60 && !settled; i += 1) await time.tickAsync(250);
        const response = await pending;
        assertEquals(response.status, 502);
        assertEquals(graphCalls(calls).filter((c) => c.method === "POST").length, 0);
      });
    } finally {
      time.restore();
    }
  });
});

Deno.test("AC-M365DOC-069 served ensure links, creates or requests choice idempotently", async (t) => {
  // Canonical AC-M365DOC-069 table: zero / one / two matches, an existing reference, a missing year
  // folder and a name with rejected characters, all through the shipped handler.
  await t.step("zero matches creates the sanitized <code> <name> under the convention path", async () => {
    await run(newWorld({ parent: [projectRow({ code: "P:7", name: 'Tank "A"/B*' })], graph: [emptySearch(), okDrives(), okRoot(),
      gget(child(ROOT, "Projects"), () => jsonResponse(folderItem("projects-id", "Projects", ROOT))),
      gpost(childrenOf("projects-id"), (c) => created("leaf-id", postedName(c), "projects-id")),
    ] }), async ({ call, calls }) => {
      assertEquals((await (await call(ensureProject)).json()).state, "created");
      assertEquals(postedName(graphCalls(calls).find((c) => c.method === "POST")!), "P 7 Tank  A  B");
    });
  });
  await t.step("one match links without any write; two matches link none", async () => {
    await run(newWorld({ graph: [gget(SEARCH, () => jsonResponse({ value: [hit("only")] }))] }), async ({ call, calls }) => {
      assertEquals((await (await call(ensureProject)).json()).state, "linked");
      assertEquals(graphCalls(calls).filter((c) => c.method !== "GET").length, 0);
    });
    await run(newWorld({ graph: [gget(SEARCH, () => jsonResponse({ value: [hit("a"), hit("b", "P-100 b")] }))] }), async ({ call }) => {
      assertEquals((await (await call(ensureProject)).json()).state, "needs_choice");
    });
  });
  await t.step("an existing reference makes no call; a repeat is idempotent", async () => {
    await run(newWorld({ documents: [{ id: LINK_ID, ms_linked_at: "x" }] }), async ({ call, calls }) => {
      for (let i = 0; i < 2; i += 1) assertEquals((await (await call(ensureProject)).json()).state, "already_linked");
      assertEquals(graphCalls(calls).length, 0);
    });
  });
  await t.step("a missing year folder is created first", async () => {
    await run(newWorld({ parent: [caseRow()], graph: [emptySearch(), okDrives(), okRoot(),
      gget(child(ROOT, "Procurement"), () => jsonResponse(folderItem("proc-id", "Procurement", ROOT))),
      gget(child("proc-id", "2026"), () => notFound()),
      gpost(childrenOf("proc-id"), (c) => created("year-id", postedName(c), "proc-id")),
      gpost(childrenOf("year-id"), (c) => created("leaf-id", postedName(c), "year-id")),
    ] }), async ({ call, calls }) => {
      assertEquals((await (await call(ensureCase)).json()).state, "created");
      assertEquals(graphCalls(calls).filter((c) => c.method === "POST").map((c) => postedName(c)), ["2026", "PR-0042 Synthetic case"]);
    });
  });
});

Deno.test("AC-M365DOC-069 backend invariants: only the signed Microsoft calls, no content/storage/permission/descendant calls, no direct register or audit writes, no raw data in the result", async () => {
  await run(newWorld({ graph: [emptySearch(), okDrives(), okRoot(),
    gget(child(ROOT, "Projects"), () => notFound()),
    gpost(childrenOf(ROOT), (c) => created("projects-id", postedName(c), ROOT)),
    gpost(childrenOf("projects-id"), (c) => created("leaf-id", postedName(c), "projects-id")),
  ] }), async ({ call, calls }) => {
    const response = await call(ensureProject);
    const body = await response.json();
    assertEquals(Object.keys(body).sort(), ["document_id", "state"]);
    for (const line of graphSummary(calls)) {
      assertFalse(/\/(content|versions|preview|permissions|invite|createLink|copy)/u.test(line), line);
      assertFalse(line.startsWith("GET ") && line.endsWith("/children"), `no descendant enumeration: ${line}`);
    }
    assertEquals(graphSummary(calls).filter((l) => l.startsWith("POST ")).length, 2); // Projects + leaf only
    assertEquals(calls.filter((c) => c.url.pathname.startsWith("/storage/")).length, 0);
    // Postgres is only reached by reads and the three named RPCs: never a direct register / audit write.
    const restWrites = calls.filter((c) => c.url.pathname.startsWith("/rest/v1/") && !c.url.pathname.startsWith("/rest/v1/rpc/") && c.method !== "GET");
    assert(restWrites.every((c) => c.url.pathname === "/rest/v1/error_events"), "only observability rows may be written directly");
    const rpcs = new Set(calls.filter((c) => c.url.pathname.startsWith("/rest/v1/rpc/")).map((c) => c.url.pathname.split("/").pop()));
    assertEquals([...rpcs].sort(), ["m365_link_record_folder", "m365_membership_state", "m365_record_folder_created"]);
    // Only the folder's own bodies carry a name; nothing else Microsoft-bound has a body.
    assertEquals(graphCalls(calls).filter((c) => c.method === "GET" && c.bodyText).length, 0);
  });
});
