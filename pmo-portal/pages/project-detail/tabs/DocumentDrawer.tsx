import { isMicrosoftFolder } from './documentUtils';
import React from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Button, Drawer, GateNotice, Icon, StatusPill, type RowMenuItem } from '@/src/components/ui';
import type { ProjectDocumentRow } from '@/src/lib/db/documents';
import { workflowVariant } from '@/src/lib/status/statusVariants';
import { formatDateOnly } from '@/src/lib/format';


// ── D12: read-first quick-view drawer + inline status workflow ────────────────

interface LineageButtonProps {
  revision: string;
  title: string;
  direction: 'back' | 'forward';
  onClick: () => void;
  status?: string;
}

const LineageButton: React.FC<LineageButtonProps> = ({ revision, title, direction, onClick, status }) => {
  const { t } = useTranslation('project');
  return (
  <button
    type="button"
    className="w-fit text-[11px] text-primary-text hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
    aria-label={`${t('projectDetail.documents.viewRevision', 'View revision')} ${revision} ${t(
      'projectDetail.documents.ofWord',
      'of',
    )} ${title}${status ? `, ${status}` : ''}`}
    onClick={(e) => {
      e.stopPropagation();
      onClick();
    }}
  >
    {direction === 'back' ? '←' : '→'}{' '}
    {`${t('projectDetail.documents.revLabel', 'Rev')} ${revision}`}{status ? ` · ${status}` : ''}
  </button>
  );
};

export const DocumentTitleCell: React.FC<{
  doc: ProjectDocumentRow;
  parentDoc: ProjectDocumentRow | null;
  childDocs: ProjectDocumentRow[];
  onViewDocument: (doc: ProjectDocumentRow) => void;
}> = ({ doc, parentDoc, childDocs, onViewDocument }) => {
  const { t } = useTranslation('project');
  return (
    <div className="min-w-0">
      <button
        type="button"
        aria-label={`${t('projectDetail.documents.viewDocument', 'View')} ${doc.title}`}
        onClick={() => onViewDocument(doc)}
        className="block w-full rounded-sm text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        <span className="block whitespace-normal break-words font-semibold" title={doc.title}>
          {doc.title}
        </span>
        {(doc.code || doc.revision) && (
          <span className="text-[12px] text-muted-foreground">
            {[
              doc.code,
              doc.revision ? `${t('projectDetail.documents.revLabel', 'Rev')} ${doc.revision}` : null,
            ].filter(Boolean).join(' · ')}
          </span>
        )}
      </button>
      {parentDoc?.revision && (
        <div className="mt-1">
          <LineageButton
            revision={parentDoc.revision}
            title={doc.title}
            direction="back"
            onClick={() => onViewDocument(parentDoc)}
          />
        </div>
      )}
      {childDocs.map((child) => (
        <div className="mt-1 flex flex-col gap-1" key={child.id}>
          <LineageButton revision={child.revision ?? '—'} title={doc.title} direction="forward" status={child.status} onClick={() => onViewDocument(child)} />
          {doc.status === 'Superseded' && (
            <span className="text-[11px] text-muted-foreground">
              {`${t('projectDetail.documents.supersededNotice', 'Read-only — continue on Rev')} ${child.revision ?? '—'}`}
            </span>
          )}
        </div>
      ))}
    </div>
  );
};

interface DocumentPreviewProps {
  /** The in-hand ProjectDocumentRow (no extra fetch). */
  doc: ProjectDocumentRow;
  parentDoc: ProjectDocumentRow | null;
  childDocs: ProjectDocumentRow[];
  transitions: RowMenuItem[];
  sodBlocked: boolean;
  onViewDocument: (doc: ProjectDocumentRow) => void;
  fileContent: React.ReactNode;
  microsoftFile: React.ReactNode;
}

interface DocumentActionFooterProps {
  canEdit: boolean;
  canDelete: boolean;
  hasFile: boolean;
  sharePointUrl: string | null;
  onEdit: () => void;
  onDelete: () => void;
  onDownload: () => void;
}

interface DocumentHeaderActionsProps {
  primaryAction?: RowMenuItem;
  fullRecordHref: string;
}

const DocumentHeaderActions: React.FC<DocumentHeaderActionsProps> = ({ primaryAction, fullRecordHref }) => {
  const { t } = useTranslation('project');
  return (
    <div className="flex flex-wrap items-center gap-2">
      {primaryAction && (
        <Button
          size="sm"
          variant={primaryAction.danger ? 'destructive' : 'primary'}
          onClick={primaryAction.onClick}
          disabled={primaryAction.disabled}
        >
          {primaryAction.label}
        </Button>
      )}
      <Link
        to={fullRecordHref}
        className="inline-flex min-h-10 items-center rounded-sm text-sm font-medium text-primary-text underline underline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        {t('projectDetail.drawer.openFullPage', 'Open full page')}
      </Link>
    </div>
  );
};

