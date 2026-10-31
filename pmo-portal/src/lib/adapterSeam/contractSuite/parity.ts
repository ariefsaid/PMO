import type { Declaration, TierWorkflows, WorkflowId } from '../connect/workflows.ts';

type Registry = Readonly<Record<string, { version: number }>>;
type Suites = Readonly<Partial<Record<string, unknown>>>;

/** One line per way a tier's declarations fall out of step with the registry; empty means in parity. */
export function parityProblems(
  tiers: Readonly<Record<string, TierWorkflows>>,
  workflows: Registry,
  suites: Suites,
): string[] {
  const problems: string[] = [];
  for (const [tier, declared] of Object.entries(tiers)) {
    for (const [id, current] of Object.entries(workflows)) {
      const d = (declared as Partial<Record<string, Declaration>>)[id];
      if (!d) { problems.push(`${tier} ${id}: no declaration`); continue; }
      if (d.version !== current.version) {
        problems.push(`${tier} ${id}: pins v${d.version}, current is v${current.version}`);
      }
      if (d.status === 'supported' && !suites[id as WorkflowId]) problems.push(`${tier} ${id}: supported but there is no shared suite`);
      if (d.status === 'unavailable' && !d.reason.trim()) problems.push(`${tier} ${id}: unavailable without a reason`);
      if (d.status === 'pending' && !(Number.isInteger(d.issue) && d.issue > 0)) problems.push(`${tier} ${id}: pending without an issue number`);
    }
  }
  return problems;
}

/** A tier is on disk (`adapterSeam/<tier>/workflowDeclarations.ts`), registered with declarations, and has a
 *  harness: all three or the gate does not cover it. One line per gap; empty means every tier is covered. */
export function tierRegistrationProblems(onDisk: readonly string[], declared: readonly string[], harnessed: readonly string[]): string[] {
  const problems: string[] = [];
  for (const tier of onDisk) {
    if (!declared.includes(tier)) problems.push(`${tier}: has workflowDeclarations.ts but is not in TIER_WORKFLOWS`);
  }
  for (const tier of declared) {
    if (!onDisk.includes(tier)) problems.push(`${tier}: in TIER_WORKFLOWS but has no workflowDeclarations.ts`);
    if (!harnessed.includes(tier)) problems.push(`${tier}: in TIER_WORKFLOWS but has no harness in TIER_HARNESSES`);
  }
  for (const tier of harnessed) {
    if (!declared.includes(tier)) problems.push(`${tier}: has a harness but is not in TIER_WORKFLOWS`);
  }
  return problems;
}

/** The shared runner must register at least one test for every supported workflow of every tier. */
export function suiteRunProblems(
  tiers: Readonly<Record<string, TierWorkflows>>,
  registered: ReadonlyArray<{ tier: string; id: string; tests: number }>,
): string[] {
  const problems: string[] = [];
  for (const [tier, declared] of Object.entries(tiers)) {
    for (const [id, d] of Object.entries(declared)) {
      if (d.status !== 'supported') continue;
      const run = registered.find((r) => r.tier === tier && r.id === id);
      if (!run) problems.push(`${tier} ${id}: supported but its suite was not run`);
      else if (run.tests === 0) problems.push(`${tier} ${id}: its suite registered no tests`);
    }
  }
  return problems;
}
