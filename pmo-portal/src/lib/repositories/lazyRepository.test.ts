import { describe, expect, it, vi } from "vitest";
const h = vi.hoisted(() => ({ loaded: vi.fn(), list: vi.fn(async (id: string) => [id]), unrelated: vi.fn(), units: vi.fn(async () => ["unit"]), files: vi.fn(async () => []), open: vi.fn(async () => []), tags: vi.fn(async () => []), end: vi.fn(async () => ({ ok: true })) }));
vi.mock("./projects", () => { h.loaded(); return { projectRepository: { list: h.list } }; });
vi.mock("./financialStatements", () => { h.unrelated(); return { financialStatementsRepository: {} }; });
vi.mock("./stock", () => ({ stockRepository: { master: { listUnits: h.units, listItemTagNames: h.tags } } }));
vi.mock("./thirdPartyInspections", () => ({ thirdPartyInspectionRepository: { listFilesBatch: h.files } }));
vi.mock("./workOrders", () => ({ workOrderRepository: { listOpenForHome: h.open } }));
vi.mock("./equipmentAvailability", () => ({ equipmentAvailabilityRepository: { endRentalTerm: h.end } }));
import { repositories } from "./index";
describe("on-demand repository domains", () => {
 it("forwards combined inspection, home and rental methods", async () => {
  expect(await repositories.thirdPartyInspection.listFilesBatch(["inspection"])).toEqual([]);
  expect(h.files).toHaveBeenCalledWith(["inspection"]);
  expect(await repositories.workOrder.listOpenForHome()).toEqual([]);
  expect(h.open).toHaveBeenCalledWith();
  expect(await repositories.stock.master.listItemTagNames()).toEqual([]);
  expect(h.tags).toHaveBeenCalledWith();
  expect(await repositories.equipmentAvailability.endRentalTerm("term", "2026-11-27")).toEqual({ ok: true });
  expect(h.end).toHaveBeenCalledWith("term", "2026-11-27");
 });
 it("retains nested repository objects and forwards their calls", async () => {
  expect(Object.keys(repositories.stock.master)).toContain("listUnits");
  expect(h.units).not.toHaveBeenCalled();
  expect(await repositories.stock.master.listUnits(true)).toEqual(["unit"]);
  expect(h.units).toHaveBeenCalledWith(true);
 });
 it("loads only the called domain and preserves arguments, results and method keys", async () => {
  expect(h.loaded).not.toHaveBeenCalled();
  expect(Object.keys(repositories.project)).toContain("list");
  const params = { pmId: "sample" };
  expect(await repositories.project.list(params)).toEqual([params]);
  expect(h.loaded).toHaveBeenCalledTimes(1);
  expect(h.list).toHaveBeenCalledWith(params);
  expect(h.unrelated).not.toHaveBeenCalled();
  const error = new Error("domain failure");
  h.list.mockRejectedValueOnce(error);
  await expect(repositories.project.list(params)).rejects.toBe(error);
  expect(h.loaded).toHaveBeenCalledTimes(1);
 });
});