const DocumentActionFooter: React.FC<DocumentActionFooterProps> = ({
  canEdit,
  canDelete,
  hasFile,
  sharePointUrl,
  onEdit,
  onDelete,
  onDownload,
}) => {
  const { t } = useTranslation('project');
  return (
    <>
      {canEdit && (
        <Button variant="outline" size="sm" onClick={onEdit}>
          {t('projectDetail.documents.action.edit', 'Edit')}
        </Button>
      )}
      {hasFile && (
        <Button variant="outline" size="sm" onClick={onDownload}>
          {t('projectDetail.documents.action.download', 'Download')}
        </Button>
      )}
      {sharePointUrl && (
        <a
          href={sharePointUrl}
          target="_blank"
          rel="noreferrer"
          className="touch-target inline-flex items-center rounded-sm px-2 text-sm font-medium text-primary-text hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          {t('projectDetail.documents.action.openSharePoint', 'Open in SharePoint')}
        </a>
      )}
      {canDelete && (
        // B1: Delete stays reachable but quiet; it is confirmed, and the drawer's one filled action is the next step.
        <Button variant="ghost" size="sm" className="text-destructive-text! sm:ml-auto" onClick={onDelete}>
          {t('projectDetail.documents.action.delete', 'Delete')}
        </Button>
      )}
    </>
  );
};

const DocumentPreviewFields: React.FC<DocumentPreviewProps> = ({
  doc,
  parentDoc,
  childDocs,
  transitions,
  sodBlocked,
  onViewDocument,
  fileContent,
  microsoftFile,
}) => {
  const { t } = useTranslation('project');
  const isFolder = isMicrosoftFolder(doc);
  return (
    <>
      <dl className="flex flex-col gap-4">
        {!isFolder && doc.revision && (
          <DocField label={t('projectDetail.documents.field.revision', 'Revision')}>
            {`${t('projectDetail.documents.revLabel', 'Rev')} ${doc.revision}`}
          </DocField>
        )}
        {!isFolder && (
          <>
            {/* C4: empty fields are left out, never shown as "—". */}
            {doc.code && <DocField label={t('projectDetail.documents.field.code', 'Code')}>
              <span className="font-mono text-[13px]">{doc.code}</span>
            </DocField>}
            <DocField label={t('projectDetail.documents.field.category', 'Category')}>
              {doc.category || t('projectDetail.documents.category.uncategorized', 'Uncategorized')}
            </DocField>
            {doc.doc_date && <DocField label={t('projectDetail.documents.field.docDate', 'Document date')}>
              <span className="tabular-nums">{formatDateOnly(doc.doc_date)}</span>
            </DocField>}
          </>
        )}
        {parentDoc?.revision && (
          <DocField label={t('projectDetail.documents.field.lineage', 'Revision lineage')}>
            <LineageButton revision={parentDoc.revision} title={doc.title} direction="back" onClick={() => onViewDocument(parentDoc)} />
          </DocField>
        )}
        {childDocs.length > 0 && (
          <DocField label={doc.status === 'Superseded' ? t('projectDetail.documents.field.supersededBy', 'Superseded by') : t('projectDetail.documents.field.lineage', 'Revision lineage')}>
            {childDocs.map((child) => (
              <div key={child.id}><LineageButton revision={child.revision ?? '—'} title={doc.title} direction="forward" status={child.status} onClick={() => onViewDocument(child)} /></div>
            ))}
          </DocField>
        )}
        {microsoftFile && (
          <DocField label={t('projectDetail.documents.field.microsoft', 'Microsoft 365 item')}>
            {microsoftFile}
          </DocField>
        )}
        {fileContent && <DocField label={t('projectDetail.documents.field.file', 'File')}>
          {fileContent}
        </DocField>}
      </dl>

      {(transitions.length > 0 || sodBlocked) && (
        <div className="mt-5 border-t border-border pt-4">
          <h3 className="mb-2.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
            {t('projectDetail.documents.updateStatus', 'Update status')}
          </h3>
          {sodBlocked ? (
            <GateNotice variant="blocked" data-testid="drawer-sod-gate">
              <div>
                {t(
                  'projectDetail.documents.sod.drawerNotice',
                  "You can't approve your own document. Approving is a segregation-of-duties step, so a different reviewer must approve or reject it.",
                )}
              </div>
            </GateNotice>
          ) : (
            <div className="flex flex-wrap gap-2">
              {transitions.map((action) => (
                <Button
                  key={action.label}
                  size="sm"
                  variant={action.danger ? 'destructive' : 'outline'}
                  onClick={action.onClick}
                >
                  {action.label}
                </Button>
              ))}
            </div>
          )}
        </div>
      )}
    </>
  );
};

