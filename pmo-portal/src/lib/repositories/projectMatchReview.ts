import { proposeMatches } from '../adapterSeam/connect/match.ts';
import type { ErpProjectOption } from './types';

export interface ProjectMatchProposal {
  projectId: string;
  state: 'proposed' | 'ambiguous' | 'unresolved';
  candidateId: string | null;
  candidateIds: string[];
}

type ProjectMatchInput = { id: string; name: string; code: string | null };

/** Proposes stable exact ERP identities without writing or guessing. The pairing is the shared matcher (ECA-2); the
 *  exact-case rule of AC-S09-002 stays here: a link the matcher found only by folding case is not an identity. */
export function proposeProjectMatches(
  projects: readonly ProjectMatchInput[],
  candidates: readonly ErpProjectOption[],
  complete: boolean,
): ProjectMatchProposal[] {
  const erpNameById = new Map<string, string>();
  for (const candidate of candidates) {
    const erpId = candidate.name.trim();
    if (erpId && !erpNameById.has(erpId)) erpNameById.set(erpId, candidate.project_name.trim());
  }
  const erp = [...erpNameById].map(([id, name]) => ({ kind: 'project' as const, externalId: id, code: id, name, active: true }));
  const byProject = new Map<string, ProjectMatchProposal>();
  const unresolved = (projectId: string): ProjectMatchProposal => ({ projectId, state: 'unresolved', candidateId: null, candidateIds: [] });
  const take = (outcomes: ReturnType<typeof proposeMatches>) => {
    for (const o of outcomes) {
      if (o.outcome === 'review') {
        for (const projectId of o.pmoIds) byProject.set(projectId, { projectId, state: 'ambiguous', candidateId: null, candidateIds: o.externalIds });
      } else if (o.outcome === 'link') {
        const project = projects.find((p) => p.id === o.pmoId)!;
        const exact = o.key === 'code' ? project.code?.trim() === o.externalId : project.name.trim() === erpNameById.get(o.externalId);
        byProject.set(o.pmoId, exact
          ? { projectId: o.pmoId, state: complete ? 'proposed' : 'unresolved', candidateId: complete ? o.externalId : null, candidateIds: [o.externalId] }
          : unresolved(o.pmoId));
      }
    }
  };
  // AC-S09-002: the PMO code decides first; the name is consulted only for a project the code did not claim at all.
  // A code that matches only by case is `unresolved` and is not retried by name (v1 fell back to the name): deliberately more conservative.
  take(proposeMatches('project', projects.filter((p) => p.code?.trim()).map((p) => ({ id: p.id, name: '', code: p.code })),
    erp.map((e) => ({ ...e, name: '' }))));
  const rest = projects.filter((p) => !byProject.has(p.id));
  take(proposeMatches('project', rest.map((p) => ({ id: p.id, name: p.name })), erp.map((e) => ({ ...e, code: null }))));
  return projects.map((p) => byProject.get(p.id) ?? unresolved(p.id));
}
