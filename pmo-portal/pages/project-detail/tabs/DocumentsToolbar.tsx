import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Toolbar,
  SearchMini,
  SelectField,
  Button,
  Icon,
  ViewToggle,
  useIsNarrow,
} from '@/src/components/ui';
import { Menu } from '@/src/components/ui/menu';
import { cn } from '@/src/components/ui/cn';
import { buttonClasses } from '@/src/components/ui/buttonClasses';
import { menuItemClass, menuPopupClass, menuPopupOrigin } from '@/src/components/ui/menuStyles';
import type { DocStatus } from '@/src/lib/db/documents';
import { statusLabel } from '@/src/lib/status/statusMap';

/** Register rows, register rows grouped by category, or the linked Microsoft folder as a tree. */
export type DocumentsView = 'register' | 'grouped' | 'folders';

/** One way to add to the register, offered inside the tab's single "Add document" control. */
export interface DocumentAddOption {
  key: string;
  label: string;
  onSelect: () => void;
  disabled?: boolean;
}

/**
 * The register toolbar, one row: finding (search and filters) on the left; the view switch and the
 * tab's one filled "Add document" on the right. Every way to add a document (record and upload,
 * link from the cloud drive, create the project folder) sits inside that one control, so the row
 * carries a single create affordance. On a phone the filters fold behind one "Filters" button so
 * the list comes first.
 */
