import * as projectMatchReview from './projectMatchReview';
import type { ErpProjectOption } from './types';

type Proposal = {
  projectId: string;
  state: 'proposed' | 'ambiguous' | 'unresolved';
  candidateId: string | null;
  candidateIds: string[];
};
type ProposeProjectMatches = (
  projects: readonly { id: string; name: string; code: string | null }[],
  candidates: readonly ErpProjectOption[],
  complete: boolean,
) => Proposal[];
const exported = projectMatchReview as typeof projectMatchReview & {
  proposeProjectMatches?: ProposeProjectMatches;
};

const project = (id: string, name: string, code: string | null) => ({
  id,
  name,
  code,
});
const candidate = (name: string, project_name: string): ErpProjectOption => ({
  name,
  project_name,
  company: 'Example Company',
  is_active: 'Yes',
});

describe('AC-S09-002 exact ERP Project match proposals', () => {
  it('prefers one exact PMO code match over a project-name match', () => {
    expect(exported.proposeProjectMatches?.(
      [project('project-1', 'Delivery Alpha', 'PMO-ALPHA')],
      [
        candidate('PMO-ALPHA', 'Different ERP Name'),
        candidate('ERP-NAME-MATCH', 'Delivery Alpha'),
      ],
      true,
    )).toEqual([{
      projectId: 'project-1',
      state: 'proposed',
      candidateId: 'PMO-ALPHA',
      candidateIds: ['PMO-ALPHA'],
    }]);
  });

  it('uses one exact trimmed PMO name match only when the code has no match', () => {
    expect(exported.proposeProjectMatches?.(
      [project('project-2', '  Delivery Beta  ', 'PMO-MISSING')],
      [candidate('ERP-BETA', 'Delivery Beta')],
      true,
    )).toEqual([{
      projectId: 'project-2',
      state: 'proposed',
      candidateId: 'ERP-BETA',
      candidateIds: ['ERP-BETA'],
    }]);
  });

  it('keeps multiple exact code matches ambiguous without falling back to name', () => {
    expect(exported.proposeProjectMatches?.(
      [project('project-3', 'Delivery Gamma', 'PMO-GAMMA')],
      [
        candidate('ERP-GAMMA-A', 'Delivery Gamma'),
        candidate('ERP-GAMMA-B', 'Delivery Gamma'),
      ],
      true,
    )).toEqual([{
      projectId: 'project-3',
      state: 'ambiguous',
      candidateId: null,
      candidateIds: ['ERP-GAMMA-A', 'ERP-GAMMA-B'],
    }]);
  });

  it('keeps multiple exact name matches ambiguous', () => {
    expect(exported.proposeProjectMatches?.(
      [project('project-4', 'Delivery Delta', null)],
      [
        candidate('ERP-DELTA-A', 'Delivery Delta'),
        candidate('ERP-DELTA-B', 'Delivery Delta'),
      ],
      true,
    )).toEqual([{
      projectId: 'project-4',
      state: 'ambiguous',
      candidateId: null,
      candidateIds: ['ERP-DELTA-A', 'ERP-DELTA-B'],
    }]);
  });

  it('deduplicates the same ERP identity returned by separate searches', () => {
    const sameIdentity = candidate('ERP-EPSILON', 'Delivery Epsilon');
    expect(exported.proposeProjectMatches?.(
      [project('project-5', 'Delivery Epsilon', 'ERP-EPSILON')],
      [sameIdentity, { ...sameIdentity }],
      true,
    )).toEqual([{
      projectId: 'project-5',
      state: 'proposed',
      candidateId: 'ERP-EPSILON',
      candidateIds: ['ERP-EPSILON'],
    }]);
  });

  it('does not turn case differences or fuzzy names into identity', () => {
    expect(exported.proposeProjectMatches?.(
      [project('project-6', 'Delivery Zeta', 'PMO-ZETA')],
      [candidate('pmo-zeta', 'Delivery Zeta Project')],
      true,
    )).toEqual([{
      projectId: 'project-6',
      state: 'unresolved',
      candidateId: null,
      candidateIds: [],
    }]);
  });

  it('does not propose a match from an incomplete capped candidate set', () => {
    expect(exported.proposeProjectMatches?.(
      [project('project-7', 'Delivery Eta', 'PMO-ETA')],
      [candidate('PMO-ETA', 'Delivery Eta')],
      false,
    )).toEqual([{
      projectId: 'project-7',
      state: 'unresolved',
      candidateId: null,
      candidateIds: ['PMO-ETA'],
    }]);
  });
});
