// @e2e-isolation: self-isolated — owns the HR login, project, work orders and timesheet.
import { test, expect } from "@playwright/test";
import { cleanupAll, need, ok, ORG_ID, projectWithWorkOrders, runId, serviceClient } from "./support/jobFixtures";
import { roleJobUser } from "./support/roleJobUser";

test.setTimeout(120_000);

test("AC-TRW-001 HR reviews the work order attributed to each timesheet line", async ({ page }) => {
  const admin = serviceClient("JOB-HR-timesheet");
  const run = runId("hr-review");
  const hr = await roleJobUser(admin, "hr_officer", run);
  let projectId = "";
  let sheetId = "";
  let woIds: string[] = [];
  try {
    const fx = await projectWithWorkOrders(admin, run, ["Civil", "Piping"]);
    projectId = fx.projectId;
    woIds = fx.workOrders.map(w => w.id);
    sheetId = need("timesheet", await admin.from("timesheets").insert({ org_id: ORG_ID, user_id: hr.id, week_start_date: "2031-01-06", status: "Approved" }).select("id").single()).id;
    ok("entries", await admin.from("timesheet_entries").insert(fx.workOrders.map((wo, i) => ({ org_id: ORG_ID, timesheet_id: sheetId, project_id: projectId, work_order_id: wo.id, entry_date: ["2031-01-06", "2031-01-07"][i], hours: i + 3 }))));
    await hr.signIn(page);
    await page.goto(`/timesheets/review?person=${hr.id}`);
    await page.getByRole("button", { name: new RegExp(`Show entries for ${run}`) }).click();
    for (const wo of fx.workOrders) await expect(page.getByText(`${wo.number} · ${wo.title}`)).toBeVisible();
    await expect(page.getByRole("button", { name: /approve|return/i })).toHaveCount(0);
  } finally {
    await cleanupAll(admin, [["timesheets", "id", sheetId ? [sheetId] : []], ["work_orders", "id", woIds], ["projects", "id", projectId ? [projectId] : []]]);
    await hr.cleanup();
  }
});
