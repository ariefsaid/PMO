/** Document category repository (#2579, ADR-0017): the API seam over the DAL. */
import * as dal from '@/src/lib/db/documentCategories';
import { wrap } from './repositoryErrors';
import type { DocumentCategoryRepository } from './contracts/documentCategories';

export const documentCategoryRepository: DocumentCategoryRepository = {
  list: () => wrap(() => dal.listDocumentCategories()),
  create: (name, roles) => wrap(() => dal.createCategory(name, roles)),
  rename: (id, name) => wrap(() => dal.renameCategory(id, name)),
  setAccess: (id, roles, keys) => wrap(() => dal.setCategoryAccess(id, roles, keys)),
  archive: (id) => wrap(() => dal.archiveCategory(id)),
  restore: (id) => wrap(() => dal.restoreCategory(id)),
  reorder: (ids) => wrap(() => dal.reorderCategories(ids)),
  refileLineage: (documentId, categoryId) => wrap(() => dal.refileLineage(documentId, categoryId)),
};
