import type { TFunction } from 'i18next';
import { DocumentTitleCell } from './DocumentDrawer';
import { isMicrosoftFolder } from './documentUtils';
import type { ProjectDocumentRow } from '@/src/lib/db/documents';
import type React from 'react';
import type { Column } from '@/src/components/ui';

export interface DocumentRegisterColumnDeps {
  t: TFunction;
  documentsById: Map<string, ProjectDocumentRow>;
  childDocumentsByParentId: Map<string, ProjectDocumentRow[]>;
  setDrawerDoc: (doc: ProjectDocumentRow | null) => void;
  categoryName: (doc: ProjectDocumentRow) => string;
  /** The visible (filtered) register — the File column appears only when a visible row can carry a file. */
  filtered: ProjectDocumentRow[];
  cells: ReturnType<typeof import('./documentRegisterCells').createDocumentRegisterCells>;
  /** The shared Microsoft reference cell (owned by the tab, beside its verification batch). */
  microsoftCell: (doc: ProjectDocumentRow, compact?: boolean) => React.ReactNode;
}

/** The register's DataTable columns — verbatim from the tab, beside its cell renderers. */
export function buildDocumentRegisterColumns(deps: DocumentRegisterColumnDeps): Column<ProjectDocumentRow>[] {
  const { t, documentsById, childDocumentsByParentId, setDrawerDoc, categoryName, filtered, cells, microsoftCell } = deps;
  const { statusCell, sourceCell, sourceName, ownerCell, ownerLabel, documentDateCell, documentHasFile, fileCell } = cells;
  return [
    {
      key: 'title',
      header: t('project:projectDetail.documents.column.document', 'Document'),
      size: 320, minSize: 260, maxSize: 420,
      sortKey: 'title',
      cell: (d) => (
        <DocumentTitleCell
          doc={d}
          parentDoc={d.parent_document_id ? (documentsById.get(d.parent_document_id) ?? null) : null}
          childDocs={childDocumentsByParentId.get(d.id) ?? []}
          onViewDocument={setDrawerDoc}
        />
      ),
      exportValue: (d) => d.title,
    },
    {
      key: 'category',
      header: t('project:projectDetail.documents.column.category', 'Category'),
      size: 128, minSize: 112, maxSize: 220,
      sortKey: 'category',
      cell: (d) => <span className="text-sm text-muted-foreground">{categoryName(d)}</span>,
      exportValue: categoryName,
    },
    {
      key: 'status',
      header: t('project:projectDetail.documents.column.status', 'Status'),
      kind: 'status',
      size: 120, minSize: 112, maxSize: 160,
      sortKey: 'status',
      cell: statusCell,
      exportValue: (d) => isMicrosoftFolder(d) ? '' : String(d.status),
    },
    {
      key: 'source',
      header: t('project:projectDetail.documents.column.source', 'Source'),
      size: 136, minSize: 120, maxSize: 220,
      cell: sourceCell,
      exportValue: sourceName,
    },
    {
      key: 'owner',
      header: t('project:projectDetail.documents.column.owner', 'Owner'),
      size: 150, minSize: 120, maxSize: 240,
      cell: ownerCell,
      exportValue: ownerLabel,
    },
    {
      key: 'doc_date',
      header: t('project:projectDetail.documents.column.docDate', 'Date'),
      size: 104, minSize: 96, maxSize: 132,
      cell: documentDateCell,
      exportValue: (doc) => doc.doc_date ?? '',
    },
    ...(filtered.some(documentHasFile) ? [{
      key: 'file',
      header: t('project:projectDetail.documents.column.file', 'File'),
      size: 220, minSize: 160, maxSize: 300,
      cell: (doc: ProjectDocumentRow) => doc.source === 'onedrive'
        ? (isMicrosoftFolder(doc) ? '—' : (microsoftCell(doc, true) ?? '—'))
        : (fileCell(doc) ?? '—'),
      exportValue: (doc: ProjectDocumentRow) => doc.file_path?.split('/').pop() ?? (isMicrosoftFolder(doc) ? '' : doc.ms_item_name ?? ''),
    } satisfies Column<ProjectDocumentRow>] : []),
  ];
}
