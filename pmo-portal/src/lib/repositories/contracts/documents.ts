/** Project documents, agent attachments and Microsoft settings/folders contracts. */
import type { ProjectDocumentRow, ProjectDocumentInput, DocStatus } from '@/src/lib/db/documents';
import type { MicrosoftReferenceInput, MicrosoftLibraryDefault } from '@/src/lib/m365/reference';
import type {
  RecordFolderBackfillPage,
  RecordFolderCursor,
  RecordFolderOutcome,
  RecordFolderTarget,
} from '@/src/lib/m365/recordFolders';
import type { PreparedAgentAttachmentUpload } from '@/src/lib/db/agentAttachments';

export interface DocumentRepository {
  /** The per-project document register (metadata only; ordered by code). */
  list(projectId: string): Promise<ProjectDocumentRow[]>;
  /** A single document by id, or null when not found / not readable. */
  get(id: string): Promise<ProjectDocumentRow | null>;
  /** Create a register entry (org_id stamped by RLS; author_id stamped from the current user). */
  create(
    projectId: string,
    input: ProjectDocumentInput,
    authorId: string | null,
  ): Promise<ProjectDocumentRow>;
  /** Atomically link a Microsoft item; actor/time stamps are server-owned. */
  linkMicrosoftDocument(id: string, reference: MicrosoftReferenceInput): Promise<void>;
  /** Attach a file the custody upload stored in SharePoint, replacing any private upload (Draft only; one UPDATE). */
  attachMicrosoftUpload(id: string, reference: MicrosoftReferenceInput): Promise<void>;
  /** Remove only the PMO reference; does not modify or delete the Microsoft item. */
  unlinkMicrosoftDocument(id: string): Promise<void>;
  /** Update a document's metadata (never status / author_id / org_id). */
  update(id: string, input: ProjectDocumentInput): Promise<void>;
  /** Move the document to the next workflow status (Draft→Issued→Approved/Rejected→Closed). */
  transition(id: string, status: DocStatus): Promise<void>;
  /** Hard-delete a document (Admin-only in the FE gate). */
  delete(id: string): Promise<void>;
  /** Prepare a signed upload URL for a Draft document (DAL fetches row internally). */
  prepareUpload(docId: string, fileName: string): Promise<{ signedUrl: string; path: string; oldPath: string | null }>;
  /** Confirm upload by updating file_path on the document row. */
  confirmUpload(docId: string, path: string): Promise<void>;
  /** Delete a storage object (non-fatal cleanup). */
  cleanupObject(filePath: string): Promise<void>;
  /** Generate a signed download URL for a document file. `opts.download` forces attachment (true download); omit for inline preview. */
  getSignedUrl(filePath: string, opts?: { download?: boolean; expiresIn?: number }): Promise<string>;
  /** Create a revision (child) document row. */
  createRevision(
    parentId: string,
    input: Pick<ProjectDocumentInput, 'title' | 'code' | 'category' | 'revision' | 'doc_date'>,
    authorId: string | null,
    microsoft?: MicrosoftReferenceInput,
  ): Promise<ProjectDocumentRow>;
  /** Get the child (successor) document for lineage display. */
  getChild(parentId: string): Promise<ProjectDocumentRow | null>;
}

export interface AgentAttachmentRepository {
  /** Prepare a signed upload URL by creating the owner-private metadata row first. */
  prepareUpload(threadId: string, file: File): Promise<PreparedAgentAttachmentUpload>;
  /** Confirm a successfully uploaded object so the resolver can pick it up. */
  confirmUpload(attachmentId: string): Promise<void>;
  /** Best-effort object cleanup + metadata soft-archive. */
  cleanupObject(path: string): Promise<void>;
  /**
   * Create an agent thread for an attach-before-send upload (ADR-0017 seam — the hook
   * never imports the DAL directly). The thread is owner-private + org-scoped at rest
   * (RLS stamps org_id/owner_id via defaults; ADR-0001/0043).
   */
  createThread(title?: string): Promise<{ id: string }>;
}

export interface M365DocumentSettingsRepository {
  getDefaultLibrary(): Promise<MicrosoftLibraryDefault | null>;
  setDefaultLibrary(value: MicrosoftLibraryDefault | null): Promise<void>;
}

export interface M365RecordFoldersRepository {
  /** Link or create the record's SharePoint folder (server-side; the browser never writes to Graph). */
  ensure(target: RecordFolderTarget): Promise<RecordFolderOutcome>;
  /** One match-only page of the Admin backfill sweep. */
  linkExisting(cursor?: RecordFolderCursor): Promise<RecordFolderBackfillPage>;
}
