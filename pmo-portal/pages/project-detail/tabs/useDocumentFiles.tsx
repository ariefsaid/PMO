import React, { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useToast } from '@/src/components/ui';
import { FileCell } from '@/src/components/FileCell';
import { useFileUpload } from '@/src/hooks/useFileUpload';
import { validateFile } from '@/src/lib/validateFile';
import { repositories } from '@/src/lib/repositories';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import { projectReference, validMicrosoftBrowserUrl } from '@/src/lib/m365/reference';
import type { ProjectDocumentRow } from '@/src/lib/db/documents';

export function useDocumentFiles(projectId: string, all: ProjectDocumentRow[], canEditDoc: (doc: ProjectDocumentRow) => boolean) {
  const { t } = useTranslation('project');
  const { toast } = useToast();
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

    if (activeFileDoc.mode === 'upload') {
      upload.mutate({ docId: activeFileDoc.docId, file });
    } else {
      replace.mutate({ docId: activeFileDoc.docId, file });
    }

    if (fileInputRef.current) fileInputRef.current.value = '';
    setActiveFileDoc(null);
  };

  const handleUploadClick = (docId: string) => {
    const doc = all.find((item) => item.id === docId);
    if (!doc || doc.status !== 'Draft' || !canEditDoc(doc)) return;
    clearAnyUploadError(docId);
    setActiveFileDoc({ docId, mode: 'upload' });
    fileInputRef.current?.click();
  };

  const handleReplaceClick = (docId: string) => {
    const doc = all.find((item) => item.id === docId);
    if (!doc || doc.status !== 'Draft' || !canEditDoc(doc)) return;
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

  const handlePreview = async (doc: ProjectDocumentRow) => {
    if (!doc.file_path) return;
    try {
      const url = await repositories.document.getSignedUrl(doc.file_path);
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (err) {
      const { headline, detail } = classifyMutationError(err);
      toast(headline, detail, 'warning');
    }
  };

  const openPreview = (doc: ProjectDocumentRow) => {
    const reference = projectReference(doc);
    if (reference?.web_url) {
      if (!validMicrosoftBrowserUrl(reference.web_url)) {
        toast(t('m365Documents.cell.openRefused', 'This Microsoft link cannot be opened.'), undefined, 'warning');
        return;
      }
      window.open(reference.web_url, '_blank', 'noopener,noreferrer');
      return;
    }
    void handlePreview(doc);
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
        onUpload={doc.status === 'Draft' && canEditDoc(doc) ? () => handleUploadClick(doc.id) : undefined}
        onReplace={doc.status === 'Draft' && canEditDoc(doc) ? () => handleReplaceClick(doc.id) : undefined}
        onCancelUpload={progress[doc.id] != null ? () => cancelUpload(doc.id) : undefined}
        onRemoveError={clientUploadErrors[doc.id] || uploadErrors[doc.id] ? () => clearAnyUploadError(doc.id) : undefined}
        onDownload={doc.file_path ? () => void handleDownload(doc) : undefined}
        onPreview={doc.file_path ? () => void handlePreview(doc) : undefined}
      />
    );
  };

  return { fileInputRef, handleFileSelected, handleDownload, openPreview, downloadSelected, drawerFileContent, fileCell };
}
