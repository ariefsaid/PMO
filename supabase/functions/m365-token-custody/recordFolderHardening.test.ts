// recordFolderHardening.test.ts — served ensure hardening (ADR-0089): convention-parent discovery at scale,
// shared-folder refusal, one wall-clock deadline, creation receipts, rate limits, name edge cases and the
// safe Retry-After hint. Imports the SHIPPED handler from ./index.ts; mocks only globalThis.fetch.
import { assert, assertEquals, assertFalse, assertStringIncludes } from "@std/assert";
import { FakeTime } from "@std/testing/time";
import {
  CASE_ID,
  caseRow,
  child,
  childrenOf,
  DRIVE,
  discoverProjects,
  emptyDiscovery,
  folderItem,
  gget,
  gpost,
  graphCalls,
  graphError,
  graphPath,
  graphSummary,
  makeScenarioRunner,
  newWorld,
  notFound,
  okDrives,
  okRoot,
  PROJECT_ID,
  PROJECTS_ID,
  projectRow,
  projectsFolder,
  ROOT,
  rpcBodies,
  tableCalls,
  USER,
  webUrl,
} from "./recordFolderTestKit.ts";
import { jsonResponse } from "../_shared/testing/edgeTestKit.ts";
import { createGraphBudget } from "./folderBudget.ts";

Deno.test("AC-M365DOC-071 folder budget closes at the exact deadline", () => {
  let clock = 0;
  const budget = createGraphBudget(12_000, () => clock);
  assertEquals(budget.slice(), 5_000);
  clock = 11_999;
  assertEquals(budget.slice(), 1);
  clock = 12_000;
  assertEquals(budget.remaining(), 0);
  assertEquals(budget.slice(), null);
  clock = 12_001;
  assertEquals(budget.slice(), null);
});

const { handler, setTestJwks } = await import("./index.ts");
const run = makeScenarioRunner(handler, setTestJwks);

const ensureProject = { action: "ensure_record_folder", kind: "project", id: PROJECT_ID };
const ensureCase = { action: "ensure_record_folder", kind: "procurement", id: CASE_ID };
const LINK_ID = "10200000-0000-0000-0000-0000000009aa";
const created = (id: string, name: string, parentId: string) =>
  new Response(JSON.stringify(folderItem(id, name, parentId)), { status: 201, headers: { "content-type": "application/json" } });
const postedName = (call: { bodyJson?: unknown }) => (call.bodyJson as { name: string }).name;
const files = (n: number, name: (i: number) => string) =>
  Array.from({ length: n }, (_, i) => ({ id: `file${i}`, name: name(i), webUrl: webUrl(`file${i}`), file: {}, parentReference: { driveId: DRIVE, id: PROJECTS_ID } }));
const listingUrl = (parent: string, skip: string) => `https://graph.microsoft.com/v1.0/drives/${DRIVE}/items/${parent}/children?$top=200&$skiptoken=${skip}`;

// ── RF-1 / RF-2: discovery pages ONLY the convention parent's children ──────────────────────────────────

Deno.test("AC-M365DOC-069 discovery in a large library: files that mention the code never crowd out the folder, and nothing is searched drive-wide", async () => {
  let page = 0;
  const world = newWorld({ graph: discoverProjects(() => {
    page += 1;
    if (page === 1) return jsonResponse({ value: files(200, (i) => `P-100 spec ${i}.pdf`), "@odata.nextLink": listingUrl(PROJECTS_ID, "p2") });
    if (page === 2) return jsonResponse({ value: files(200, (i) => `P-100 note ${i}.docx`), "@odata.nextLink": listingUrl(PROJECTS_ID, "p3") });
    return jsonResponse({ value: [...files(150, (i) => `P-100 scan ${i}.png`), folderItem("the-folder", "P-100 Synthetic project", PROJECTS_ID)] });
  }) });
  await run(world, async ({ call, calls }) => {
    assertEquals(await (await call(ensureProject)).json(), { state: "linked", document_id: LINK_ID });
    assertEquals(page, 3);
    assertEquals((rpcBodies(calls, "m365_link_record_folder")[0]!.p_reference as { item_id: string }).item_id, "the-folder");
    for (const line of graphSummary(calls)) assertFalse(line.includes("/search("), line);
    const listings = graphCalls(calls).filter((c) => graphPath(c).endsWith("/children") && c.method === "GET");
    assertEquals(listings.length, 3);
    for (const listing of listings) assertEquals(graphPath(listing), childrenOf(PROJECTS_ID)); // only the convention parent
    assertEquals(listings[0]!.url.searchParams.get("$select"), "id,name,webUrl,parentReference,folder,file");
    assertEquals(listings[0]!.url.searchParams.get("$top"), "200");
  });
});

