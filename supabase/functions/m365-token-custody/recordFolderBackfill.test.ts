// recordFolderBackfill.test.ts — Admin match-only sweep `link_existing_record_folders` (AC-M365DOC-072).
// Imports the SHIPPED handler; mocks only globalThis.fetch. Synthetic ids/hosts only.
import { assert, assertEquals, assertFalse } from "@std/assert";
import { FakeTime } from "@std/testing/time";
import {
  caseRow,
  DRIVE,
  gget,
  graphCalls,
  graphError,
  graphSummary,
  makeScenarioRunner,
  newWorld,
  ORG,
  projectRow,
  READ_SCOPES,
  rpcBodies,
  SEARCH,
  searchHit,
  tableCalls,
  type World,
} from "./recordFolderTestKit.ts";
import { jsonResponse } from "../_shared/testing/edgeTestKit.ts";

const { handler, setTestJwks } = await import("./index.ts");
const run = makeScenarioRunner(handler, setTestJwks);

const projectId = (n: number) => `10200000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const caseId = (n: number) => `10200000-0000-0000-0001-${String(n).padStart(12, "0")}`;
const LINK_ID = "10200000-0000-0000-0000-0000000009aa";
const sweep = { action: "link_existing_record_folders" } as const;

interface Fixture {
  projects: number[];
  cases?: number[];
  /** code by record number: undefined => `C-<n>`; null => missing code */
  codes?: Record<number, string | null>;
  withFolder?: Set<string>;
  search?: Record<string, () => Response>;
  link?: World["link"];
  extra?: Partial<World>;
}

/** Builds a world whose candidate RPC pages exactly like the SQL: id > after, ordered, limit 6. */
function sweepWorld(fx: Fixture): World {
  const all = {
    project: fx.projects.map(projectId),
    procurement: (fx.cases ?? []).map(caseId),
  };
  const codeOf = (id: string) => {
    const n = Number(id.slice(-4));
    return fx.codes && n in fx.codes ? fx.codes[n] : `C-${n}`;
  };
  return newWorld({
    role: "Admin",
    scopes: READ_SCOPES, // match-only needs read consent only
    parent: (call) => {
      const id = String(call.url.searchParams.get("id")).replace("eq.", "");
      return call.url.pathname.endsWith("/projects")
        ? [projectRow({ id, code: codeOf(id), name: "Synthetic project" })]
        : [caseRow({ id, code: null, pr_number: codeOf(id), title: "Synthetic case" })];
    },
    documents: (call) => {
      const key = call.url.searchParams.get("project_id") ?? call.url.searchParams.get("procurement_id") ?? "";
      return fx.withFolder?.has(key.replace("eq.", "")) ? [{ id: LINK_ID, ms_linked_at: "x" }] : [];
    },
    candidates: (call) => {
      const { p_kind, p_after } = call.bodyJson as { p_kind: "project" | "procurement"; p_after: string | null };
      return jsonResponse(all[p_kind].filter((id) => !p_after || id > p_after).slice(0, 6).map((id) => ({ id })));
    },
    graph: [gget(SEARCH, (_call, path) => {
      const code = /q='([^']*)'/.exec(path)![1]!;
      const custom = fx.search?.[code];
      if (custom) return custom();
      // One hit under each convention parent: only the one matching the record kind may be linked.
      return jsonResponse({ value: [searchHit(`found-${code}`, `${code} Synthetic`, "/Projects"), searchHit(`found-case-${code}`, `${code} Synthetic`, "/Procurement/2026")] });
    })],
    ...(fx.link ? { link: fx.link } : {}),
    ...fx.extra,
  });
}

interface Page {
  scanned: number; linked: number; needs_choice: number; missing: number; failed: number; skipped: number;
  next: { kind: string; after: string | null } | null; stopped?: string;
}
const page = async (response: Response) => (await response.json()) as Page;
const sum = (p: Page) => p.linked + p.needs_choice + p.missing + p.failed + p.skipped;

Deno.test("AC-M365DOC-072 Admin match-only sweep links singles and reports bounded counts", async (t) => {
  await t.step("single / multiple / none / missing code / concurrent link each land in exactly one bucket, with no write", async () => {
    const world = sweepWorld({
      projects: [1, 2, 3, 4, 5],
      codes: { 4: null },
      withFolder: new Set([projectId(5)]),
      search: {
        "C-2": () => jsonResponse({ value: [searchHit("a", "C-2 one", "/Projects"), searchHit("b", "C-2 two", "/Projects")] }),
        "C-3": () => jsonResponse({ value: [] }),
      },
    });
    await run(world, async ({ call, calls, token }) => {
      const body = await page(await call(sweep));
      assertEquals(body, { scanned: 5, linked: 1, needs_choice: 1, missing: 2, failed: 0, skipped: 1, next: { kind: "procurement", after: null } });
      assertEquals(sum(body), body.scanned);
      // match-only: every Graph call is a GET search (no parents, no year, no create).
      assert(graphSummary(calls).every((line) => line.startsWith("GET /drives/synthetic-drive/root/search")), graphSummary(calls).join("\n"));
      assertEquals(rpcBodies(calls, "m365_record_folder_created").length, 0);
      // The single match is linked through the caller-RLS RPC with the exact reference and settings snapshot.
      const links = rpcBodies(calls, "m365_link_record_folder");
      assertEquals(links.length, 1);
      assertEquals(links[0]!.p_record_id, projectId(1));
      assertEquals(links[0]!.p_kind, "project");
      const linkCall = calls.find((c) => c.url.pathname.endsWith("m365_link_record_folder"))!;
      assertEquals(linkCall.headers.get("authorization"), `Bearer ${token}`);
      // Candidate paging is by keyset on the caller client, never by offset.
      const [firstPage] = rpcBodies(calls, "m365_record_folder_candidates");
      assertEquals(firstPage, { p_kind: "project", p_after: null });
    });
  });

  await t.step("cases: the sweep continues from the procurement cursor and reports completion with next null", async () => {
    const world = sweepWorld({ projects: [], cases: [1, 2] });
    await run(world, async ({ call, calls }) => {
      const body = await page(await call({ ...sweep, cursor: { kind: "procurement", after: null } }));
      assertEquals(body, { scanned: 2, linked: 2, needs_choice: 0, missing: 0, failed: 0, skipped: 0, next: null });
      assertEquals(rpcBodies(calls, "m365_link_record_folder").map((b) => b.p_kind), ["procurement", "procurement"]);
      const first = rpcBodies(calls, "m365_link_record_folder")[0]!;
      assertEquals((first.p_reference as { item_id: string }).item_id, "found-case-C-1");
    });
  });

  await t.step("only Admins may run it; non-Admin and cross-role callers are refused before any candidate read or Graph call", async () => {
    for (const role of ["Project Manager", "Finance", "Executive", "Engineer", "Operator"]) {
      await run(sweepWorld({ projects: [1], extra: { role } }), async ({ call, calls }) => {
        assertEquals((await call(sweep)).status, 403, role);
        assertEquals(rpcBodies(calls, "m365_record_folder_candidates").length, 0);
        assertEquals(graphCalls(calls).length, 0);
      });
    }
  });

  await t.step("cursor tampering and extra keys are refused before any work", async () => {
    const bad: unknown[] = [
      { ...sweep, cursor: { kind: "budget", after: null } },
      { ...sweep, cursor: { kind: "project", after: "not-a-uuid" } },
      { ...sweep, cursor: { kind: "project" } },
      { ...sweep, cursor: { kind: "project", after: null, table: "profiles" } },
      { ...sweep, cursor: "project" },
      { ...sweep, cursor: null },
      { ...sweep, org_id: ORG },
      { ...sweep, drive_id: DRIVE },
    ];
    for (const body of bad) {
      await run(sweepWorld({ projects: [1] }), async ({ call, calls }) => {
        assertEquals((await call(body)).status, 400, JSON.stringify(body));
        assertEquals(rpcBodies(calls, "m365_record_folder_candidates").length, 0);
        assertEquals(graphCalls(calls).length, 0);
      });
    }
  });

  await t.step("no default library, and a revoked connection, return the normal envelope before processing anything", async () => {
    await run(sweepWorld({ projects: [1], extra: { settings: [] } }), async ({ call, calls }) => {
      assertEquals((await call(sweep)).status, 400);
      assertEquals(rpcBodies(calls, "m365_record_folder_candidates").length, 0);
    });
    await run(sweepWorld({ projects: [1], extra: { connectionStatus: "revoked" } }), async ({ call, calls }) => {
      const response = await call(sweep);
      assertEquals((await response.json()).error, "CONNECTION_REVOKED");
      assertEquals(rpcBodies(calls, "m365_record_folder_candidates").length, 0);
    });
  });
});

Deno.test("AC-M365DOC-072 backfill never links a longer code's folder (P-1 vs P-10)", async () => {
  const world = sweepWorld({
    projects: [1],
    codes: { 1: "P-1" },
    search: { "P-1": () => jsonResponse({ value: [searchHit("p10", "P-10 Alpha", "/Projects")] }) },
  });
  await run(world, async ({ call, calls }) => {
    const body = await page(await call(sweep));
    assertEquals([body.linked, body.missing], [0, 1]);
    assertEquals(rpcBodies(calls, "m365_link_record_folder").length, 0);
  });
});

Deno.test("AC-M365DOC-072 keyset pages process at most five, leave the sixth unprocessed and put the cursor after the last processed record", async (t) => {
  await t.step("seven projects: five now, the sixth is NOT scanned, cursor after the fifth; the next page finishes", async () => {
    await run(sweepWorld({ projects: [1, 2, 3, 4, 5, 6, 7] }), async ({ call, calls }) => {
      const first = await page(await call(sweep));
      assertEquals(first.scanned, 5);
      assertEquals(first.next, { kind: "project", after: projectId(5) });
      assertEquals(sum(first), 5);
      assertEquals(rpcBodies(calls, "m365_link_record_folder").length, 5);
      const second = await page(await call({ ...sweep, cursor: first.next }));
      assertEquals(second.scanned, 2);
      assertEquals(second.next, { kind: "procurement", after: null });
      assertEquals(rpcBodies(calls, "m365_record_folder_candidates")[1], { p_kind: "project", p_after: projectId(5) });
    });
  });

  await t.step("an empty project page moves to cases within the same call; a fully empty org ends with next null", async () => {
    await run(sweepWorld({ projects: [], cases: [1] }), async ({ call }) => {
      const body = await page(await call(sweep));
      assertEquals(body.scanned, 1);
      assertEquals(body.next, null);
    });
    await run(sweepWorld({ projects: [], cases: [] }), async ({ call }) => {
      assertEquals(await page(await call(sweep)), { scanned: 0, linked: 0, needs_choice: 0, missing: 0, failed: 0, skipped: 0, next: null });
    });
  });

  await t.step("a per-record search failure is failed, never missing; the page still completes", async () => {
    await run(sweepWorld({ projects: [1, 2], search: { "C-1": () => graphError(503, "serviceNotAvailable") } }), async ({ call, calls }) => {
      const body = await page(await call(sweep));
      assertEquals([body.scanned, body.failed, body.missing, body.linked], [2, 1, 0, 1]);
      assertEquals(graphCalls(calls).length, 2); // no retry
    });
  });

  await t.step("a concurrent folder link appearing mid-sweep counts as skipped", async () => {
    await run(sweepWorld({ projects: [1], search: {}, link: () => jsonResponse({ document_id: LINK_ID, state: "already_linked" }) }), async ({ call }) => {
      const body = await page(await call(sweep));
      assertEquals([body.scanned, body.skipped, body.linked], [1, 1, 0]);
    });
  });

  await t.step("the shared 15s budget ends the page between records with the cursor after the last processed", async () => {
    const time = new FakeTime();
    try {
      await run(sweepWorld({ projects: [1, 2, 3, 4], search: { "C-1": () => { time.tick(8_000); return jsonResponse({ value: [] }); }, "C-2": () => { time.tick(8_000); return jsonResponse({ value: [] }); } } }), async ({ call }) => {
        const body = await page(await call(sweep));
        assertEquals(body.scanned, 2);
        assertEquals(body.missing, 2);
        assertEquals(body.next, { kind: "project", after: projectId(2) });
        assertFalse("stopped" in body);
      });
    } finally {
      time.restore();
    }
  });

  await t.step("no progress under the deadline is an error, never a cursor that loops", async () => {
    const time = new FakeTime();
    try {
      const world = sweepWorld({ projects: [1, 2] });
      const original = world.candidates;
      world.candidates = (call) => { time.tick(16_000); return original(call); };
      await run(world, async ({ call }) => {
        const response = await call(sweep);
        assertEquals(response.status, 502);
        assertEquals((await response.json()).error, "GRAPH_ERROR");
      });
    } finally {
      time.restore();
    }
  });

  await t.step("a default changed mid-page stops with the safe enum, keeps committed counts and leaves the fenced record unprocessed", async () => {
    let links = 0;
    const world = sweepWorld({
      projects: [1, 2, 3],
      link: () => (links += 1) === 1
        ? jsonResponse({ document_id: LINK_ID, state: "linked" })
        : jsonResponse({ code: "23514", message: "m365 default changed", details: "m365-default-changed" }, { status: 400 }),
    });
    await run(world, async ({ call }) => {
      const body = await page(await call(sweep));
      assertEquals(body.scanned, 1);
      assertEquals(body.linked, 1);
      assertEquals(body.stopped, "default_changed");
      assertEquals(body.next, { kind: "project", after: projectId(1) });
    });
  });

  await t.step("a failure caused by the spent budget stops the page as unavailable (record not marked failed)", async () => {
    const time = new FakeTime();
    try {
      await run(sweepWorld({ projects: [1, 2, 3], search: { "C-2": () => { time.tick(16_000); return graphError(503, "serviceNotAvailable"); } } }), async ({ call }) => {
        const body = await page(await call(sweep));
        assertEquals(body.scanned, 1);
        assertEquals(body.stopped, "unavailable");
        assertEquals(body.failed, 0);
        assertEquals(body.next, { kind: "project", after: projectId(1) });
      });
    } finally {
      time.restore();
    }
  });

  await t.step("candidate rows that do not advance the keyset are refused", async () => {
    const world = sweepWorld({ projects: [1, 2] });
    world.candidates = () => jsonResponse([{ id: projectId(2) }, { id: projectId(1) }]);
    await run(world, async ({ call, calls }) => {
      assertEquals((await call(sweep)).status, 502);
      assertEquals(graphCalls(calls).length, 0);
    });
  });
});

Deno.test("AC-M365DOC-072 the sweep reads settings and parents under the caller JWT and never writes to Microsoft", async () => {
  await run(sweepWorld({ projects: [1] }), async ({ call, calls, token }) => {
    await call(sweep);
    for (const table of ["org_m365_document_settings", "projects", "project_documents"]) {
      assertEquals(tableCalls(calls, table)[0]?.headers.get("authorization"), `Bearer ${token}`, table);
    }
    assertEquals(calls.filter((c) => c.url.host === "graph.microsoft.com" && c.method !== "GET").length, 0);
    assertEquals(calls.filter((c) => c.url.host === "login.microsoftonline.com").length, 0);
  });
});
