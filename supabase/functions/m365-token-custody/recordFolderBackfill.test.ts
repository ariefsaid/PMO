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
  child,
  childrenOf,
  folderItem,
  okRoot,
  ROOT,
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
  /** Replace the folders listed under Projects / Procurement/2026 (default: one `<code> Synthetic` per record). */
  projectItems?: Array<{ id: string; name: string }>;
  caseItems?: Array<{ id: string; name: string }>;
  /** Override the n-th (1-based) listing request across the whole sweep. */
  listing?: (n: number) => Response | undefined;
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
    graph: (() => {
      let listings = 0;
      const items = (kind: "project" | "case") => {
        const custom = kind === "project" ? fx.projectItems : fx.caseItems;
        if (custom) return custom;
        const ids = kind === "project" ? fx.projects : fx.cases ?? [];
        return ids.map((n) => ({ id: kind === "project" ? `found-C-${n}` : `found-case-C-${n}`, name: `${codeOf(kind === "project" ? projectId(n) : caseId(n))} Synthetic` }))
          .filter((item) => !item.name.startsWith("null"));
      };
      const listingOf = (kind: "project" | "case", parentId: string) => () => {
        listings += 1;
        return fx.listing?.(listings) ?? jsonResponse({ value: items(kind).map((item) => folderItem(item.id, item.name, parentId)) });
      };
      return [
        okRoot(),
        gget(child(ROOT, "Projects"), () => jsonResponse(folderItem("projects-id", "Projects", ROOT))),
        gget(childrenOf("projects-id"), listingOf("project", "projects-id")),
        gget(child(ROOT, "Procurement"), () => jsonResponse(folderItem("proc-id", "Procurement", ROOT))),
        gget(child("proc-id", "2026"), () => jsonResponse(folderItem("year-id", "2026", "proc-id"))),
        gget(childrenOf("year-id"), listingOf("case", "year-id")),
      ];
    })(),
    ...(fx.link ? { link: fx.link } : {}),
    ...fx.extra,
  });
}

interface Page {
  scanned: number; linked: number; needs_choice: number; missing: number; failed: number; skipped: number;
  unmatched: string[]; next: { kind: string; after: string | null } | null; stopped?: string;
}
const page = async (response: Response) => (await response.json()) as Page;
const sum = (p: Page) => p.linked + p.needs_choice + p.missing + p.failed + p.skipped;

