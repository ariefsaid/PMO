import { describe, vi } from 'vitest';
import * as folders from '@/src/lib/m365/recordFolders';
import * as settings from '@/src/lib/db/m365DocumentSettings';
import * as docs from '@/src/lib/db/documents';
import * as attachments from '@/src/lib/db/agentAttachments';
import * as threads from '@/src/lib/db/agentThreads';
import { documentRepository, agentAttachmentRepository, m365DocumentSettingsRepository, m365RecordFoldersRepository } from './documents';
import { itDelegates } from './__tests__/delegation';

vi.mock('@/src/lib/m365/recordFolders');
vi.mock('@/src/lib/db/m365DocumentSettings');
vi.mock('@/src/lib/db/documents');
vi.mock('@/src/lib/db/agentAttachments');
vi.mock('@/src/lib/db/agentThreads');

describe('documentRepository', () => {
  itDelegates(documentRepository as never, docs, [
    ['list', 'listProjectDocuments', ['p1']],
    ['get', 'getProjectDocument', ['d1']],
    ['create', 'createProjectDocument', ['p1', { title: 'Spec' }, 'author1']],
    ['linkMicrosoftDocument', 'linkMicrosoftDocument', ['d1', { driveId: 'dr', itemId: 'it' }]],
    ['attachMicrosoftUpload', 'attachMicrosoftUpload', ['d1', { driveId: 'dr', itemId: 'it' }]],
    ['unlinkMicrosoftDocument', 'unlinkMicrosoftDocument', ['d1']],
    ['update', 'updateProjectDocument', ['d1', { title: 'New' }]],
    ['transition', 'transitionProjectDocument', ['d1', 'approved']],
    ['delete', 'deleteProjectDocument', ['d1']],
    ['prepareUpload', 'prepareUpload', ['d1', 'a.pdf']],
    ['confirmUpload', 'confirmUpload', ['d1', 'path/a.pdf']],
    ['cleanupObject', 'cleanupStorageObject', ['path/a.pdf']],
    ['getSignedUrl', 'getSignedDownloadUrl', ['path/a.pdf', { download: true }]],
    ['createRevision', 'createDocumentRevision', ['d1', { title: 'v2' }, 'author1', { driveId: 'dr' }]],
    ['getChild', 'getChildDocument', ['d1']],
  ]);
});

describe('agentAttachmentRepository', () => {
  itDelegates(agentAttachmentRepository as never, { ...attachments, ...threads }, [
    ['prepareUpload', 'prepareAgentAttachmentFileUpload', ['t1', { name: 'a.png' }]],
    ['confirmUpload', 'confirmAgentAttachmentUpload', ['att1']],
    ['cleanupObject', 'cleanupAgentAttachmentObject', ['path/a.png']],
    ['createThread', 'createAgentThread', ['Chat']],
  ]);
});

describe('m365DocumentSettingsRepository', () => {
  itDelegates(m365DocumentSettingsRepository as never, settings, [
    ['getDefaultLibrary', 'getDefaultLibrary', []],
    ['setDefaultLibrary', 'setDefaultLibrary', [{ driveId: 'dr' }]],
  ]);
});

describe('m365RecordFoldersRepository', () => {
  itDelegates(m365RecordFoldersRepository as never, folders, [
    ['ensure', 'ensureRecordFolder', [{ kind: 'project', id: 'p1' }]],
    ['linkExisting', 'linkExistingRecordFolders', ['cursor-1']],
  ]);
});
