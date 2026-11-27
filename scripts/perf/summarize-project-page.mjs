/** Summarize a private probe directory; never commit the generated evidence. */
import { createRequire } from "node:module";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, basename } from "node:path";
const require = createRequire(resolve("pmo-portal/package.json"));
const { TraceMap, originalPositionFor } = require("@jridgewell/trace-mapping");
const directory = process.argv[2];
const all = JSON.parse(
  readFileSync(resolve(directory, "results.json"), "utf8"),
);
const maps = new Map();
function source(frame) {
  const file = basename(frame.url || "");
  const path = resolve("pmo-portal/dist/assets", file + ".map");
  if (!existsSync(path)) return frame;
  if (!maps.has(path))
    maps.set(path, new TraceMap(JSON.parse(readFileSync(path, "utf8"))));
  const original = originalPositionFor(maps.get(path), {
    line: frame.lineNumber + 1,
    column: frame.columnNumber,
  });
  return { ...frame, original };
}
const detailed = [];
for (const run of all) {
  const trace = JSON.parse(
    readFileSync(resolve(directory, run.label + ".trace.json"), "utf8"),
  ).traceEvents;
  const cpu = JSON.parse(
    readFileSync(resolve(directory, run.label + ".cpuprofile"), "utf8"),
  );
  const nodes = new Map(cpu.nodes.map((n) => [n.id, n]));
  let at = cpu.startTime;
  const samples = cpu.samples.map((id, i) => ({
    at: (at += cpu.timeDeltas[i]),
    id,
  }));
  const main = trace.find(
    (e) => e.name === "thread_name" && e.args.name === "CrRendererMain",
  );
  const clockOffset = run.requests[0].time * 1000 - run.requests[0].at;
  const periodAt = run.marks.find((m) => m.name === "period")?.at ?? Infinity;
  const tasks = trace
    .filter(
      (e) =>
        e.name === "RunTask" &&
        e.dur > 50000 &&
        e.ts / 1000 - clockOffset <= periodAt &&
        (!main || e.tid === main.tid),
    )
    .map((task) => {
      const counts = new Map();
      for (const sample of samples)
        if (sample.at >= task.ts && sample.at < task.ts + task.dur)
          counts.set(sample.id, (counts.get(sample.id) || 0) + 1);
      const top = [...counts]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 4)
        .map(([id, count]) => ({
          samples: count,
          ...source(nodes.get(id).callFrame),
        }));
      return {
        start: task.ts / 1000 - clockOffset,
        duration: task.dur / 1000,
        top,
      };
    });
  const requests = trace
    .filter((e) => e.name === "ResourceSendRequest")
    .map((e) => e.args.data);
  const responses = new Map(
    trace
      .filter((e) => e.name === "ResourceReceiveResponse")
      .map((e) => [e.args.data.requestId, e.args.data.statusCode]),
  );
  detailed.push({
    label: run.label,
    tasks,
    network: requests
      .filter((r) => r.url.includes("/rest/"))
      .map((r) => ({
        url: r.url.split("?")[0],
        method: r.requestMethod,
        status: responses.get(r.requestId),
      })),
  });
}
writeFileSync(
  resolve(directory, "analysis.json"),
  JSON.stringify(detailed, null, 2),
);
const median = (values) =>
  values.sort((a, b) => a - b)[Math.floor(values.length / 2)];
for (const mode of ["4x", "1x"]) {
  const runs = all.filter((r) => r.label.startsWith(mode));
  const row = { mode };
  for (const name of ["shell", "heading", "period"])
    row[name] = median(
      runs.map((r) => r.marks.find((m) => m.name === name)?.at ?? NaN),
    );
  for (const name of [
    "profiles",
    "projects",
    "get_project_overview_read",
    "get_work_order_performance",
    "procurement_open_commitments",
    "work_orders",
    "work_order_billing",
    "get_financial_statement_catalogue",
  ])
    row[name] = median(
      runs.map((r) =>
        Math.min(
          ...r.requests
            .filter(
              (q) => q.path.endsWith("/" + name) && q.method !== "OPTIONS",
            )
            .map((q) => q.at),
        ),
      ),
    );
  row.longTasks = median(runs.map((r) => r.longTasks.length));
  console.log(JSON.stringify(row));
}
