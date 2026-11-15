import React from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from './Button';
import { Icon } from './icons';
import { pageWindow } from './pageWindow';
import { useIsDesktop } from './useIsDesktop';

export interface PaginationState {
  /** 1-based current page. */
  page: number;
  pageSize: number;
  onPageChange: (page: number) => void;
}

/**
 * The shared table foot for a paged list (#843): "Showing 1–50 of 205" at the left, numbered pages with
 * Previous/Next at the right. The page itself is owned by the caller (the address), not by this control.
 */
export const PaginationFooter: React.FC<{ pagination: PaginationState; total: number; shown: number }> = ({ pagination, total, shown }) => {
  const { t } = useTranslation('projects');
  const wide = useIsDesktop();
  const { page, pageSize, onPageChange } = pagination;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const from = shown === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = (page - 1) * pageSize + shown;
  const cell = 'min-h-11 min-w-11 px-2 sm:min-h-8 sm:min-w-8 tabular-nums';
  return (
    <div className="flex flex-col gap-3 border-t border-border/70 px-[var(--table-cell-inset)] py-3 sm:flex-row sm:items-center sm:justify-between">
      <p role="status" className="text-control text-muted-foreground tabular-nums">
        {t('listPage.showingRange', { defaultValue: 'Showing {{from}}–{{to}} of {{total}}', from, to, total })}
      </p>
      {pageCount > 1 && (
        <nav aria-label={t('pagination.label', 'Pagination')} className="flex items-center sm:gap-1">
          <Button variant="ghost" size="sm" className={cell} disabled={page <= 1}
            aria-label={t('pagination.previousAria', 'Previous page')} onClick={() => onPageChange(page - 1)}>
            <Icon name="chev" aria-hidden className="size-3.5 rotate-180 sm:hidden" />
            <span className="hidden sm:inline">{t('pagination.previous', 'Previous')}</span>
          </Button>
          {pageWindow(page, pageCount, wide ? 1 : 0).map((p, i) => p === 'gap'
            ? <span key={`gap-${i}`} aria-hidden="true" className="px-1 text-muted-foreground">…</span>
            : (
              <Button key={p} variant={p === page ? 'outline' : 'ghost'} size="sm" className={cell}
                aria-label={t('pagination.page', { defaultValue: 'Page {{page}}', page: p })}
                aria-current={p === page ? 'page' : undefined} onClick={() => onPageChange(p)}>
                {p}
              </Button>
            ))}
          <Button variant="ghost" size="sm" className={cell} disabled={page >= pageCount}
            aria-label={t('pagination.nextAria', 'Next page')} onClick={() => onPageChange(page + 1)}>
            <span className="hidden sm:inline">{t('pagination.next', 'Next')}</span>
            <Icon name="chev" aria-hidden className="size-3.5 sm:hidden" />
          </Button>
        </nav>
      )}
    </div>
  );
};
