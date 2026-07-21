/**
 * WIRE 2 + WIRE 4 — the dispatch ENTRY POINT actually calls the guards that were otherwise inert.
 *
 * `supabase/functions/adapter-dispatch/index.ts` is integration-only by contract: its handler is
 * registered inside a top-level `Deno.serve` and every gate before the ones under test needs a real
 * signed JWT + JWKS + Supabase. Its behavior is therefore proven by the pure guards it delegates to
 * (`projectGateGuard.test.ts`, `authGuard.test.ts`, `dispatch.money.test.ts`) plus the served-fn money
 * e2e. What NONE of those can catch is the exact defect this task exists to fix: a guard that is fully
 * proven and simply NEVER CALLED — `checkSiProjectGate` shipped with no caller, so a project-less Sales
 * Invoice could still be SUBMITTED and post revenue to the ERP GL with no project dimension
 * (FR-SAR-191), and the 0116 one-in-flight index surfaced as a raw 500 naming the index.
 *
 * These assertions are about the WIRING, read from the entry point's own source — the same idiom as
 * `handlerDeputyInvariant.test.ts` (which scans the agent-chat handler source for the deputy invariant)
 * and `erpnext/submitClearanceTtl.test.ts` (which asserts a constant relationship against the migration
 * that declares it). It lives under `src/lib/` per the repo's handler-unit-test convention: there is no
 * Vitest project rooted in `supabase/`.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const INDEX = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), '../../../../supabase/functions/adapter-dispatch/index.ts'),
  'utf8',
);
/** The same source with comments stripped — a rule may be DESCRIBED in prose without being inlined. */
const CODE = INDEX.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('WIRE 2: the SI project gate is wired into the dispatch entry point', () => {
  it('index.ts imports AND awaits checkSiProjectGate (the guard is not inert)', () => {
    expect(INDEX).toMatch(/import \{[^}]*checkSiProjectGate[^}]*\} from '\.\/projectGateGuard\.ts'/);
    expect(
      /await checkSiProjectGate\(/.test(CODE),
      'an imported-but-uncalled gate lets a project-less SI submit post revenue with no project dimension',
    ).toBe(true);
  });

  it("a gate refusal is returned with the guard's own status and message (never swallowed)", () => {
    const call = CODE.slice(CODE.indexOf('await checkSiProjectGate('));
    const block = call.slice(0, call.indexOf('\n  }\n') + 5);
    expect(block).toMatch(/if \(!projectGate\.ok\)/);
    expect(block).toMatch(/status: projectGate\.status/);
    expect(block).toMatch(/message: projectGate\.message/);
  });

  it('the inline half-rule is GONE — one authority for the gate, never two', () => {
    // The shipped copy read `get_process_gates` itself and covered ONLY the body-building operations
    // (create/update/amend), which is precisely why submit was unguarded.
    expect(CODE).not.toContain('require_project_on_si');
    expect(CODE).not.toContain('get_process_gates');
    // The body-building predicate is the guard's own scoping concern; an unused import here is dead weight.
    expect(CODE).not.toContain('buildsSalesInvoiceBody');
  });
});

describe('WIRE 4: the in-flight-for-record conflict is mapped to 409', () => {
  it('index.ts imports the classified code from dispatch.ts (never re-spells the string)', () => {
    expect(INDEX).toMatch(/import \{[^}]*COMMAND_IN_FLIGHT_FOR_RECORD[^}]*\} from '[^']*\/dispatch\.ts'/);
  });

  it('a second concurrent create for one PMO record answers 409, not a raw 500', () => {
    const mapping = CODE.slice(CODE.indexOf('const status = appError.code'));
    const statusExpr = mapping.slice(0, mapping.indexOf(';'));
    expect(statusExpr).toContain('COMMAND_IN_FLIGHT_FOR_RECORD');
    expect(statusExpr).toMatch(/COMMAND_IN_FLIGHT_FOR_RECORD[\s\S]{0,40}409/);
  });
});
