/** Document category repository contract (#2579). One-to-one with the DAL. */
import type * as dal from '@/src/lib/db/documentCategories';

export interface DocumentCategoryRepository {
  list: typeof dal.listDocumentCategories;
  create: typeof dal.createCategory;
  rename: typeof dal.renameCategory;
  setAccess: typeof dal.setCategoryAccess;
  archive: typeof dal.archiveCategory;
  restore: typeof dal.restoreCategory;
  reorder: typeof dal.reorderCategories;
  refileLineage: typeof dal.refileLineage;
}
