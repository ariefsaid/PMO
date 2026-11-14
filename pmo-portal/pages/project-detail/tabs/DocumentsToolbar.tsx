import React from 'react';
import { useTranslation } from 'react-i18next';
import {
  Toolbar,
  SearchMini,
  Button,
  Icon,
  ViewToggle,
} from '@/src/components/ui';
import type { DocStatus } from '@/src/lib/db/documents';
import { statusLabel } from '@/src/lib/status/statusMap';

/** Search shows only when the register is long enough to need it (owner ruling B7: "search only beyond ~10"). */
export const SEARCH_THRESHOLD = 10;

/** The register toolbar: search (only past the threshold), filters, view toggle, and the two create actions. */
const DocumentsToolbar: React.FC<{
  registerSize: number;
  search: string;
  setSearch: (value: string) => void;
  categories: string[];
  categoryFilter: string;
  setCategoryFilter: (value: string) => void;
  statusFilter: DocStatus | '';
  setStatusFilter: (value: DocStatus | '') => void;
  sourceFilter: 'upload' | 'onedrive' | '';
  setSourceFilter: (value: 'upload' | 'onedrive' | '') => void;
  documentsView: 'register' | 'grouped';
  setDocumentsView: (view: 'register' | 'grouped') => void;
  canCreateMicrosoftReference: boolean;
  canCreate: boolean;
  /** The register's Create-folder action (RecordFolderAction), which shares this row with the other create controls. */
  folderAction?: React.ReactNode;
  onLinkMicrosoft: () => void;
  onAddDocument: () => void;
}> = ({
  registerSize,
  search,
  setSearch,
  categories,
  categoryFilter,
  setCategoryFilter,
  statusFilter,
  setStatusFilter,
  sourceFilter,
  setSourceFilter,
  documentsView,
  setDocumentsView,
  canCreateMicrosoftReference,
  canCreate,
  folderAction,
  onLinkMicrosoft,
  onAddDocument,
}) => {
  const { t } = useTranslation('project');
  return (
    <Toolbar
      data-testid="documents-register-toolbar"
      className="min-w-0 px-[var(--panel-inset)] py-3"
    >
      <div className="flex w-full min-w-0 flex-wrap items-center gap-2">
        {/* B7: search earns its place only beyond about ten documents; the filters cover a short register. */}
        {(registerSize > SEARCH_THRESHOLD || search) && <SearchMini
          placeholder={t('projectDetail.documents.searchPlaceholder', 'Search documents…')}
          aria-label={t('projectDetail.documents.searchAriaLabel', 'Search documents')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          containerClassName="min-w-0 basis-full sm:basis-56 sm:grow-0"
        />}
        <label className="sr-only" htmlFor="documents-category-filter">{t('projectDetail.documents.filter.category', 'Filter by category')}</label>
        <select
          id="documents-category-filter"
          aria-label={t('projectDetail.documents.filter.category', 'Filter by category')}
          value={categoryFilter}
          onChange={(event) => setCategoryFilter(event.target.value)}
          className="h-[var(--control-height-sm)] min-w-0 flex-1 rounded-md border border-input bg-background px-2 text-control text-foreground sm:flex-none"
        >
          <option value="">{t('projectDetail.documents.filter.allCategories', 'All categories')}</option>
          {categories.map((category) => <option key={category} value={category}>{category}</option>)}
        </select>
        <label className="sr-only" htmlFor="documents-status-filter">{t('projectDetail.documents.filter.status', 'Filter by status')}</label>
        <select
          id="documents-status-filter"
          aria-label={t('projectDetail.documents.filter.status', 'Filter by status')}
          value={statusFilter}
          onChange={(event) => setStatusFilter(event.target.value as DocStatus | '')}
          className="h-[var(--control-height-sm)] min-w-0 flex-1 rounded-md border border-input bg-background px-2 text-control text-foreground sm:flex-none"
        >
          <option value="">{t('projectDetail.documents.filter.allStatuses', 'All statuses')}</option>
          {(['Draft', 'Issued', 'Approved', 'Rejected', 'Closed', 'Superseded'] as DocStatus[]).map((status) => (
            <option key={status} value={status}>{statusLabel('document', status, t)}</option>
          ))}
        </select>
        <label className="sr-only" htmlFor="documents-source-filter">{t('projectDetail.documents.filter.source', 'Filter by source')}</label>
        <select
          id="documents-source-filter"
          aria-label={t('projectDetail.documents.filter.source', 'Filter by source')}
          value={sourceFilter}
          onChange={(event) => setSourceFilter(event.target.value as 'upload' | 'onedrive' | '')}
          className="h-[var(--control-height-sm)] min-w-0 flex-1 rounded-md border border-input bg-background px-2 text-control text-foreground sm:flex-none"
        >
          <option value="">{t('projectDetail.documents.filter.allSources', 'All sources')}</option>
          <option value="upload">{t('projectDetail.documents.source.upload', 'Upload')}</option>
          <option value="onedrive">{t('projectDetail.documents.source.sharePoint', 'SharePoint')}</option>
        </select>
        <div className="flex w-full min-w-0 flex-wrap items-center gap-2 sm:ml-auto sm:w-auto sm:justify-end">
          <ViewToggle<'register' | 'grouped'>
            options={[
              { value: 'register', label: t('projectDetail.documents.view.register', 'Register') },
              { value: 'grouped', label: t('projectDetail.documents.view.grouped', 'Grouped') },
            ]}
            value={documentsView}
            onChange={setDocumentsView}
            ariaLabel={t('projectDetail.documents.view.ariaLabel', 'Document register view')}
            semantics="toggle"
          />
          {/* The quieter create/link controls sit beside the tab's one filled action, never above the filters. */}
          {folderAction && (
            <div className="flex min-w-0 items-center">{folderAction}</div>
          )}
          {canCreateMicrosoftReference && (
            <Button variant="outline" size="sm" onClick={onLinkMicrosoft}>
              {t('m365Documents.link', 'Link from Microsoft 365')}
            </Button>
          )}
          {canCreate && (
            <Button variant="primary" size="sm" onClick={onAddDocument}>
              <Icon name="plus" />
              {t('projectDetail.documents.addDocument', 'Add document')}
            </Button>
          )}
        </div>
      </div>
    </Toolbar>
  );
};

export default DocumentsToolbar;
