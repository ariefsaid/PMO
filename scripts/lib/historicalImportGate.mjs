/**
 * historicalImportGate.mjs — arg parsing + the org-id/typed-confirm refusal gate
 * (FR-HIST-001, HIST-E002). Pure — no process.exit, no I/O; import-historical.mjs
 * decides what to do with the parsed/validated result.
 */
import { randomUUID } from 'node:crypto';

export function parseArgs(argv) {
  const get = (flag) => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  return {
    orgId: get('--org-id') ?? null,
    file: get('--file') ?? null,
    batchId: get('--batch-id') ?? randomUUID(),
    markProvenance: argv.includes('--mark-provenance'),
    strictRefs: argv.includes('--strict-refs'),
  };
}

export function requireOrgConfirmed({ resolvedOrgName, typedConfirmation }) {
  return { ok: resolvedOrgName === typedConfirmation };
}
