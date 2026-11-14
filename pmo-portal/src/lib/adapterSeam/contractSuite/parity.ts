import type { Declaration, TierWorkflows, WorkflowId } from '../connect/workflows.ts';
import type { Suite } from './harness.ts';

type Registry = Readonly<Record<string, { version: number }>>;
type Suites = Readonly<Partial<Record<string, unknown>>>;

export type TierScopedSuiteDisposition =
  | { status: 'run'; suite: Suite }
  | { status: 'not-applicable'; reason: string };

export type TierScopedSuiteRegistry = Readonly<Record<string, {
  workflow: WorkflowId;
  byTier: Readonly<Record<string, TierScopedSuiteDisposition>>;
}>>;

export type TierScopedSuiteRegistration =
  | { tier: string; workflow: WorkflowId; suiteId: string; status: 'ran'; tests: number }
  | { tier: string; workflow: WorkflowId; suiteId: string; status: 'not-applicable'; reason: string };

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

/** Every tier-specific contract is either run with tests or explicitly counted as not applicable with a reason. */
export function tierScopedSuiteProblems(
  tiers: Readonly<Record<string, TierWorkflows>>,
  registry: TierScopedSuiteRegistry,
  registered: readonly TierScopedSuiteRegistration[],
): string[] {
  const problems: string[] = [];
  const expected = new Set<string>();
  for (const [suiteId, definition] of Object.entries(registry)) {
    for (const [tier, workflows] of Object.entries(tiers)) {
      const key = `${tier}.${suiteId}`;
      expected.add(key);
      const workflow = (workflows as Partial<Record<WorkflowId, Declaration>>)[definition.workflow];
      if (!workflow || workflow.status !== 'supported') {
        problems.push(`${tier} ${suiteId}: scoped suite workflow ${definition.workflow} is not supported`);
      }
      const disposition = definition.byTier[tier];
      if (!disposition) {
        problems.push(`${tier} ${suiteId}: no applicability declaration`);
        continue;
      }
      const runs = registered.filter((record) => record.tier === tier && record.suiteId === suiteId);
      if (disposition.status === 'not-applicable') {
        if (!disposition.reason.trim()) problems.push(`${tier} ${suiteId}: not-applicable declaration has no reason`);
        if (runs.length !== 1 || runs[0]?.status !== 'not-applicable' || runs[0].reason !== disposition.reason) {
          problems.push(`${tier} ${suiteId}: not-applicable entry was not counted`);
        }
        continue;
      }
      if (typeof disposition.suite !== 'function') problems.push(`${tier} ${suiteId}: run disposition has no suite`);
      if (runs.length !== 1 || runs[0]?.status !== 'ran') {
        problems.push(`${tier} ${suiteId}: applicable suite was not run exactly once`);
      } else if (runs[0].tests === 0) {
        problems.push(`${tier} ${suiteId}: applicable suite registered no tests`);
      }
    }
    for (const tier of Object.keys(definition.byTier)) {
      if (!tiers[tier]) problems.push(`${tier} ${suiteId}: applicability declared for an unregistered tier`);
    }
  }
  for (const record of registered) {
    if (!expected.has(`${record.tier}.${record.suiteId}`)) {
      problems.push(`${record.tier} ${record.suiteId}: registration has no scoped suite entry`);
    }
  }
  return problems;
}
