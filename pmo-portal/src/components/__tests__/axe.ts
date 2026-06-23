import axe from 'axe-core';

/**
 * Component-layer a11y regression net (charter DoD Gap 4 — WCAG-AA enforced).
 *
 * Runs axe-core against a rendered DOM node and returns only the violations that
 * are real WCAG-AA blockers — `critical` or `serious` impact. `moderate`/`minor`
 * findings are surfaced separately for visibility but do NOT fail the gate (yet),
 * matching the backlog scope: this is a regression NET for the show-stoppers, not
 * a zero-tolerance audit of every advisory rule.
 *
 * Usage:
 *   const { blocking } = await axeViolations(container);
 *   expect(blocking).toEqual([]);
 */

const BLOCKING_IMPACTS = new Set<axe.ImpactValue>(['critical', 'serious']);

export interface AxeResultSummary {
  /** critical + serious violations — these FAIL the gate. */
  blocking: { id: string; impact: axe.ImpactValue | null; help: string; nodes: number }[];
  /** moderate + minor violations — informational only (allowed for now). */
  advisory: { id: string; impact: axe.ImpactValue | null; help: string; nodes: number }[];
}

/**
 * Run axe on a node (RTL `container` or any HTMLElement). Resolves to a summary
 * split into blocking (critical/serious) vs advisory (moderate/minor) buckets so
 * the test can assert `blocking` is empty while still logging the rest.
 */
export async function axeViolations(node: HTMLElement): Promise<AxeResultSummary> {
  // Audit the provided node only (no full-document crawl), so each rendered
  // surface is checked in isolation. The `region` (landmark) rule is disabled:
  // component fragments rendered without an app <main> shell would always trip
  // it, which is a harness artefact, not a real surface defect.
  const results = await axe.run(node, {
    rules: { region: { enabled: false } },
  });

  const toEntry = (v: axe.Result) => ({
    id: v.id,
    impact: v.impact ?? null,
    help: v.help,
    nodes: v.nodes.length,
  });

  const blocking = results.violations
    .filter((v) => v.impact && BLOCKING_IMPACTS.has(v.impact))
    .map(toEntry);
  const advisory = results.violations
    .filter((v) => !v.impact || !BLOCKING_IMPACTS.has(v.impact))
    .map(toEntry);

  return { blocking, advisory };
}
