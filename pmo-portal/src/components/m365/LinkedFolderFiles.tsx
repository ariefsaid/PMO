import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Icon } from '@/src/components/ui';
import { useOptionalDocumentViewer } from '@/src/components/documents/viewerContext';
import { folderChildTarget } from '@/src/components/documents/targets/reference';
import type { ReferenceOwner } from '@/src/lib/m365/reference';
import { listChildren, type GraphItem } from '@/src/lib/m365/graphClient';
import { formatInstantDate } from '@/src/lib/format';
import { M365BrowseNotice } from './M365BrowseNotice';

type State = { loading: true } | { loading: false; error: unknown; items: GraphItem[]; partial: boolean };

/**
 * The files inside a linked Microsoft folder, read live through the caller's own M365 connection
 * (metadata only: nothing is copied or stored). The drive/item ids come from the stored reference,
 * never from user input. Mounted only while the folder is expanded, so it reads on open.
 */
export function LinkedFolderFiles({ reference, owner }: { reference: { drive_id: string; item_id: string }; owner?: ReferenceOwner }) {
  const { t } = useTranslation('recordFolders');
  const { t: tv } = useTranslation('documentViewer');
  const viewer = useOptionalDocumentViewer();
  const [state, setState] = useState<State>({ loading: true });
  const [attempt, setAttempt] = useState(0);
  const generation = useRef(0);
  const { drive_id, item_id } = reference;

  useEffect(() => {
    const seq = ++generation.current;
    listChildren(drive_id, item_id)
      .then((page) => { if (seq === generation.current) setState({ loading: false, error: null, items: page.value, partial: page.next != null }); })
      .catch((error: unknown) => { if (seq === generation.current) setState({ loading: false, error, items: [], partial: false }); });
    return () => { generation.current += 1; };
  }, [drive_id, item_id, attempt]);

  if (state.loading) {
    return <p role="status" className="text-[12.5px] text-muted-foreground">{t('folderFiles.loading', 'Loading files…')}</p>;
  }
  if (state.error != null) {
    return (
      <M365BrowseNotice
        code={(state.error as { code?: string } | null)?.code}
        onRetry={() => { setState({ loading: true }); setAttempt((n) => n + 1); }}
        linkedFolder
      />
    );
  }
  if (state.items.length === 0) {
    return <p className="text-[12.5px] text-muted-foreground">{t('folderFiles.empty', 'This folder is empty.')}</p>;
  }
  return (
    <div className="min-w-0 space-y-1.5">
      <ul aria-label={t('folderFiles.list', 'Files in this folder')} className="max-h-72 overflow-auto rounded-md border border-border">
        {state.items.map((file) => (
          <li key={file.item_id} className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-0.5 border-b border-border px-3 py-2 text-[13px] last:border-b-0">
            <Icon name={file.item_kind === 'folder' ? 'folder' : 'doc'} className="shrink-0 self-center text-muted-foreground" />
            <span className="min-w-0 flex-1 break-words font-medium text-foreground">{file.name}</span>
            {file.modified_at && <span className="tabular text-[12px] text-muted-foreground">{formatInstantDate(file.modified_at)}</span>}
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
      {state.partial && <p className="text-[12px] text-muted-foreground">{t('folderFiles.partial', 'Showing the first files only. Open the folder in Microsoft to see the rest.')}</p>}
    </div>
  );
}
