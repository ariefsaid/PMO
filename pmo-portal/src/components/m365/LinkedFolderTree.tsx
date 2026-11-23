import { useState } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Button, Icon, type IconName } from '@/src/components/ui';
import { cn } from '@/src/components/ui/cn';
import { listChildren, type GraphItem } from '@/src/lib/m365/graphClient';
import { validMicrosoftBrowserUrl } from '@/src/lib/m365/reference';
import { formatDay } from '@/src/lib/format';
import { getNumberLocale } from '@/src/lib/locale/activeLocale';
import { M365BrowseNotice } from './M365BrowseNotice';

/** A linked folder at the top of the tree: its stored reference (never user input) and its PMO title. */
export interface FolderTreeRoot {
  key: string;
  title: string;
  drive_id: string;
  item_id: string;
  web_url: string;
}

/** Name | Modified | Size. Below `sm` the row stacks: name, then modified · size. */
const ROW_GRID = 'grid min-w-0 grid-cols-1 items-center gap-x-4 sm:grid-cols-[minmax(0,1fr)_7rem_5.5rem]';
const INDENT_REM = 1.25;
/** Chevron (1rem) + gap + type icon (1rem) + gap: where a row's name starts within its level. */
const LEAD_REM = 3;

const SHEET = /\.(xlsx?|xlsm|csv|ods|numbers)$/i;
function fileIcon(name: string): IconName {
  return SHEET.test(name) ? 'table' : 'doc';
}

/** "812 B", "284 kB", "8.3 MB": decimal units, at most three significant digits, in the reader's number locale. */
export function formatFileSize(bytes: number | null | undefined, locale = getNumberLocale()): string {
  if (bytes == null) return '';
  if (bytes < 1000) return `${bytes} B`;
  const units = ['byte', 'kilobyte', 'megabyte', 'gigabyte', 'terabyte'] as const;
  let value = bytes;
  let unit = 0;
  while (value >= 1000 && unit < units.length - 1) { value /= 1000; unit += 1; }
  return new Intl.NumberFormat(locale, {
    style: 'unit', unit: units[unit], unitDisplay: 'short', maximumSignificantDigits: 3,
  }).format(value);
}

/**
 * The linked Microsoft folders of a record as an expandable folder and file tree. Each level is read
 * on demand through the caller's own Microsoft connection (the existing custody proxy; metadata only,
 * nothing copied or stored), so what a person sees is exactly what Microsoft lets them open. A file
 * opens in SharePoint in a new tab.
 */
export function LinkedFolderTree({ roots }: { roots: FolderTreeRoot[] }) {
  const { t } = useTranslation('recordFolders');
  return (
    <div className="min-w-0">
      <div className={cn(ROW_GRID, 'border-b border-border px-4 py-2 text-control text-muted-foreground max-sm:hidden')} aria-hidden>
        <span>{t('folderTree.name', 'Name')}</span>
        <span>{t('folderTree.modified', 'Modified')}</span>
        <span className="text-right">{t('folderTree.size', 'Size')}</span>
      </div>
      <ul aria-label={t('folderTree.label', 'Project folder')} className="min-w-0">
        {roots.map((root) => (
          <FolderNode
            key={root.key}
            level={0}
            initiallyOpen
            item={{ drive_id: root.drive_id, item_id: root.item_id, name: root.title, web_url: root.web_url, modified_at: null, size: null }}
          />
        ))}
      </ul>
    </div>
  );
}

type NodeItem = Pick<GraphItem, 'drive_id' | 'item_id' | 'name' | 'web_url' | 'modified_at' | 'size'>;

function Cells({ item, level, lead, name }: { item: NodeItem; level: number; lead: React.ReactNode; name: React.ReactNode }) {
  const modified = item.modified_at ? formatDay(item.modified_at) : '';
  const size = formatFileSize(item.size);
  return (
    <>
      <span className="flex min-w-0 items-center gap-2" style={{ paddingLeft: `${level * INDENT_REM}rem` }}>
        {lead}
        {name}
      </span>
      <span className="tabular text-control text-muted-foreground max-sm:hidden">{modified}</span>
      <span className="tabular text-right text-control text-muted-foreground max-sm:hidden">{size}</span>
      {(modified || size) && (
        <span className="tabular text-control text-muted-foreground sm:hidden" style={{ paddingLeft: `${level * INDENT_REM + LEAD_REM}rem` }}>
          {[modified, size].filter(Boolean).join(' · ')}
        </span>
      )}
    </>
  );
}

const ROW = 'min-h-11 border-b border-border px-4 py-1.5 text-control sm:min-h-10';

