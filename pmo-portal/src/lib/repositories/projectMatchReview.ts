import type { ErpProjectOption } from './types';

export interface ProjectMatchProposal {
  projectId: string;
  state: 'proposed' | 'ambiguous' | 'unresolved';
  candidateId: string | null;
  candidateIds: string[];
}

type ProjectMatchInput = { id: string; name: string; code: string | null };

/** Proposes stable exact ERP identities without writing or guessing. */
export function proposeProjectMatches(
  projects: readonly ProjectMatchInput[],
  candidates: readonly ErpProjectOption[],
  complete: boolean,
): ProjectMatchProposal[] {
  const projectNamesByErpId = new Map<string, Set<string>>();
  for (const candidate of candidates) {
    const erpId = candidate.name.trim();
    const projectName = candidate.project_name.trim();
    if (!erpId) continue;
    const names = projectNamesByErpId.get(erpId) ?? new Set<string>();
    if (projectName) names.add(projectName);
    projectNamesByErpId.set(erpId, names);
  }

  const candidateIds = [...projectNamesByErpId.keys()].sort();
  return projects.map((project) => {
    const code = project.code?.trim() ?? '';
    const name = project.name.trim();
    const codeMatches = code
      ? candidateIds.filter((id) => id === code)
      : [];
    const matches = codeMatches.length
      ? codeMatches
      : candidateIds.filter((id) =>
        projectNamesByErpId.get(id)?.has(name) ?? false
      );

    if (matches.length > 1) {
      return {
        projectId: project.id,
        state: 'ambiguous',
        candidateId: null,
        candidateIds: matches,
      };
    }
    if (matches.length === 1 && complete) {
      return {
        projectId: project.id,
        state: 'proposed',
        candidateId: matches[0],
        candidateIds: matches,
      };
    }
    return {
      projectId: project.id,
      state: 'unresolved',
      candidateId: null,
      candidateIds: matches,
    };
  });
}
