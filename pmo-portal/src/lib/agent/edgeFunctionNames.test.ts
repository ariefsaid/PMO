/**
 * FR-OBS-002 — the `EdgeFunctionName` union is the blocking seam for the whole observability floor:
 * a function not in it CANNOT call logStructuredError without a type error. It listed 5 names while
 * 22 functions were deployed, so 17 functions were structurally unable to report anything.
 *
 * This test compares the union's backing array against the ACTUAL directory listing, so the gap
 * cannot silently reopen when the 23rd function ships.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { EDGE_FUNCTION_NAMES } from '../../../../supabase/functions/_shared/errorLog';

const FUNCTIONS_DIR = resolve(__dirname, '../../../../supabase/functions');

function deployedFunctionDirs(): string[] {
  return readdirSync(FUNCTIONS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith('_'))
    .filter((d) => existsSync(resolve(FUNCTIONS_DIR, d.name, 'index.ts')))
    .map((d) => d.name)
    .sort();
}

describe('EdgeFunctionName', () => {
  it('AC-OBS-002: enumerates EVERY deployed edge function, not a subset', () => {
    expect([...EDGE_FUNCTION_NAMES].sort()).toEqual(deployedFunctionDirs());
  });
});