Deno.test("AC-M365DOC-072 Admin match-only sweep links singles and reports bounded counts", async (t) => {
  await t.step("single / multiple / none / missing code / concurrent link each land in exactly one bucket, with no write", async () => {
    const world = sweepWorld({
      projects: [1, 2, 3, 4, 5],
      codes: { 4: null },
      withFolder: new Set([projectId(5)]),
      projectItems: [{ id: "found-C-1", name: "C-1 Synthetic" }, { id: "a", name: "C-2 one" }, { id: "b", name: "C-2 two" }],
    });
    await run(world, async ({ call, calls, token }) => {
      const body = await page(await call(sweep));
      assertEquals(body, { scanned: 5, linked: 1, needs_choice: 1, missing: 2, failed: 0, skipped: 1, unmatched: [projectId(3), projectId(4)], next: { kind: "procurement", after: null } });
      assertEquals(sum(body), body.scanned);
      // match-only: every Graph call is a GET (no create); the Projects listing is read ONCE for the whole page.
      assert(graphSummary(calls).every((line) => line.startsWith("GET ")), graphSummary(calls).join("\n"));
      assertEquals(graphSummary(calls).filter((line) => line.endsWith("/items/projects-id/children")).length, 1);
      assertEquals(graphSummary(calls).filter((line) => line.includes("/search(")).length, 0);
      assertEquals(rpcBodies(calls, "m365_record_folder_created").length, 0);
      // The single match is linked through the caller-RLS RPC with the exact reference and settings snapshot.
      const links = rpcBodies(calls, "m365_link_record_folder");
      assertEquals(links.length, 1);
      assertEquals(links[0]!.p_record_id, projectId(1));
      assertEquals(links[0]!.p_kind, "project");
      const linkCall = calls.find((c) => c.url.pathname.endsWith("m365_link_record_folder"))!;
      assertEquals(linkCall.headers.get("authorization"), `Bearer ${token}`);
      // The page's counts and unmatched record ids are saved for `pmo m365 status` (first page: nothing to add to).
      const [saved] = tableCalls(calls, "m365_record_folder_sweeps").filter((c) => c.method === "POST");
      const row = saved!.bodyJson as Record<string, unknown>;
      assertEquals(row.state, "in_progress");
      assertEquals(row.counts, { scanned: 5, linked: 1, needs_choice: 1, missing: 2, failed: 0, skipped: 1 });
      assertEquals(row.unmatched, [projectId(3), projectId(4)]);
      // Candidate paging is by keyset on the caller client, never by offset.
      const [firstPage] = rpcBodies(calls, "m365_record_folder_candidates");
      assertEquals(firstPage, { p_kind: "project", p_after: null });
    });
  });

  await t.step("cases: the sweep continues from the procurement cursor and reports completion with next null", async () => {
    const world = sweepWorld({ projects: [], cases: [1, 2] });
    await run(world, async ({ call, calls }) => {
      const body = await page(await call({ ...sweep, cursor: { kind: "procurement", after: null } }));
      assertEquals(body, { scanned: 2, linked: 2, needs_choice: 0, missing: 0, failed: 0, skipped: 0, unmatched: [], next: null });
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
    projectItems: [{ id: "p10", name: "P-10 Alpha" }],
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
      assertEquals(await page(await call(sweep)), { scanned: 0, linked: 0, needs_choice: 0, missing: 0, failed: 0, skipped: 0, unmatched: [], next: null });
    });
  });

  await t.step("a per-record discovery failure is failed, never missing; the page still completes", async () => {
    await run(sweepWorld({ projects: [1, 2], listing: (n) => n === 1 ? graphError(503, "serviceNotAvailable") : undefined }), async ({ call, calls }) => {
      const body = await page(await call(sweep));
      assertEquals([body.scanned, body.failed, body.missing, body.linked], [2, 1, 0, 1]);
      assertEquals(graphSummary(calls).filter((line) => line.endsWith("/items/projects-id/children")).length, 2); // one per record, no retry
    });
  });

  await t.step("two consecutive Graph failures STOP the page (stopped: unavailable) instead of failing every remaining record; a 429 Retry-After is surfaced capped", async () => {
    await run(sweepWorld({ projects: [1, 2, 3, 4, 5], listing: () => graphError(429, "activityLimitReached", { "Retry-After": "9" }) }), async ({ call }) => {
      const body = await page(await call(sweep)) as Page & { retry_after_seconds?: number };
      assertEquals([body.scanned, body.failed, body.stopped, body.retry_after_seconds], [2, 2, "unavailable", 9]);
      assertEquals(body.next, { kind: "project", after: projectId(2) });
    });
    // A success in between resets the streak: failure, success, failure never stops the page.
    await run(sweepWorld({ projects: [1, 2, 3], projectItems: [{ id: "x", name: "C-2 Synthetic" }], listing: (n) => n === 1 || n === 3 ? graphError(503, "serviceNotAvailable") : undefined }), async ({ call }) => {
      const body = await page(await call(sweep));
      assertEquals(body.stopped, undefined);
      assertEquals(body.scanned, 3);
    });
  });

  await t.step("a concurrent folder link appearing mid-sweep counts as skipped", async () => {
    await run(sweepWorld({ projects: [1], link: () => jsonResponse({ document_id: LINK_ID, state: "already_linked" }) }), async ({ call }) => {
      const body = await page(await call(sweep));
      assertEquals([body.scanned, body.skipped, body.linked], [1, 1, 0]);
    });
  });

  await t.step("the shared 12s deadline ends the page between records with the cursor after the last processed", async () => {
    const time = new FakeTime();
    try {
      // Each link (database) takes 7s of wall clock: after two records the deadline is spent.
      await run(sweepWorld({ projects: [1, 2, 3, 4], link: () => { time.tick(7_000); return jsonResponse({ document_id: LINK_ID, state: "linked" }); } }), async ({ call }) => {
        const body = await page(await call(sweep));
        assertEquals(body.scanned, 2);
        assertEquals(body.linked, 2);
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
      world.candidates = (call) => { time.tick(13_000); return original(call); };
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
      // Record 1 already has a folder (no Graph work); record 2's discovery fails AFTER the deadline is spent.
      await run(sweepWorld({ projects: [1, 2, 3], withFolder: new Set([projectId(1)]), listing: () => { time.tick(13_000); return graphError(503, "serviceNotAvailable"); } }), async ({ call }) => {
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

Deno.test("AC-M365DOC-072 the sweep is rate limited per Admin (12 / 10 min) before any candidate read or Graph call", async () => {
  await run(sweepWorld({ projects: [1] }), async ({ call, calls }) => {
    await call(sweep);
    assertEquals(rpcBodies(calls, "rate_limit_hit")[0], { p_key: "m365-token-custody:link_existing_record_folders:synthetic-folder-user", p_limit: 12, p_window_secs: 600 });
  });
  await run(sweepWorld({ projects: [1], extra: { rate: () => jsonResponse(false) } }), async ({ call, calls }) => {
    const response = await call(sweep);
    assertEquals(response.status, 429);
    assertEquals((await response.json()).error, "RATE_LIMITED");
    assertEquals(rpcBodies(calls, "m365_record_folder_candidates").length, 0);
    assertEquals(graphCalls(calls).length, 0);
  });
});

Deno.test("AC-M365DOC-072 backfill never auto-links a folder already linked to another record", async () => {
  const world = sweepWorld({
    projects: [1],
    projectItems: [{ id: "taken", name: "C-1 Synthetic" }],
    extra: { documents: (call) => call.url.searchParams.has("ms_item_id") ? [{ ms_item_id: "taken" }] : [] },
  });
  await run(world, async ({ call, calls }) => {
    const body = await page(await call(sweep));
    assertEquals([body.linked, body.missing], [0, 1]); // match-only never creates; the record stays unlinked
    assertEquals(rpcBodies(calls, "m365_link_record_folder").length, 0);
  });
});

Deno.test("AC-M365DOC-072 the running summary never fails a page: a save error becomes summary_warning", async () => {
  const world = sweepWorld({
    projects: [1], projectItems: [{ id: "found-C-1", name: "C-1 Synthetic" }],
    extra: { sweepSave: () => jsonResponse({ message: "boom" }, { status: 500 }) },
  });
  await run(world, async ({ call }) => {
    const response = await call(sweep);
    assertEquals(response.status, 200);
    const body = await page(response);
    assertEquals(body.linked, 1);
    assert(typeof (body as { summary_warning?: string }).summary_warning === "string");
  });
});

Deno.test("AC-M365DOC-072 the stored unmatched list is de-duplicated, capped at 500 and flagged truncated", async () => {
  const prior = Array.from({ length: 499 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`);
  const world = sweepWorld({
    projects: [], cases: [1, 2], caseItems: [],
    extra: {
      sweepPrior: {
        counts: { scanned: 3, linked: 0, needs_choice: 0, missing: 3, failed: 0, skipped: 0 },
        unmatched: [...prior, caseId(1)], unmatched_truncated: false,
      },
    },
  });
  await run(world, async ({ call, calls }) => {
    const body = await page(await call({ ...sweep, cursor: { kind: "procurement", after: null } }));
    assertEquals(body.unmatched, [caseId(1), caseId(2)]);
    const [saved] = tableCalls(calls, "m365_record_folder_sweeps").filter((c) => c.method === "POST");
    const row = saved!.bodyJson as { unmatched: string[]; unmatched_truncated: boolean; counts: Record<string, number> };
    assertEquals(row.unmatched.length, 500);
    assertEquals(new Set(row.unmatched).size, 500, "no duplicates");
    assertEquals(row.unmatched_truncated, true);
    assertEquals(row.counts.scanned, 5, "counts accumulate across pages");
  });
});
