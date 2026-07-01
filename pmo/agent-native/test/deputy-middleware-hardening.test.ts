/**
 * Deputy middleware hardening (M-1) — unit test.
 *
 * The deputy middleware wraps the inbound JWT verification. If `verifyJwt`
 * THROWS (transient auth-host failure: network blip, GoTrue 5xx, DNS) the
 * middleware must DEGRADE the request to anonymous (call `next()`) rather than
 * propagate the throw and 500-storm every authenticated request. Invalid JWTs
 * (verifyJwt → null) already degrade; this covers the throw path.
 *
 * Drives the middleware directly with module mocks (no Nitro boot): h3
 * `getHeader` is stubbed to feed a Bearer, `verifyJwt` is the unit under
 * variation, and `runWithDeputy` is stubbed to observe whether the deputy scope
 * is entered. Vitest isolates this file's module registry from the gate tests
 * (which boot the real sidecar), so the mocks do not leak.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

// h3: stub getHeader so we can feed a Bearer without constructing a real H3Event.
vi.mock("h3", async (importOriginal) => {
  const actual = await importOriginal<typeof import("h3")>();
  return { ...actual, getHeader: vi.fn(() => "Bearer fake-caller-jwt") };
});

// deputy-store: observe whether the deputy scope is entered.
const runWithDeputyMock = vi.fn((_ctx: unknown, fn: () => unknown) => fn());
vi.mock("../server/lib/deputy-store", () => ({
  runWithDeputy: runWithDeputyMock,
}));

// supabase: verifyJwt is the unit under variation (resolved/throws per test).
const verifyJwtMock = vi.fn();
vi.mock("../server/lib/supabase", () => ({ verifyJwt: verifyJwtMock }));

const { default: deputyMiddleware } = await import("../server/middleware/deputy");
const { getHeader } = await import("h3");

type NextFlag = { value: boolean };
function makeNext(flag: NextFlag) {
  return () => {
    flag.value = true;
    return undefined;
  };
}
const getHeaderMock = vi.mocked(getHeader);

describe("deputy middleware hardening (M-1)", () => {
  beforeEach(() => {
    verifyJwtMock.mockReset();
    runWithDeputyMock.mockClear();
    getHeaderMock.mockReturnValue("Bearer fake-caller-jwt");
  });

  it("degrades to anonymous when verifyJwt THROWS — no throw, no deputy scope, next() called", async () => {
    // Simulate a transient auth-host failure.
    verifyJwtMock.mockRejectedValue(new Error("auth host unreachable"));

    const flag: NextFlag = { value: false };
    // The load-bearing assertion: the middleware MUST NOT propagate the throw
    // (a throw here would surface as a 500 to every authenticated caller).
    await expect(deputyMiddleware({} as never, makeNext(flag))).resolves.toBeUndefined();
    expect(flag.value, "next() must be called so the request degrades to anonymous").toBe(true);
    expect(runWithDeputyMock, "must NOT enter the deputy scope when verifyJwt throws").not.toHaveBeenCalled();
  });

  it("still verifies + enters deputy scope when verifyJwt resolves a caller (happy path intact)", async () => {
    verifyJwtMock.mockResolvedValue({ userId: "u1", email: "e@x.test", orgId: null, role: null });

    const flag: NextFlag = { value: false };
    await deputyMiddleware({} as never, makeNext(flag));

    expect(flag.value, "next() must be called").toBe(true);
    expect(runWithDeputyMock, "must enter the deputy scope for a verified caller").toHaveBeenCalledTimes(1);
  });

  it("leaves anonymous (no deputy scope) when verifyJwt resolves null", async () => {
    verifyJwtMock.mockResolvedValue(null);

    const flag: NextFlag = { value: false };
    await deputyMiddleware({} as never, makeNext(flag));

    expect(flag.value, "next() must be called").toBe(true);
    expect(runWithDeputyMock, "must NOT enter the deputy scope for an invalid jwt").not.toHaveBeenCalled();
  });

  it("leaves anonymous without calling verifyJwt when there is no Bearer header", async () => {
    getHeaderMock.mockReturnValue(undefined as unknown as string);
    verifyJwtMock.mockResolvedValue({ userId: "u1", email: "e@x.test", orgId: null, role: null });

    const flag: NextFlag = { value: false };
    await deputyMiddleware({} as never, makeNext(flag));

    expect(flag.value).toBe(true);
    expect(verifyJwtMock, "must short-circuit before verifyJwt when no Bearer").not.toHaveBeenCalled();
    expect(runWithDeputyMock).not.toHaveBeenCalled();
  });
});
