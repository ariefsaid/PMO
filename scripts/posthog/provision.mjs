/**
 * provision(spec, io) — idempotent dashboards-as-code upsert, BY NAME (#1532 S0).
 * Pure of process/env/network: the CLI (provision-dashboards.mjs) supplies the real `io`,
 * the unit test supplies a fake. Returns { created, skipped, provisionedIds }; never exits.
 */
export async function provision(spec, io) {
  const dashboards = await io.listDashboards();
  const insights = await io.listInsights();
  const dashByName = new Map(dashboards.filter((d) => !d.deleted).map((d) => [d.name, d]));
  const insByName = new Map(insights.filter((i) => !i.deleted).map((i) => [i.name, i]));

  const created = { dashboards: 0, insights: 0 };
  const skipped = { dashboards: 0, insights: 0 };
  // Every `[PMO]` insight this run touched (created OR already-existing) — refreshed by the
  // caller so a freshly-provisioned dashboard never renders blank tiles (an upserted insight's
  // `result` stays null until something computes it).
  const provisionedIds = [];

  for (const entry of spec) {
    let dash = dashByName.get(entry.dashboard);
    if (!dash) {
      dash = await io.createDashboard({ name: entry.dashboard, description: entry.description });
      dashByName.set(entry.dashboard, dash); // a second entry with this name shares the dashboard
      created.dashboards++;
      io.log(`+ dashboard  ${entry.dashboard}  (id ${dash.id})`);
    } else {
      skipped.dashboards++;
      io.log(`= dashboard  ${entry.dashboard}  (id ${dash.id}, exists)`);
    }

    for (const ins of entry.insights) {
      const existing = insByName.get(ins.name);
      if (existing) {
        skipped.insights++;
        provisionedIds.push(existing.id);
        io.log(`  = insight  ${ins.name}  (exists)`);
        continue;
      }
      const made = await io.createInsight({ name: ins.name, query: ins.query, dashboards: [dash.id] });
      insByName.set(ins.name, made);
      created.insights++;
      provisionedIds.push(made.id);
      io.log(`  + insight  ${ins.name}  (id ${made.id})`);
    }
  }
  return { created, skipped, provisionedIds };
}
