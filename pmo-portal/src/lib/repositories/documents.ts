/** Document, agent-attachment and Microsoft settings/record-folder repository implementations. */
import { getDefaultLibrary, setDefaultLibrary } from '@/src/lib/db/m365DocumentSettings';
import { ensureRecordFolder, linkExistingRecordFolders } from '@/src/lib/m365/recordFolders';
import {
  listProjectDocuments,
  getProjectDocument,
  createProjectDocument,
  linkMicrosoftDocument,
  attachMicrosoftUpload,
  unlinkMicrosoftDocument,
  updateProjectDocument,
  transitionProjectDocument,
  deleteProjectDocument,
  prepareUpload,
  confirmUpload,
  cleanupStorageObject,
  getSignedDownloadUrl,
  createDocumentRevision,
  getChildDocument,
} from '@/src/lib/db/documents';
import {
  prepareAgentAttachmentFileUpload,
  confirmAgentAttachmentUpload,
  cleanupAgentAttachmentObject,
} from '@/src/lib/db/agentAttachments';
import { createAgentThread } from '@/src/lib/db/agentThreads';
import { wrap } from './repositoryErrors';
import type { AgentAttachmentRepository, DocumentRepository, M365DocumentSettingsRepository, M365RecordFoldersRepository } from './contracts/documents';

export const documentRepository: DocumentRepository = {
  list: (projectId) => wrap(() => listProjectDocuments(projectId)),
  get: (id) => wrap(() => getProjectDocument(id)),
  create: (projectId, input, authorId) =>
    wrap(() => createProjectDocument(projectId, input, authorId)),
  linkMicrosoftDocument: (id, reference) => wrap(() => linkMicrosoftDocument(id, reference)),
  attachMicrosoftUpload: (id, reference) => wrap(() => attachMicrosoftUpload(id, reference)),
  unlinkMicrosoftDocument: (id) => wrap(() => unlinkMicrosoftDocument(id)),
  update: (id, input) => wrap(() => updateProjectDocument(id, input)),
  transition: (id, status) => wrap(() => transitionProjectDocument(id, status)),
  delete: (id) => wrap(() => deleteProjectDocument(id)),
  prepareUpload: (docId, fileName) => wrap(() => prepareUpload(docId, fileName)),
  confirmUpload: (docId, path) => wrap(() => confirmUpload(docId, path)),
  cleanupObject: (filePath) => wrap(() => cleanupStorageObject(filePath)),
  getSignedUrl: (filePath, opts) => wrap(() => getSignedDownloadUrl(filePath, opts)),
  createRevision: (parentId, input, authorId, microsoft) =>
    wrap(() => createDocumentRevision(parentId, input, authorId, microsoft)),
  getChild: (parentId) => wrap(() => getChildDocument(parentId)),
};

export const agentAttachmentRepository: AgentAttachmentRepository = {
  prepareUpload: (threadId, file) => wrap(() => prepareAgentAttachmentFileUpload(threadId, file)),
  confirmUpload: (attachmentId) => wrap(() => confirmAgentAttachmentUpload(attachmentId)),
  cleanupObject: (path) => wrap(() => cleanupAgentAttachmentObject(path)),
  createThread: (title) => wrap(() => createAgentThread(title)),
};

export const m365DocumentSettingsRepository: M365DocumentSettingsRepository = {
  getDefaultLibrary: () => wrap(() => getDefaultLibrary()),
  setDefaultLibrary: (value) => wrap(() => setDefaultLibrary(value)),
};

export const m365RecordFoldersRepository: M365RecordFoldersRepository = {
  ensure: (target) => wrap(() => ensureRecordFolder(target)),
  linkExisting: (cursor) => wrap(() => linkExistingRecordFolders(cursor)),
};
