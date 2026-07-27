/**
 * Unit coverage for the pure parsing/matching helpers behind scripts/check-dashboard-tiles.mjs
 * (FR-PHG-013, AC-PHG-013, ADR-0067). SECURITY (2026-07-27 review round 2 #7): two integrity
 * gaps in "the gate that can't go red" class this program keeps hitting:
 *
 *   1. `tileEvents` extraction only matched single-quoted lowercase `event: '…'` — a tile written
 *      with double quotes or a template literal was never scanned, while `tileEvents.size > 0`
 *      still reported green (catches TOTAL parse failure, not SELECTIVE invisibility).
 *   2. The call-site proof was a bare-identifier substring match over concatenated sources, so a
 *      mention in a COMMENT (no real call) satisfied it.
 */
import { describe, it, expect } from 'vitest';
import { extractTileEvents, extractRegistry, hasCallSite } from '../../../../scripts/check-dashboard-tiles.mjs';

describe('extractTileEvents — quoting coverage (SECURITY #7)', () => {
  it('finds a single-quoted event (the existing, already-covered shape)', () => {
    const src = `query: trend([{ event: 'save_failed' }])`;
    expect(extractTileEvents(src)).toEqual(new Set(['save_failed']));
  });

  it('SECURITY: finds a DOUBLE-quoted event — previously invisible to the gate', () => {
    const src = `query: trend([{ event: "save_failed" }])`;
    expect(extractTileEvents(src)).toEqual(new Set(['save_failed']));
  });

  it('SECURITY: finds a TEMPLATE-LITERAL-quoted event — previously invisible to the gate', () => {
    const src = 'query: trend([{ event: `save_failed` }])';
    expect(extractTileEvents(src)).toEqual(new Set(['save_failed']));
  });

  it('SECURITY: finds mixed-quote-style events inside a funnel([...]) array', () => {
    const src = `funnel(["demo_persona_selected", 'auth_login_succeeded', \`app_route_viewed\`])`;
    expect(extractTileEvents(src)).toEqual(
      new Set(['demo_persona_selected', 'auth_login_succeeded', 'app_route_viewed']),
    );
  });
});

describe('extractRegistry — unchanged shape (registry stays single-quoted TS source)', () => {
  it('parses producer + kind for a registry entry', () => {
    const src = `  save_failed:               { producer: 'trackSaveFailed',            kind: 'facade' },\n`;
    expect(extractRegistry(src)).toEqual(
      new Map([['save_failed', { producer: 'trackSaveFailed', kind: 'facade' }]]),
    );
  });
});

describe('hasCallSite — requires a real CALL shape, not a bare mention (SECURITY #7)', () => {
  it('SECURITY: a producer name appearing ONLY in a comment (no call) is NOT a call site', () => {
    const sources = `// trackSaveFailed exists in the analytics facade but nothing calls it here\nconst x = 1;`;
    expect(hasCallSite(sources, 'trackSaveFailed')).toBe(false);
  });

  it('a genuine call site (identifier immediately followed by an open paren) IS a call site', () => {
    const sources = `classifyMutationError(err); trackSaveFailed('a', 'b', 'c', 'd');`;
    expect(hasCallSite(sources, 'trackSaveFailed')).toBe(true);
  });

  it('a call site with whitespace before the paren still counts', () => {
    const sources = `trackSaveFailed ('a', 'b', 'c', 'd');`;
    expect(hasCallSite(sources, 'trackSaveFailed')).toBe(true);
  });
});