Deno.test("AC-M365DOC-069 an exhausted page cap is incomplete: it NEVER authorises creation", async () => {
  let page = 0;
  await run(newWorld({ graph: [...discoverProjects(() => jsonResponse({ value: files(5, (i) => `x${i}`), "@odata.nextLink": listingUrl(PROJECTS_ID, `t${(page += 1)}`) })), okDrives()] }), async ({ call, calls }) => {
    const response = await call(ensureProject);
    assertEquals(response.status, 502);
    assertEquals(page, 10); // the documented cap: ten pages of at most 200 children
    assertEquals(graphCalls(calls).filter((c) => c.method === "POST").length, 0);
    assertEquals(rpcBodies(calls, "m365_record_folder_created").length, 0);
  });
});

Deno.test("AC-M365DOC-069 a missing convention parent proves absence without any listing; the case parent is Procurement/<UTC year>", async (t) => {
  await t.step("no Projects folder => created, no listing call", async () => {
    await run(newWorld({ graph: [okRoot(), okDrives(), gget(child(ROOT, "Projects"), () => notFound()),
      gpost(childrenOf(ROOT), (c) => created(PROJECTS_ID, postedName(c), ROOT)),
      gpost(childrenOf(PROJECTS_ID), (c) => created("leaf", postedName(c), PROJECTS_ID))] }), async ({ call, calls }) => {
      assertEquals((await (await call(ensureProject)).json()).state, "created");
      assertEquals(graphSummary(calls).filter((l) => l.endsWith("/children") && l.startsWith("GET")).length, 0);
    });
  });
  await t.step("a case links the strict-boundary folder under Procurement/2026 (year follows created_at in UTC)", async () => {
    await run(newWorld({ parent: [caseRow({ created_at: "2025-12-31T23:30:00-05:00" })], graph: [okRoot(),
      gget(child(ROOT, "Procurement"), () => jsonResponse(folderItem("proc-id", "Procurement", ROOT))),
      gget(child("proc-id", "2026"), () => jsonResponse(folderItem("year-id", "2026", "proc-id"))),
      gget(childrenOf("year-id"), () => jsonResponse({ value: [folderItem("case-folder", "PR-0042 Existing", "year-id"), folderItem("other", "PR-00420 Longer", "year-id")] })),
    ] }), async ({ call, calls }) => {
      assertEquals(await (await call(ensureCase)).json(), { state: "linked", document_id: LINK_ID });
      assertEquals((rpcBodies(calls, "m365_link_record_folder")[0]!.p_reference as { item_id: string }).item_id, "case-folder");
    });
  });
});

Deno.test("AC-M365DOC-069 a real-shaped children next link validates with a literal or percent-encoded id", async () => {
  const PARENT = "01ABC=123"; // encodeURIComponent turns '=' into %3D; Graph may send it literal
  for (const [label, next] of [["literal", listingUrl(PARENT, "n2")], ["encoded", listingUrl(encodeURIComponent(PARENT), "n2")]] as const) {
    let page = 0;
    await run(newWorld({ graph: [okRoot(),
      gget(child(ROOT, "Projects"), () => jsonResponse(folderItem(PARENT, "Projects", ROOT))),
      gget(childrenOf(PARENT), () => (page += 1) === 1
        ? jsonResponse({ value: [], "@odata.nextLink": next })
        : jsonResponse({ value: [folderItem("hit", "P-100 Found", PARENT)] })),
    ] }), async ({ call }) => {
      assertEquals((await (await call(ensureProject)).json()).state, "linked", label);
      assertEquals(page, 2, label);
    });
  }
});

