import React, { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useToast } from '@/src/components/ui';
import { FileCell } from '@/src/components/FileCell';
import { useFileUpload } from '@/src/hooks/useFileUpload';
import { useUploadDestination } from '@/src/hooks/useUploadDestination';
import { validateFile } from '@/src/lib/validateFile';
import { repositories } from '@/src/lib/repositories';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import { projectOwner, projectReference, validMicrosoftBrowserUrl } from '@/src/lib/m365/reference';
import { useViewerOnDemand } from '@/src/components/documents/viewerContext';
import { storageTarget } from '@/src/components/documents/targets/storage';
import { referenceTarget } from '@/src/components/documents/targets/reference';
import type { ProjectDocumentRow } from '@/src/lib/db/documents';

export function useDocumentFiles(projectId: string, all: ProjectDocumentRow[], canEditDoc: (doc: ProjectDocumentRow) => boolean) {
  const { t } = useTranslation('project');
  const { toast } = useToast();
  const viewer = useViewerOnDemand();
  const destination = useUploadDestination();
  const { upload, replace, progress, uploadErrors, cancelUpload, clearUploadError } = useFileUpload(projectId);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [activeFileDoc, setActiveFileDoc] = useState<{ docId: string; mode: 'upload' | 'replace' } | null>(null);
  const [clientUploadErrors, setClientUploadErrors] = useState<Record<string, string>>({});
  const removeClientUploadError = (docId: string) => {
    setClientUploadErrors((prev) => {
      const next = { ...prev };
      delete next[docId];
      return next;
    });
  };

  const clearAnyUploadError = (docId: string) => {
    removeClientUploadError(docId);
    clearUploadError(docId);
  };

  const handleFileSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !activeFileDoc) return;

    const target = all.find((doc) => doc.id === activeFileDoc.docId);
    if (!target || target.status !== 'Draft' || !canEditDoc(target)) {
      if (fileInputRef.current) fileInputRef.current.value = '';
      setActiveFileDoc(null);
      return;
    }
    clearAnyUploadError(activeFileDoc.docId);
    const validation = validateFile(file);
    if (!validation.ok) {
      setClientUploadErrors((prev) => ({
        ...prev,
        [activeFileDoc.docId]:
          validation.message ??
          t('projectDetail.documents.fileValidationFailed', 'File validation failed'),
      }));
      if (fileInputRef.current) fileInputRef.current.value = '';
      setActiveFileDoc(null);
      return;
    }

    // `unknown` never reaches here: the affordances are withheld until the destination is known.
    const where = destination.kind === 'microsoft' ? 'microsoft' : 'private';
    const args = { docId: activeFileDoc.docId, file, destination: where, oldPath: target.file_path } as const;
    if (activeFileDoc.mode === 'upload') {
      upload.mutate(args);
    } else {
      replace.mutate(args);
    }

    if (fileInputRef.current) fileInputRef.current.value = '';
    setActiveFileDoc(null);
  };

  const handleUploadClick = (docId: string) => {
    const doc = all.find((item) => item.id === docId);
    if (!doc || doc.status !== 'Draft' || !canEditDoc(doc) || destination.kind === 'unknown') return;
    clearAnyUploadError(docId);
    setActiveFileDoc({ docId, mode: 'upload' });
    fileInputRef.current?.click();
  };

  const handleReplaceClick = (docId: string) => {
    const doc = all.find((item) => item.id === docId);
    if (!doc || doc.status !== 'Draft' || !canEditDoc(doc) || destination.kind === 'unknown') return;
    clearAnyUploadError(docId);
    setActiveFileDoc({ docId, mode: 'replace' });
    fileInputRef.current?.click();
  };

  const handleDownload = async (doc: ProjectDocumentRow) => {
    if (!doc.file_path) return;
    try {
      const url = await repositories.document.getSignedUrl(doc.file_path, { download: true });
      const a = document.createElement('a');
      a.href = url;
      a.download = doc.file_path.split('/').pop() || 'file';
      a.click();
    } catch (err) {
      const { headline, detail } = classifyMutationError(err);
      toast(headline, detail, 'warning');
    }
  };

  /** FR-001: one side-panel viewer for a stored file and for a Microsoft reference alike. */
  const openPreview = (doc: ProjectDocumentRow) => {
    const reference = projectReference(doc);
    if (reference?.web_url) {
      if (!validMicrosoftBrowserUrl(reference.web_url)) {
        toast(t('m365Documents.cell.openRefused', 'This Microsoft link cannot be opened.'), undefined, 'warning');
        return;
      }
      viewer.open(referenceTarget({ reference, owner: projectOwner(doc), title: doc.title }));
      return;
    }
    if (!doc.file_path) return;
    viewer.open(storageTarget({
      key: `project-document:${doc.id}`,
      name: doc.title,
      filePath: doc.file_path,
      getSignedUrl: (path, opts) => repositories.document.getSignedUrl(path, opts),
    }));
  };

  const downloadSelected = async (selectedDocuments: ProjectDocumentRow[]) => {
    selectedDocuments.forEach((doc) => {
      const url = !doc.file_path ? projectReference(doc)?.web_url : null;
      if (url && validMicrosoftBrowserUrl(url)) window.open(url, '_blank', 'noopener,noreferrer');
    });
    for (const doc of selectedDocuments.filter((item) => Boolean(item.file_path))) await handleDownload(doc);
  };

  // C4: the drawer shows a File field only when there is a file, a Draft to upload to, an upload in flight or an error.
  const drawerFileContent = (doc: ProjectDocumentRow) => (doc.source !== 'onedrive'
    && (doc.file_path || doc.status === 'Draft' || progress[doc.id] != null || clientUploadErrors[doc.id] || uploadErrors[doc.id]) ? fileCell(doc) : undefined);
  const fileCell = (doc: ProjectDocumentRow) => {
    if (doc.source === 'onedrive') return <span className="text-muted-foreground">{'—'}</span>;
    return (
      <FileCell
        status={String(doc.status)}
        filePath={doc.file_path}
        title={doc.title}
        uploadProgress={progress[doc.id] ?? null}
        uploadError={clientUploadErrors[doc.id] ?? uploadErrors[doc.id]?.message ?? null}
        onUpload={doc.status === 'Draft' && canEditDoc(doc) && destination.kind !== 'unknown' ? () => handleUploadClick(doc.id) : undefined}
        onReplace={doc.status === 'Draft' && canEditDoc(doc) && destination.kind !== 'unknown' ? () => handleReplaceClick(doc.id) : undefined}
        onCancelUpload={progress[doc.id] != null ? () => cancelUpload(doc.id) : undefined}
        onRemoveError={clientUploadErrors[doc.id] || uploadErrors[doc.id] ? () => clearAnyUploadError(doc.id) : undefined}
        onDownload={doc.file_path ? () => void handleDownload(doc) : undefined}
        onPreview={doc.file_path ? () => openPreview(doc) : undefined}
      />
    );
  };

  return { fileInputRef, handleFileSelected, handleDownload, openPreview, downloadSelected, drawerFileContent, fileCell };
}
