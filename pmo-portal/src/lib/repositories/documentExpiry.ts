/** Document expiry repository (#2527, #2542, ADR-0017): the API seam over the DAL. */
import * as dal from '@/src/lib/db/documentExpiry';
import { wrap } from './repositoryErrors';
import type { DocumentExpiryRepository } from './contracts/documentExpiry';

export const documentExpiryRepository: DocumentExpiryRepository = {
  listExpiring: (days) => wrap(() => dal.listExpiringDocuments(days)),
  listForSubject: (kind, id) => wrap(() => dal.listSubjectDocuments(kind, id)),
  listTypes: (kind) => wrap(() => dal.listDocumentTypes(kind)),
  getPerson: (id) => wrap(() => dal.getPerson(id)),
  create: (input) => wrap(() => dal.createExpiryDocument(input)),
  update: (id, fields) => wrap(() => dal.updateExpiryDocument(id, fields)),
  archive: (id) => wrap(() => dal.archiveExpiryDocument(id)),
  uploadAttachment: (kind, id, file) => wrap(() => dal.uploadExpiryAttachment(kind, id, file)),
  removeAttachment: (path) => wrap(() => dal.removeExpiryAttachment(path)),
  attachmentUrl: (path) => wrap(() => dal.getExpiryAttachmentUrl(path)),
  listAdminTypes: () => wrap(() => dal.listAdminDocumentTypes()),
  createType: (input) => wrap(() => dal.createDocumentType(input)),
  updateType: (id, input) => wrap(() => dal.updateDocumentType(id, input)),
  archiveType: (id) => wrap(() => dal.archiveDocumentType(id)),
  getWarningDays: () => wrap(() => dal.getDocumentWarningDays()),
  setWarningDays: (days) => wrap(() => dal.setDocumentWarningDays(days)),
};
