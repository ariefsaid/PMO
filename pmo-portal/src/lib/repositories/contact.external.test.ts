import { beforeEach, describe, expect, it, vi } from "vitest";
const h = vi.hoisted(() => {
  const row = {
    id: "contact-1",
    company_id: "company-1",
    full_name: "Example Contact",
    email: "contact@example.test",
    phone: "000-001",
    title: null,
    notes: null,
    erp_modified: null,
  };
  const b: Record<string, unknown> = {};
  const insert = vi.fn(() => b);
  b.insert = insert;
  b.select = () => b;
  b.single = () => b;
  b.then = (resolve: (value: unknown) => unknown) =>
    resolve({ data: row, error: null });
  return {
    insert,
    from: vi.fn(() => b),
    invoke: vi.fn(async () => ({
      data: { externalRecordId: "CON-1", canonical: row },
      error: null,
    })),
  };
});
vi.mock(
  "@/src/lib/supabase/client",
  () => ({ supabase: { from: h.from, functions: { invoke: h.invoke } } }),
);
import { repositories } from "./index";
import {
  clearOwnershipCache,
  setDomainOwnership,
} from "@/src/lib/adapterSeam/ownershipCache";
beforeEach(() => {
  vi.clearAllMocks();
  clearOwnershipCache();
});
describe("contact repository routing", () => {
  const input = {
    company_id: "company-1",
    full_name: "Example Contact",
    email: "contact@example.test",
    phone: "000-001",
    title: "Example role",
    notes: "Example note",
  };
  it("AC-CON-003 connected contact creation uses the companies command path and never inserts locally", async () => {
    setDomainOwnership([{ domain: "companies", externalTier: "erpnext" }]);
    await repositories.contact.create(input);
    expect(h.invoke).toHaveBeenCalledWith(
      "adapter-dispatch",
      expect.objectContaining({
        body: expect.objectContaining({
          domain: "companies",
          operation: "create",
          record: expect.objectContaining({
            ...input,
            erp_doc_kind: "contact",
          }),
        }),
      }),
    );
    expect(h.insert).not.toHaveBeenCalled();
  });
  it("standalone contact creation remains native", async () => {
    await repositories.contact.create(input);
    expect(h.invoke).not.toHaveBeenCalled();
    expect(h.insert).toHaveBeenCalledWith(input);
  });
});
