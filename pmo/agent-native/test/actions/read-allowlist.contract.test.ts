/**
 * Read-allowlist parity contract (M-2).
 *
 * `server/lib/read-allowlist.ts` is a sidecar-LOCAL copy of (a subset of) PMO's
 * `ENTITY_WHITELIST` (projects + companies column sets), so the sidecar no
 longer reaches across the package boundary at
 `../../../../pmo-portal/src/lib/viewspec/types`. A local copy can drift from
 * the source of truth; this test pins the parity — if PMO widens/narrows the
 * projects or companies column set (or table) without updating the sidecar
 * copy, CI fails here.
 *
 * This is the ONLY place the sidecar imports PMO's viewspec types — by design,
 * as the drift guard. Production code under server/actions/* must NOT add the
 * cross-package import back (AC-607 allows it but M-2 removes the need).
 */
import { describe, expect, it } from "vitest";
import { READ_ENTITY_MAP, AGENT_READ_ENTITIES } from "../../server/lib/read-allowlist";
// PMO source of truth — the deep cross-package import lives ONLY in this test.
import { ENTITY_WHITELIST } from "../../../../pmo-portal/src/lib/viewspec/types";

describe("AC-404 read-allowlist parity (M-2)", () => {
  // Every entity the sidecar exposes for read must match PMO's whitelist entry.
  it.each(AGENT_READ_ENTITIES)("sidecar %s column set + table match PMO ENTITY_WHITELIST", (entity) => {
    const pmo = ENTITY_WHITELIST[entity];
    const sidecar = READ_ENTITY_MAP[entity];

    expect(pmo, `PMO ENTITY_WHITELIST must define ${entity}`).toBeDefined();
    expect(sidecar, `sidecar READ_ENTITY_MAP must define ${entity}`).toBeDefined();

    // Table parity.
    expect(sidecar.table, `${entity} table must match`).toBe(pmo.table);

    // Column-set parity (the whole point — no silent drift either direction).
    const pmoCols = [...pmo.allowedColumns].sort();
    const sidecarCols = [...sidecar.allowedColumns].sort();
    expect(sidecarCols, `${entity}: sidecar columns drifted from PMO whitelist`).toEqual(pmoCols);
  });

  it("the sidecar read surface is exactly projects + companies (no wider)", () => {
    // Guard against silently widening the agent read surface: the keys of
    // READ_ENTITY_MAP must be exactly the documented allow-list.
    expect([...Object.keys(READ_ENTITY_MAP)].sort()).toEqual([...AGENT_READ_ENTITIES].sort());
  });
});
