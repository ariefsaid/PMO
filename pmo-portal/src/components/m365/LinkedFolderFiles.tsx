import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Button, Icon, ListState } from '@/src/components/ui';
import { useOptionalDocumentViewer } from '@/src/components/documents/viewerContext';
import { folderChildTarget } from '@/src/components/documents/targets/reference';
import type { ReferenceOwner } from '@/src/lib/m365/reference';
import { listChildren, type GraphItem } from '@/src/lib/m365/graphClient';
import { formatDay } from '@/src/lib/format';
import { M365BrowseNotice } from './M365BrowseNotice';

/**
 * The files inside a linked Microsoft folder, read live through the caller's own M365 connection
 * (metadata only: nothing is copied or stored). The drive/item ids come from the stored reference,
 * never from user input. Mounted only while the folder is expanded, so it reads on open.
 */
export function LinkedFolderFiles({ reference, owner }: { reference: { drive_id: string; item_id: string }; owner?: ReferenceOwner }) {
  const { t } = useTranslation('recordFolders');
  const { t: tv } = useTranslation('documentViewer');
  const viewer = useOptionalDocumentViewer();
  const { drive_id, item_id } = reference;
  // Coming back to a folder shows its cached listing at once and re-reads it in the background, so a file added in Microsoft appears without waiting.
  const query = useQuery({
    queryKey: ['linked-folder-files', drive_id, item_id],
    queryFn: () => listChildren(drive_id, item_id),
    staleTime: 0,
    retry: false,
  });
  const items: GraphItem[] = query.data?.value ?? [];
  const partial = query.data?.next != null;

  if (query.isPending || (query.isError && query.isFetching)) {
    return <ListState variant="loading" shape="cards" rows={3} loadingLabel={t('folderFiles.loading', 'Loading files…')} loadingRole="status" />;
  }
  if (query.isError) {
    return (
      <M365BrowseNotice
        code={(query.error as { code?: string } | null)?.code}
        onRetry={() => { void query.refetch(); }}
        linkedFolder
      />
    );
  }
  if (items.length === 0) {
    return <p className="text-control text-muted-foreground">{t('folderFiles.empty', 'This folder is empty.')}</p>;
  }
  return (
    <div className="min-w-0 space-y-1.5">
      <ul aria-label={t('folderFiles.list', 'Files in this folder')} className="max-h-72 overflow-auto rounded-md border border-border">
        {items.map((file) => (
          <li key={file.item_id} className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-0.5 border-b border-border px-3 py-2 text-control last:border-b-0">
            <Icon name={file.item_kind === 'folder' ? 'folder' : 'doc'} className="shrink-0 self-center text-muted-foreground" />
            <span className="min-w-0 flex-1 break-words font-medium text-foreground">{file.name}</span>
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
              className="touch-target text-primary-text underline underline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
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
