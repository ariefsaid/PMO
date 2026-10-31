/** Budget repository implementation. */
import {
  deriveProjectBudget,
  getBudgetActivationMode,
  precheckBudgetActivation,
  listBudgetArchiveLiveTargets,
  importBudgetLine,
  listBudgetVersions,
  createLineItem,
  updateLineItem,
  deleteLineItem,
  createBudgetVersion,
  cloneVersion,
  activateVersion,
  archiveVersion,
  deleteDraftVersion,
  listBudgetDocumentLinks,
  addBudgetDocumentLink,
  removeBudgetDocumentLink,
} from '@/src/lib/db/budgets';
import { findImportTargetDraft, findImportedLine } from '@/src/lib/db/budgetImportSkip';
import { wrap } from './repositoryErrors';
import type { BudgetRepository } from './contracts/budget';

export const budgetRepository: BudgetRepository = {
  importLine: (request) => wrap(() => importBudgetLine(request)),
  deriveProjectBudget: (projectId) => wrap(() => deriveProjectBudget(projectId)),
  getActivationMode: (versionId) => wrap(() => getBudgetActivationMode(versionId)),
  precheckActivation: (versionId) => wrap(() => precheckBudgetActivation(versionId)),
  listArchiveLiveTargets: (versionIds) => wrap(() => listBudgetArchiveLiveTargets(versionIds)),
  listVersions: (projectId) => wrap(() => listBudgetVersions(projectId)),
  createLineItem: (versionId, item, provenance) =>
    wrap(() => createLineItem(versionId, item, provenance)),
  updateLineItem: (id, patch) => wrap(() => updateLineItem(id, patch)),
  deleteLineItem: (id) => wrap(() => deleteLineItem(id)),
  createVersion: (projectId, name, provenance) =>
    wrap(() => createBudgetVersion(projectId, name, provenance)),
  findImportTargetDraft: (projectId) => wrap(() => findImportTargetDraft(projectId)),
  findImportedLine: (versionId, importKey) => wrap(() => findImportedLine(versionId, importKey)),
  cloneVersion: (versionId) => wrap(() => cloneVersion(versionId)),
  activateVersion: (versionId) => wrap(() => activateVersion(versionId)),
  archiveVersion: (versionId, cancelErp) => wrap(() => archiveVersion(versionId, cancelErp)),
  deleteDraftVersion: (versionId) => wrap(() => deleteDraftVersion(versionId)),
  listDocumentLinks: (versionId) => wrap(() => listBudgetDocumentLinks(versionId)),
  addDocumentLink: (versionId, reference) => wrap(() => addBudgetDocumentLink(versionId, reference)),
  removeDocumentLink: (id) => wrap(() => removeBudgetDocumentLink(id)),
};
