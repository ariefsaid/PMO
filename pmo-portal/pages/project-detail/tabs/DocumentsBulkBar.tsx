import React from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/src/components/ui';
import type { DocStatus } from '@/src/lib/db/documents';

/** The selected-documents action bar (download, bulk status, export, clear). */
const DocumentsBulkBar: React.FC<{
  selectedCount: number;
  selectedDocumentsHaveFile: boolean;
  onDownloadSelected: () => void;
  bulkStatus: DocStatus | '';
  setBulkStatus: (value: DocStatus | '') => void;
  bulkStatusTargets: DocStatus[];
  statusLabels: Record<DocStatus, string>;
  bulkStatusOpen: boolean;
  setBulkStatusOpen: (open: boolean) => void;
  onReviewStatus: () => void;
  onExportSelected: () => void;
  onClearSelection: () => void;
}> = ({
  selectedCount,
  selectedDocumentsHaveFile,
  onDownloadSelected,
  bulkStatus,
  setBulkStatus,
  bulkStatusTargets,
  statusLabels,
  bulkStatusOpen,
  setBulkStatusOpen,
  onReviewStatus,
  onExportSelected,
  onClearSelection,
}) => {
  const { t } = useTranslation('project');
  return (
    <div role="group" aria-label={t('projectDetail.documents.bulk.ariaLabel', 'Selected document actions')} className="mb-3.5 flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card px-3 py-2.5">
      <span className="mr-auto text-sm font-medium text-foreground">
        {t('projectDetail.documents.bulk.selected', '{{count}} selected', { count: selectedCount })}
      </span>
      <Button variant="outline" size="sm" disabled={!selectedDocumentsHaveFile} onClick={onDownloadSelected}>
        {t('projectDetail.documents.bulk.download', 'Download')}
      </Button>
      {bulkStatusOpen ? (
        <>
          <select
            aria-label={t('projectDetail.documents.bulk.changeStatus', 'Change status')}
            value={bulkStatus}
            onChange={(event) => setBulkStatus(event.target.value as DocStatus | '')}
            className="h-9 min-w-0 rounded-md border border-input bg-background px-2 text-sm text-foreground"
          >
            <option value="">{t('projectDetail.documents.bulk.chooseStatus', 'Choose status')}</option>
            {bulkStatusTargets.map((status) => <option key={status} value={status}>{statusLabels[status]}</option>)}
          </select>
          <Button size="sm" disabled={!bulkStatus} onClick={onReviewStatus}>
            {t('projectDetail.documents.bulk.reviewStatus', 'Review change')}
          </Button>
        </>
      ) : (
        <Button variant="outline" size="sm" disabled={bulkStatusTargets.length === 0} onClick={() => setBulkStatusOpen(true)}>
          {t('projectDetail.documents.bulk.changeStatus', 'Change status')}
        </Button>
      )}
      <Button variant="outline" size="sm" onClick={onExportSelected}>
        {t('projectDetail.documents.bulk.exportRegister', 'Export register')}
      </Button>
      <Button variant="ghost" size="sm" onClick={onClearSelection}>
        {t('projectDetail.documents.bulk.clearSelection', 'Clear selection')}
      </Button>
    </div>
  );
};

export default DocumentsBulkBar;