function FolderNode({ item, level, initiallyOpen = false }: { item: NodeItem; level: number; initiallyOpen?: boolean }) {
  const [open, setOpen] = useState(initiallyOpen);
  return (
    <li className="min-w-0">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className={cn(ROW_GRID, ROW, 'w-full text-left hover:bg-accent focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring')}
      >
        <Cells
          item={item}
          level={level}
          lead={(
            <>
              <Icon name="chev" aria-hidden className={cn('size-4 shrink-0 text-muted-foreground transition-transform', open && 'rotate-90')} />
              <Icon name="folder" aria-hidden className="size-4 shrink-0 text-muted-foreground" />
            </>
          )}
          name={<span className={cn('min-w-0 break-words text-foreground', level === 0 ? 'font-semibold' : 'font-medium')}>{item.name}</span>}
        />
      </button>
      {open && <FolderChildren item={item} level={level + 1} />}
    </li>
  );
}

function StateRow({ level, children, role }: { level: number; children: React.ReactNode; role?: 'status' }) {
  return (
    <li role={role} className={cn(ROW, 'flex items-center')}>
      <span className="min-w-0 flex-1" style={{ paddingLeft: `${level * INDENT_REM + LEAD_REM}rem` }}>{children}</span>
    </li>
  );
}

function FolderChildren({ item, level }: { item: NodeItem; level: number }) {
  const { t } = useTranslation('recordFolders');
  const query = useInfiniteQuery({
    queryKey: ['linked-folder-tree', item.drive_id, item.item_id],
    queryFn: ({ pageParam }) => listChildren(item.drive_id, item.item_id, pageParam ?? undefined),
    initialPageParam: null as Parameters<typeof listChildren>[2] | null,
    getNextPageParam: (page) => page.next ?? undefined,
    staleTime: 0, // like LinkedFolderFiles (#2114): reopening shows the cached level at once and re-reads it
    retry: false,
  });

  if (query.isPending || (query.isError && query.isFetching && !query.data)) {
    return (
      <ul className="min-w-0">
        <StateRow level={level} role="status">
          <span className="inline-flex items-center gap-2 text-muted-foreground">
            <span aria-hidden className="h-2.5 w-40 max-w-full animate-pulse rounded bg-muted" />
            <span className="sr-only">{t('folderFiles.loading', 'Loading files…')}</span>
          </span>
        </StateRow>
      </ul>
    );
  }
  if (query.isError && !query.data) {
    return (
      <ul className="min-w-0">
        <StateRow level={level}>
          <div className="py-1.5">
            <M365BrowseNotice code={(query.error as { code?: string } | null)?.code} onRetry={() => { void query.refetch(); }} linkedFolder />
          </div>
        </StateRow>
      </ul>
    );
  }
  const items = (query.data?.pages ?? []).flatMap((page) => page.value);
  const folders = items.filter((child) => child.item_kind === 'folder');
  const files = items.filter((child) => child.item_kind !== 'folder');
  return (
    <ul className="min-w-0">
      {items.length === 0 && (
        <StateRow level={level}><span className="text-muted-foreground">{t('folderTree.empty', 'Empty folder')}</span></StateRow>
      )}
      {[...folders, ...files].map((child) => child.item_kind === 'folder'
        ? <FolderNode key={child.item_id} item={child} level={level} />
        : <FileRow key={child.item_id} item={child} level={level} />)}
      {query.hasNextPage && (
        <StateRow level={level}>
          <Button variant="ghost" size="sm" loading={query.isFetchingNextPage} onClick={() => { void query.fetchNextPage(); }}>
            {t('folderTree.more', 'Show more')}
          </Button>
        </StateRow>
      )}
    </ul>
  );
}

function FileRow({ item, level }: { item: NodeItem; level: number }) {
  const { t } = useTranslation('recordFolders');
  const openable = validMicrosoftBrowserUrl(item.web_url);
  const lead = (
    <>
      <span aria-hidden className="size-4 shrink-0" />
      <Icon name={fileIcon(item.name)} aria-hidden className="size-4 shrink-0 text-muted-foreground" />
    </>
  );
  const name = <span className="min-w-0 break-words text-foreground underline-offset-2 group-hover:underline">{item.name}</span>;
  return (
    <li className="min-w-0">
      {openable ? (
        <a
          href={item.web_url}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={t('folderTree.openNamed', 'Open {{name}} in SharePoint', { name: item.name })}
          className={cn(ROW_GRID, ROW, 'group hover:bg-accent focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring')}
        >
          <Cells item={item} level={level} lead={lead} name={name} />
        </a>
      ) : (
        <div className={cn(ROW_GRID, ROW)}><Cells item={item} level={level} lead={lead} name={name} /></div>
      )}
    </li>
  );
}
