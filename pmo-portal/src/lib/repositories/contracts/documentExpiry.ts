/** Document expiry repository contract (#2527, #2542). One-to-one with the DAL. */
import type * as dal from '@/src/lib/db/documentExpiry';

export interface DocumentExpiryRepository {
  listExpiring: typeof dal.listExpiringDocuments;
  listForSubject: typeof dal.listSubjectDocuments;
  listTypes: typeof dal.listDocumentTypes;
  getPerson: typeof dal.getPerson;
  create: typeof dal.createExpiryDocument;
  update: typeof dal.updateExpiryDocument;
  archive: typeof dal.archiveExpiryDocument;
  uploadAttachment: typeof dal.uploadExpiryAttachment;
  removeAttachment: typeof dal.removeExpiryAttachment;
  attachmentUrl: typeof dal.getExpiryAttachmentUrl;
  listAdminTypes: typeof dal.listAdminDocumentTypes;
  createType: typeof dal.createDocumentType;
  updateType: typeof dal.updateDocumentType;
  archiveType: typeof dal.archiveDocumentType;
  getWarningDays: typeof dal.getDocumentWarningDays;
  setWarningDays: typeof dal.setDocumentWarningDays;
  recordRenewal: typeof dal.recordDocumentRenewal;
}