const DocumentsToolbar: React.FC<{
  search: string;
  setSearch: (value: string) => void;
  categories: string[];
  categoryFilter: string;
  setCategoryFilter: (value: string) => void;
  statusFilter: DocStatus | '';
  setStatusFilter: (value: DocStatus | '') => void;
  sourceFilter: 'upload' | 'onedrive' | '';
  setSourceFilter: (value: 'upload' | 'onedrive' | '') => void;
  documentsView: DocumentsView;
  setDocumentsView: (view: DocumentsView) => void;
  /** The ways to add a document this person may use; empty = no create control at all. */
  addOptions: DocumentAddOption[];
}> = ({
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
  addOptions,
}) => {
  const { t } = useTranslation('project');
  const narrow = useIsNarrow();
  const [filtersOpen, setFiltersOpen] = useState(false);
  // Search and filters narrow register rows; the folder tree is Microsoft's own listing, so they step aside.
  const finding = documentsView !== 'folders';
  const activeFilters = [categoryFilter, statusFilter, sourceFilter].filter(Boolean).length;
  const addLabel = t('projectDetail.documents.addDocument', 'Add document');
  const viewToggle = (
    <ViewToggle<DocumentsView>
      options={[
        { value: 'register', label: t('projectDetail.documents.view.register', 'Register') },
        { value: 'grouped', label: t('projectDetail.documents.view.grouped', 'Grouped') },
        { value: 'folders', label: t('projectDetail.documents.view.folders', 'Folders') },
      ]}
      value={documentsView}
      onChange={setDocumentsView}
      ariaLabel={t('projectDetail.documents.view.ariaLabel', 'Document register view')}
      semantics="toggle"
    />
  );
  const addContent = (
    <>
      <Icon name="plus" />
      <span className="max-sm:sr-only">{addLabel}</span>
    </>
  );

  return (
    <Toolbar
      data-testid="documents-register-toolbar"
      className="min-w-0 px-[var(--panel-inset)] py-3"
    >
      <div className="flex w-full min-w-0 flex-wrap items-center gap-2">
        <h2 className="mr-2 text-[16px] font-bold tracking-[-0.01em] max-sm:w-full">
          {documentsView === 'folders'
            ? t('projectDetail.documents.headingFolders', 'Project folders')
            : t('projectDetail.documents.heading', 'Document register')}
        </h2>
        {/* One field finds a document by its name, number, category, status or revision. */}
        {finding && <SearchMini
          placeholder={t('projectDetail.documents.searchPlaceholder', 'Search documents…')}
          aria-label={t('projectDetail.documents.searchAriaLabel', 'Search documents')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          containerClassName="min-w-0 flex-1 max-sm:min-h-11 sm:max-w-60 sm:flex-none [&_input]:max-sm:text-base"
        />}
        {narrow && !finding && <div className="min-w-0 flex-1">{viewToggle}</div>}
        {narrow && finding && (
          <Button
            variant="outline"
            aria-expanded={filtersOpen}
            aria-controls="documents-filters"
            onClick={() => setFiltersOpen((open) => !open)}
            className="h-11"
          >
            {t('projectDetail.documents.filters', 'Filters')}
            {activeFilters > 0 && <span className="tabular-nums text-muted-foreground">{`· ${activeFilters}`}</span>}
          </Button>
        )}
        {narrow && addOptions.length > 0 && <AddDocumentControl options={addOptions} label={addLabel} content={addContent} compact />}
        {finding && (!narrow || filtersOpen) && (
          <div id="documents-filters" className={narrow ? 'flex w-full min-w-0 flex-col gap-2' : 'contents'}>
          <SelectField id="documents-category-filter" hideLabel label={t('projectDetail.documents.filter.category', 'Filter by category')} value={categoryFilter} onChange={setCategoryFilter} options={[{ value: '', label: t('projectDetail.documents.filter.allCategories', 'All categories') }, ...categories.map((category) => ({ value: category, label: category }))]} />
          <SelectField id="documents-status-filter" hideLabel label={t('projectDetail.documents.filter.status', 'Filter by status')} value={statusFilter} onChange={(value) => setStatusFilter(value as DocStatus | '')} options={[{ value: '', label: t('projectDetail.documents.filter.allStatuses', 'All statuses') }, ...(['Draft', 'Issued', 'Approved', 'Rejected', 'Closed', 'Superseded'] as DocStatus[]).map((status) => ({ value: status, label: statusLabel('document', status, t) }))]} />
          <SelectField id="documents-source-filter" hideLabel label={t('projectDetail.documents.filter.source', 'Filter by source')} value={sourceFilter} onChange={(value) => setSourceFilter(value as 'upload' | 'onedrive' | '')} options={[{ value: '', label: t('projectDetail.documents.filter.allSources', 'All sources') }, { value: 'upload', label: t('projectDetail.documents.source.upload', 'Upload') }, { value: 'onedrive', label: t('projectDetail.documents.source.sharePoint', 'SharePoint') }]} />
            {narrow && viewToggle}
          </div>
        )}
        {!narrow && (
          <div className="ml-auto flex min-w-0 items-center gap-2">
            {viewToggle}
            {addOptions.length > 0 && <AddDocumentControl options={addOptions} label={addLabel} content={addContent} />}
          </div>
        )}
      </div>
    </Toolbar>
  );
};

/**
 * The tab's one filled create control. With a single way to add, it acts directly; with several,
 * it opens a short menu of them.
 */
const AddDocumentControl: React.FC<{
  options: DocumentAddOption[];
  label: string;
  content: React.ReactNode;
  compact?: boolean;
}> = ({ options, label, content, compact }) => {
  const sizeClass = compact ? 'h-11 min-w-11 px-3' : undefined;
  if (options.length === 1) {
    const [only] = options;
    return (
      <Button variant="primary" size="sm" aria-label={label} className={sizeClass} disabled={only.disabled} onClick={only.onSelect}>
        {content}
      </Button>
    );
  }
  return (
    <Menu.Root modal={false}>
      <Menu.Trigger aria-label={label} className={buttonClasses('primary', 'sm', cn('gap-1.5', sizeClass))}>
        {content}
        {!compact && <Icon name="chev" aria-hidden className="size-3.5 rotate-90" />}
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner side="bottom" align="end" sideOffset={4} collisionPadding={12} className="z-50">
          <Menu.Popup aria-label={label} className={cn(menuPopupClass, 'min-w-56 max-w-[calc(100vw-24px)]')} style={menuPopupOrigin}>
            {options.map((option) => (
              <Menu.Item
                key={option.key}
                disabled={option.disabled}
                className={cn(menuItemClass, 'min-h-11 items-center')}
                onClick={option.onSelect}
              >
                {option.label}
              </Menu.Item>
            ))}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
};

export default DocumentsToolbar;