// ── RF-3: a folder already linked to another record is never auto-linked a second time ───────────────────

Deno.test("AC-M365DOC-069 folders already linked to a DIFFERENT record are excluded from auto-link", async (t) => {
  const listing = () => jsonResponse({ value: [folderItem("taken", "P-100 Old", PROJECTS_ID), folderItem("free", "P-100 New", PROJECTS_ID)] });
  const registerReads = (call: { url: URL }) =>
    call.url.searchParams.has("ms_item_id") ? [{ ms_item_id: "taken" }] : [];
  await t.step("the taken folder is skipped and the single free one is linked; the lookup is org/kind scoped", async () => {
    await run(newWorld({ documents: registerReads, graph: discoverProjects(listing) }), async ({ call, calls }) => {
      assertEquals((await (await call(ensureProject)).json()).state, "linked");
      assertEquals((rpcBodies(calls, "m365_link_record_folder")[0]!.p_reference as { item_id: string }).item_id, "free");
      const lookup = tableCalls(calls, "project_documents").find((c) => c.url.searchParams.has("ms_item_id"))!;
      assertEquals(lookup.url.searchParams.get("ms_drive_id"), `eq.${DRIVE}`);
      assertEquals(lookup.url.searchParams.get("project_id"), `neq.${PROJECT_ID}`);
      assertStringIncludes(lookup.url.searchParams.get("ms_item_id")!, "taken");
    });
  });
  await t.step("when the only match is taken, the record gets its OWN folder (nothing is shared)", async () => {
    await run(newWorld({ documents: registerReads, graph: [...discoverProjects(() => jsonResponse({ value: [folderItem("taken", "P-100 Old", PROJECTS_ID)] })), okDrives(),
      gpost(childrenOf(PROJECTS_ID), (c) => created("leaf", postedName(c), PROJECTS_ID))] }), async ({ call, calls }) => {
      assertEquals((await (await call(ensureProject)).json()).state, "created");
      assertEquals((rpcBodies(calls, "m365_link_record_folder")[0]!.p_reference as { item_id: string }).item_id, "leaf");
    });
  });
  await t.step("the guarded link RPC refusing a shared folder (needs_choice) surfaces needs_choice and never success", async () => {
    await run(newWorld({ link: () => jsonResponse({ state: "needs_choice" }), graph: discoverProjects(() => jsonResponse({ value: [folderItem("raced", "P-100 Raced", PROJECTS_ID)] })) }), async ({ call }) => {
      assertEquals(await (await call(ensureProject)).json(), { state: "needs_choice" });
    });
    // ... also through the 409 winner path
    await run(newWorld({ link: () => jsonResponse({ state: "needs_choice" }), graph: [...emptyDiscovery(), okDrives(),
      gpost(childrenOf(PROJECTS_ID), () => graphError(409, "nameAlreadyExists")),
      gget(child(PROJECTS_ID, "P-100 Synthetic project"), () => jsonResponse(folderItem("winner", "P-100 Synthetic project", PROJECTS_ID))),
    ] }), async ({ call }) => {
      assertEquals(await (await call(ensureProject)).json(), { state: "needs_choice" });
    });
  });
});

// ── RF-10: one wall-clock deadline from handler start ─────────────────────────────────────────────────────