interface DocumentDrawerProps extends DocumentPreviewProps, DocumentActionFooterProps {
  fullRecordHref: string;
  nestedOpen: boolean;
  onClose: () => void;
}

/** Definition-list row — label (overline voice) + value. */
const DocField: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div className="flex flex-col gap-1">
    <dt className="text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
      {label}
    </dt>
    <dd className="text-[14px] text-foreground">{children}</dd>
  </div>
);

export const DocumentDrawer: React.FC<DocumentDrawerProps> = ({
  doc,
  parentDoc,
  childDocs,
  transitions,
  sodBlocked,
  canEdit,
  canDelete,
  hasFile,
  sharePointUrl,
  fullRecordHref,
  nestedOpen,
  onClose,
  onEdit,
  onDelete,
  onViewDocument,
  onDownload,
  fileContent,
  microsoftFile,
}) => {
  const isFolder = isMicrosoftFolder(doc);
  const [primaryTransition, ...secondaryTransitions] = transitions;

  return (
    <Drawer
      open
      title={doc.title}
      status={!isFolder ? <StatusPill variant={workflowVariant(doc.status)}>{doc.status}</StatusPill> : undefined}
      headerActions={<DocumentHeaderActions primaryAction={primaryTransition} fullRecordHref={fullRecordHref} />}
      nestedOpen={nestedOpen}
      onClose={onClose}
      footer={<DocumentActionFooter
        canEdit={canEdit}
        canDelete={canDelete}
        hasFile={hasFile}
        sharePointUrl={sharePointUrl}
        onEdit={onEdit}
        onDelete={onDelete}
        onDownload={onDownload}
      />}
    >
      <DocumentPreviewFields doc={doc} parentDoc={parentDoc} childDocs={childDocs} transitions={secondaryTransitions} sodBlocked={sodBlocked} onViewDocument={onViewDocument} fileContent={fileContent} microsoftFile={microsoftFile} />
    </Drawer>
  );
};

export const DocumentPreviewPanel: React.FC<DocumentDrawerProps> = ({
  doc,
  parentDoc,
  childDocs,
  transitions,
  sodBlocked,
  canEdit,
  canDelete,
  hasFile,
  sharePointUrl,
  fullRecordHref,
  nestedOpen,
  onClose,
  onEdit,
  onDelete,
  onViewDocument,
  onDownload,
  fileContent,
  microsoftFile,
}) => {
  const { t } = useTranslation('project');
  const isFolder = isMicrosoftFolder(doc);
  const [primaryTransition, ...secondaryTransitions] = transitions;
  return (
    <aside
      aria-labelledby="document-preview-title"
      aria-hidden={nestedOpen || undefined}
      inert={nestedOpen || undefined}
      className="flex min-h-[440px] min-w-0 flex-col rounded-lg border border-border bg-card"
    >
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-4 py-3.5">
        <div className="min-w-0">
          <h3 id="document-preview-title" className="break-words text-base font-semibold text-foreground">{doc.title}</h3>
          {!isFolder && <div className="mt-1.5"><StatusPill variant={workflowVariant(doc.status)}>{doc.status}</StatusPill></div>}
        </div>
        <div className="flex max-w-full flex-wrap items-center gap-2">
          <DocumentHeaderActions primaryAction={primaryTransition} fullRecordHref={fullRecordHref} />
          <Button variant="ghost" iconOnly aria-label={t('projectDetail.documents.action.closePreview', 'Close preview')} onClick={onClose}>
            <Icon name="x" />
          </Button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <DocumentPreviewFields doc={doc} parentDoc={parentDoc} childDocs={childDocs} transitions={secondaryTransitions} sodBlocked={sodBlocked} onViewDocument={onViewDocument} fileContent={fileContent} microsoftFile={microsoftFile} />
      </div>
      <div className="flex flex-wrap items-center gap-2 border-t border-border px-4 py-3.5">
        <DocumentActionFooter canEdit={canEdit} canDelete={canDelete} hasFile={hasFile} sharePointUrl={sharePointUrl} onEdit={onEdit} onDelete={onDelete} onDownload={onDownload} />
      </div>
    </aside>
  );
};

// ── Create / edit metadata form modal ────────────────────────────────────────
