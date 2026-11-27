import { describe, expect, it, vi } from "vitest";
const h = vi.hoisted(() => ({ loaded: vi.fn(), list: vi.fn(async (id: string) => [id]), unrelated: vi.fn() }));
vi.mock("./projects", () => { h.loaded(); return { projectRepository: { list: h.list } }; });
vi.mock("./financialStatements", () => { h.unrelated(); return { financialStatementsRepository: {} }; });
import { repositories } from "./index";
describe("on-demand repository domains", () => {
 it("loads only the called domain and preserves arguments, results and method keys", async () => {
  expect(h.loaded).not.toHaveBeenCalled();
  expect(Object.keys(repositories.project)).toContain("list");
  const params = { search: "sample" };
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
