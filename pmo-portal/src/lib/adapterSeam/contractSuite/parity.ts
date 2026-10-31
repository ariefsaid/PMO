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