Deno.test("AC-M365DOC-071 the whole ensure is bounded to 12 seconds from handler start (DB time and token refresh count)", async (t) => {
  let abortedAt = 0;
  await t.step("slow authorization/DB reads shrink the Graph allowance; a hung Graph call ends the invocation inside 12s", async () => {
    const time = new FakeTime();
    try {
      await run(newWorld({
        parent: () => { time.tick(9_000); return [projectRow()]; },
        graph: [gget(`/drives/${DRIVE}/root`, (call) => new Promise<Response>((_r, reject) => call.signal.addEventListener("abort", () => { abortedAt = Date.now(); reject(new Error("aborted")); })))],
      }), async ({ call, calls }) => {
        const start = Date.now();
        let settled = false;
        const pending = call(ensureProject).finally(() => (settled = true));
        for (let i = 0; i < 40; i += 1) await time.tickAsync(0); // let the handler start before the clock moves
        for (let i = 0; i < 400 && !settled; i += 1) await time.tickAsync(50);
        const response = await pending;
        assertEquals(response.status, 502);
        assertEquals((await response.json()).error, "GRAPH_ERROR");
        assert(abortedAt - start <= 12_000, `the deadline aborted the call at ${abortedAt - start}ms`);
        assertEquals(graphCalls(calls).filter((c) => c.method === "POST").length, 0);
      });
    } finally {
      time.restore();
    }
  });
  await t.step("a token refresh is inside the deadline: a hung refresh is the safe unavailable failure, not a stale connection", async () => {
    const time = new FakeTime();
    try {
      await run(newWorld({
        accessExpired: true,
        parent: () => { time.tick(8_000); return [projectRow()]; },
        refresh: (call) => new Promise<Response>((_r, reject) => call.signal.addEventListener("abort", () => { abortedAt = Date.now(); reject(new Error("aborted")); })),
        graph: [],
      }), async ({ call, calls }) => {
        const start = Date.now();
        let settled = false;
        const pending = call(ensureProject).finally(() => (settled = true));
        for (let i = 0; i < 40; i += 1) await time.tickAsync(0); // let the handler start before the clock moves
        for (let i = 0; i < 400 && !settled; i += 1) await time.tickAsync(50);
        const response = await pending;
        const body = await response.json();
        assertEquals([response.status, body.error], [502, "GRAPH_ERROR"], JSON.stringify(body));
        assert(abortedAt - start <= 12_000, `the deadline aborted the call at ${abortedAt - start}ms`);
        assertEquals(graphCalls(calls).length, 0);
      });
    } finally {
      time.restore();
    }
  });
  await t.step("a deadline already spent before the write stage starts no write", async () => {
    const time = new FakeTime();
    try {
      await run(newWorld({ graph: [...emptyDiscovery(), gget(`/sites/${"synthetic.example.invalid,site-guid,web-guid"}/drives`, () => { time.tick(13_000); return jsonResponse({ value: [{ id: DRIVE }] }); })] }), async ({ call, calls }) => {
        assertEquals((await call(ensureProject)).status, 502);
        assertEquals(graphCalls(calls).filter((c) => c.method === "POST").length, 0);
      });
    } finally {
      time.restore();
    }
  });
});

// ── RF-11: creation receipt on the 409 winner ─────────────────────────────────────────────────────────────

Deno.test("AC-M365DOC-073 a 409 winner we link after our own POST gets the receipt; a failed receipt stops before the link", async (t) => {
  const leaf = child(PROJECTS_ID, "P-100 Synthetic project");
  const graph = () => [...emptyDiscovery(), okDrives(),
    gpost(childrenOf(PROJECTS_ID), () => graphError(409, "nameAlreadyExists")),
    gget(leaf, () => jsonResponse(folderItem("winner-id", "P-100 Synthetic project", PROJECTS_ID)))];
  await t.step("receipt recorded once for the winner; outcome is linked, not created", async () => {
    await run(newWorld({ graph: graph() }), async ({ call, calls }) => {
      assertEquals(await (await call(ensureProject)).json(), { state: "linked", document_id: LINK_ID });
      assertEquals(rpcBodies(calls, "m365_record_folder_created"), [
        { p_actor_id: USER, p_kind: "project", p_record_id: PROJECT_ID, p_drive_id: DRIVE, p_item_id: "winner-id" },
      ]);
    });
  });
  await t.step("receipt failure => safe failure, no link", async () => {
    await run(newWorld({ graph: graph(), created: () => jsonResponse({ message: "boom" }, { status: 500 }) }), async ({ call, calls }) => {
      const response = await call(ensureProject);
      assertEquals(response.status, 502);
      assertStringIncludes((await response.json()).message, "could not be recorded");
      assertEquals(rpcBodies(calls, "m365_link_record_folder").length, 0);
    });
  });
  await t.step("a folder FOUND by discovery (no POST of ours) never gets a creation receipt", async () => {
    await run(newWorld({ graph: discoverProjects(() => jsonResponse({ value: [folderItem("found", "P-100 Found", PROJECTS_ID)] })) }), async ({ call, calls }) => {
      assertEquals((await (await call(ensureProject)).json()).state, "linked");
      assertEquals(rpcBodies(calls, "m365_record_folder_created").length, 0);
    });
  });
});

