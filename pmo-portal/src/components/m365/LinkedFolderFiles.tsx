import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Button, Icon, ListState } from '@/src/components/ui';
import { useOptionalDocumentViewer } from '@/src/components/documents/viewerContext';
import { folderChildTarget } from '@/src/components/documents/targets/reference';
import type { ReferenceOwner } from '@/src/lib/m365/reference';
import { listChildren, type GraphItem } from '@/src/lib/m365/graphClient';
import { formatDay } from '@/src/lib/format';
import { M365BrowseNotice } from './M365BrowseNotice';
import { MAX_NESTED_FOLDERS } from '../../../../supabase/functions/_shared/microsoftDocumentPreview';

const FOCUS = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring';

/**
 * The files inside a linked Microsoft folder, read live through the caller's own M365 connection
 * (metadata only: nothing is copied or stored). The drive/item ids come from the stored reference,
 * never from user input. Mounted only while the folder is expanded, so it reads on open.
 * Sub-folders open in place, down to the depth the server will prove a file is inside the linked folder (#1588).
 */
export function LinkedFolderFiles({ reference, owner }: { reference: { drive_id: string; item_id: string }; owner?: ReferenceOwner }) {
  const { t } = useTranslation('recordFolders');
  const { t: tv } = useTranslation('documentViewer');
  const viewer = useOptionalDocumentViewer();
  const { drive_id } = reference;
  // The sub-folders opened below the linked folder; ids come from Microsoft's own listing.
  const [trail, setTrail] = useState<Array<{ id: string; name: string }>>([]);
  // Once the user has moved, the path stays (even back at the linked folder) and focus lands on where they are now.
  const [moved, setMoved] = useState(false);
  const here = useRef<HTMLSpanElement>(null);
  const focusPending = useRef(false);
  const go = (next: Array<{ id: string; name: string }>) => {
    focusPending.current = true;
    setMoved(true);
    setTrail(next);
  };
  useEffect(() => {
    if (!focusPending.current) return;
    focusPending.current = false;
    here.current?.focus();
  }, [trail]);
  const item_id = trail.at(-1)?.id ?? reference.item_id;
  const canOpenFolders = trail.length < MAX_NESTED_FOLDERS;
  // Coming back to a folder shows its cached listing at once and re-reads it in the background, so a file added in Microsoft appears without waiting.
  const query = useQuery({
    queryKey: ['linked-folder-files', drive_id, item_id],
    queryFn: () => listChildren(drive_id, item_id),
    staleTime: 0,
    retry: false,
  });
  const items: GraphItem[] = query.data?.value ?? [];
  const partial = query.data?.next != null;

  let content: ReactNode;
  if (query.isPending || (query.isError && query.isFetching)) {
    content = <ListState variant="loading" shape="cards" rows={3} loadingLabel={t('folderFiles.loading', 'Loading files…')} loadingRole="status" />;
  } else if (query.isError) {
    content = (
      <M365BrowseNotice
        code={(query.error as { code?: string } | null)?.code}
        onRetry={() => { void query.refetch(); }}
        linkedFolder
      />
    );
  } else if (items.length === 0) {
    content = <p className="text-control text-muted-foreground">{t('folderFiles.empty', 'This folder is empty.')}</p>;
  } else {
    content = (
      <div className="min-w-0 space-y-1.5">
        <ul aria-label={t('folderFiles.list', 'Files in this folder')} className="max-h-72 overflow-auto rounded-md border border-border">
          {items.map((file) => (
            <li key={file.item_id} className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-0.5 border-b border-border px-3 py-2 text-control last:border-b-0">
              <Icon name={file.item_kind === 'folder' ? 'folder' : 'doc'} className="shrink-0 self-center text-muted-foreground" />
              {file.item_kind === 'folder' && canOpenFolders ? (
                <button
                  type="button"
                  aria-label={t('folderFiles.openFolderNamed', 'Open folder {{name}}', { name: file.name })}
                  onClick={() => go([...trail, { id: file.item_id, name: file.name }])}
                  className={`touch-target min-w-0 flex-1 break-words text-left font-medium text-primary-text underline-offset-2 hover:underline ${FOCUS}`}
                >
                  {file.name}
                </button>
              ) : (
                <span className="min-w-0 flex-1 break-words font-medium text-foreground">{file.name}</span>
              )}
              {file.modified_at && <span className="tabular text-control text-muted-foreground">{formatDay(file.modified_at)}</span>}
              {viewer && owner && file.item_kind !== 'folder' && (
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={tv('viewer.previewNamed', 'Preview {{name}}', { name: file.name })}
                  onClick={(event) => viewer.open(folderChildTarget({ owner, childItemId: file.item_id, name: file.name, webUrl: file.web_url }), event.currentTarget)}
                >
                  {tv('viewer.preview', 'Preview')}
                </Button>
              )}
              <a
                href={file.web_url}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={t('folderFiles.openNamed', 'Open {{name}}', { name: file.name })}
                className={`touch-target text-primary-text underline underline-offset-2 ${FOCUS}`}
              >
                {t('folderFiles.open', 'Open')}
              </a>
            </li>
          ))}
        </ul>
        {partial && <p className="text-control text-muted-foreground">{t('folderFiles.partial', 'Showing the first files only. Open the folder in Microsoft to see the rest.')}</p>}
      </div>
    );
  }
  if (!moved) return content;
  return (
    <div className="min-w-0 space-y-1.5">
      <nav aria-label={t('folderFiles.path', 'Folder path')}>
        <ol className="flex min-w-0 flex-wrap items-center gap-x-1 gap-y-0.5 text-control">
          <li>
            {trail.length === 0 ? (
              <span ref={here} tabIndex={-1} aria-current="location" className={`font-medium text-foreground ${FOCUS}`}>
                {t('folderFiles.top', 'Linked folder')}
              </span>
            ) : (
              <button type="button" onClick={() => go([])} className={`touch-target text-primary-text underline underline-offset-2 ${FOCUS}`}>
                {t('folderFiles.top', 'Linked folder')}
              </button>
            )}
          </li>
          {trail.map((folder, index) => (
            <li key={folder.id} className="flex min-w-0 items-center gap-x-1">
              <Icon name="chev" className="shrink-0 text-muted-foreground" />
              {index === trail.length - 1 ? (
                <span ref={here} tabIndex={-1} aria-current="location" className={`min-w-0 break-words font-medium text-foreground ${FOCUS}`}>{folder.name}</span>
              ) : (
                <button type="button" onClick={() => go(trail.slice(0, index + 1))} className={`touch-target min-w-0 break-words text-left text-primary-text underline underline-offset-2 ${FOCUS}`}>
                  {folder.name}
                </button>
              )}
            </li>
          ))}
        </ol>
      </nav>
      {content}
    </div>
  );
}
