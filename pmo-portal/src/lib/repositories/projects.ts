/** Project repository implementation (ADR-0017 seam). */
import {
  listProjects,
  listProjectsByClient,
  getProject,
  createProject,
  updateProjectHeader,
  archiveProject,
  deleteProject,
  setProjectContractValue,
  getProjectVatEditability,
  listProjectIdentity,
  proposeProjectNumber,
} from '@/src/lib/db/projects';
import { getOpportunity, getOpportunitiesByIds } from '@/src/lib/db/opportunity';
import { getProjectWinEligibility, transitionProject, listPipelineStageConfig } from '@/src/lib/db/projectTransitions';
import { wrap } from './repositoryErrors';
import type { ProjectRepository } from './contracts/projects';

export const projectRepository: ProjectRepository = {
  list: (params) => wrap(() => listProjects(params)),
  listByClient: (id) => wrap(() => listProjectsByClient(id)),
  getWithRefs: (id) => wrap(() => getProject(id)),
  listPipelineStageConfig: () => wrap(() => listPipelineStageConfig()),
  listIdentity: () => wrap(() => listProjectIdentity()),
  get: (id) => wrap(() => getOpportunity(id)),
  getMany: (ids) => wrap(() => getOpportunitiesByIds(ids)),
  transition: (id, to, opts) => wrap(() => transitionProject(id, to, opts)),
  winEligibility: (id) => wrap(() => getProjectWinEligibility(id)),
  create: (input) => wrap(() => createProject(input)),
  updateHeader: (id, input) => wrap(() => updateProjectHeader(id, input)),
  archive: (id) => wrap(() => archiveProject(id)),
  delete: (id) => wrap(() => deleteProject(id)),
  setContractValue: (input) => wrap(() => setProjectContractValue(input)),
  getVatEditability: (id) => wrap(() => getProjectVatEditability(id)),
  proposeNumber: (clientId) => wrap(() => proposeProjectNumber(clientId)),
};