// ── RF-13: per-user rate limits ───────────────────────────────────────────────────────────────────────────

Deno.test("AC-M365DOC-071 ensure is rate limited per user (30 / 10 min): 429 with a safe envelope before any Graph work", async (t) => {
  await t.step("under the limit: the counter is hit once with the per-user key and the documented window", async () => {
    await run(newWorld({ graph: emptyDiscovery() }), async ({ call, calls }) => {
      await call(ensureProject);
      assertEquals(rpcBodies(calls, "rate_limit_hit"), [{ p_key: `m365-token-custody:ensure_record_folder:${USER}`, p_limit: 30, p_window_secs: 600 }]);
    });
  });
  await t.step("over the limit: 429 RATE_LIMITED + Retry-After, no connection read, no Graph call, nothing written", async () => {
    await run(newWorld({ rate: () => jsonResponse(false) }), async ({ call, calls }) => {
      const response = await call(ensureProject);
      assertEquals(response.status, 429);
      assertEquals(await response.json(), { error: "RATE_LIMITED", message: "Too many requests. Try again shortly." });
      assertEquals(response.headers.get("Retry-After"), "600");
      assertEquals(tableCalls(calls, "ms_graph_connections").length, 0);
      assertEquals(graphCalls(calls).length, 0);
      assertEquals(rpcBodies(calls, "m365_link_record_folder").length, 0);
    });
  });
  await t.step("a record that already has a folder is a free no-op: it does not spend the budget", async () => {
    await run(newWorld({ documents: [{ id: LINK_ID, ms_linked_at: "x" }], rate: () => jsonResponse(false) }), async ({ call, calls }) => {
      assertEquals((await call(ensureProject)).status, 200);
      assertEquals(rpcBodies(calls, "rate_limit_hit").length, 0);
    });
  });
});

// ── RF-14 / H8: names ─────────────────────────────────────────────────────────────────────────────────────

Deno.test("AC-M365DOC-069 a legitimate name containing '..' is re-read through the 409 path (only dot SEGMENTS are traversal)", async () => {
  const name = "P-100 v1..2";
  await run(newWorld({ parent: [projectRow({ name: "v1..2" })], graph: [...emptyDiscovery(), okDrives(),
    gpost(childrenOf(PROJECTS_ID), () => graphError(409, "nameAlreadyExists")),
    gget(child(PROJECTS_ID, name), () => jsonResponse(folderItem("dots-id", name, PROJECTS_ID))),
  ] }), async ({ call, calls }) => {
    assertEquals(await (await call(ensureProject)).json(), { state: "linked", document_id: LINK_ID });
    assertEquals((rpcBodies(calls, "m365_link_record_folder")[0]!.p_reference as { item_id: string }).item_id, "dots-id");
  });
});

Deno.test("AC-M365DOC-070 created names are never a bare device name, a '~$' lock-file name or contain '_vti_'", async (t) => {
  const posted = async (parent: Record<string, unknown>) => {
    let name = "";
    await run(newWorld({ parent: [parent], graph: [...emptyDiscovery(), okDrives(), gpost(childrenOf(PROJECTS_ID), (c) => { name = postedName(c); return created("leaf", name, PROJECTS_ID); })] }), async ({ call }) => {
      assertEquals((await call(ensureProject)).status, 200);
    });
    return name;
  };
  await t.step("code CON with no project name => 'CON folder'", async () => {
    assertEquals(await posted(projectRow({ code: "CON", name: "" })), "CON folder");
    assertEquals(await posted(projectRow({ code: "lpt1", name: "   " })), "lpt1 folder");
  });
  await t.step("'~$' prefix and '_vti_' are neutralised", async () => {
    assertEquals(await posted(projectRow({ code: "~$A", name: "Plan" })), "~-A Plan");
    assertEquals(await posted(projectRow({ code: "P-1", name: "x_vti_y" })), "P-1 x_vti-y");
  });
  await t.step("an NFD project name is created in NFC and an NFD-named existing folder is matched (no duplicate)", async () => {
    assertEquals(await posted(projectRow({ code: "P-1", name: "Café" })), "P-1 Café");
    await run(newWorld({ parent: [projectRow({ code: "Café-1", name: "x" })], graph: discoverProjects(() => jsonResponse({ value: [folderItem("nfd", "Café-1 Alpha", PROJECTS_ID)] })) }), async ({ call, calls }) => {
      assertEquals((await (await call(ensureProject)).json()).state, "linked");
      assertEquals(graphCalls(calls).filter((c) => c.method === "POST").length, 0);
    });
  });
  await t.step("an RTL-override / zero-width name is created without the invisible controls", async () => {
    assertEquals(await posted(projectRow({ code: "P-1", name: "‮gnp.exe‬​plan" })), "P-1  gnp.exe  plan");
  });
});

// ── H19: safe Retry-After hint ────────────────────────────────────────────────────────────────────────────

Deno.test("AC-M365DOC-071 a throttled Graph answer surfaces only a capped numeric Retry-After on the safe envelope", async (t) => {
  const assertHint = async (graph: ReturnType<typeof newWorld>["graph"], expected: number | undefined) => {
    await run(newWorld({ graph }), async ({ call }) => {
      const response = await call(ensureProject);
      assertEquals(response.status, 502);
      const body = await response.json();
      assertEquals(body.error, "GRAPH_ERROR");
      assertEquals(body.retry_after_seconds, expected);
      assertEquals(response.headers.get("Retry-After"), expected === undefined ? null : String(expected));
      assertFalse(JSON.stringify(body).includes("synthetic"));
    });
  };
  await t.step("429 + Retry-After on the listing => the number", () => assertHint([okRoot(), projectsFolder(), gget(childrenOf(PROJECTS_ID), () => graphError(429, "activityLimitReached", { "Retry-After": "7" }))], 7));
  await t.step("a large value is capped at 30", () => assertHint([okRoot(), projectsFolder(), gget(childrenOf(PROJECTS_ID), () => graphError(429, "activityLimitReached", { "Retry-After": "3600" }))], 30));
  await t.step("a non-numeric or absent header gives no hint, never upstream text", async () => {
    await assertHint([okRoot(), projectsFolder(), gget(childrenOf(PROJECTS_ID), () => graphError(429, "activityLimitReached", { "Retry-After": "Wed, 21 Oct 2026 07:28:00 GMT" }))], undefined);
    await assertHint([okRoot(), projectsFolder(), gget(childrenOf(PROJECTS_ID), () => graphError(429, "activityLimitReached"))], undefined);
  });
  await t.step("429 on the folder create itself carries the hint and is never retried", async () => {
    await run(newWorld({ graph: [...emptyDiscovery(), okDrives(), gpost(childrenOf(PROJECTS_ID), () => graphError(429, "activityLimitReached", { "Retry-After": "5" }))] }), async ({ call, calls }) => {
      const response = await call(ensureProject);
      assertEquals((await response.json()).retry_after_seconds, 5);
      assertEquals(graphCalls(calls).filter((c) => c.method === "POST").length, 1);
    });
  });
});
