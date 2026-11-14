import React from 'react';
import { useTranslation } from 'react-i18next';
import { Toolbar } from './DataTable';
import { useIsDesktop } from './useIsDesktop';
import { Card } from './Card';
import { PageHeader } from './PageHeader';

export interface ListPageProps {
  /** Page H1 (the entity noun — "Companies", "Projects", "Pipeline", …). */
  title: React.ReactNode;
  /** Embedded pages use a compact h2 while standalone list routes remain h1. */
  headingLevel?: 1 | 2;
  /**
   * @deprecated No sentence sits under a page title (screen rule "Words"). Callers still passing one are
   * listed in `scripts/header-subtitle-allowlist.json`; the screen sweeps delete the prop (some carry a basis
   * statement that needs a home first), and a new caller fails the guard.
   */
  description?: React.ReactNode;
  /** The page's ONE help control (what a definition on this screen means). */
  help?: React.ReactNode;
  /**
   * Optional result count chip riding alongside the title. Rendered only when a
   * number is supplied (0 still renders, so an empty list reads "0").
   */
  count?: number;
  /** Total count before filters. */
  total?: number;
  /**
   * The single per-screen primary CTA ("New <Entity>" / "Raise request" / …),
   * gated by the consumer. Lives top-right in the header row.
   */
  primaryAction?: React.ReactNode;

  // --- toolbar slots (fixed canonical order, empty slots held in place) ---
  /** Left-most: status filter segments / text chips. */
  filters?: React.ReactNode;
  /** The `SearchMini` field. */
  search?: React.ReactNode;
  /** Secondary `Filter` controls (e.g. customer / company / PM select dropdowns). */
  secondaryFilter?: React.ReactNode;
  /** `ExportButton`. */
  exportAction?: React.ReactNode;
  /** `ImportButton` (master-data lists). */
  importAction?: React.ReactNode;
  /** The `ViewToggle` view-switcher — rendered right-aligned (icon segmented). */
  view?: React.ReactNode;

  /**
   * OPT-IN phone-width toolbar (FR-PRJUX-001). When supplied AND the viewport is below its
   * breakpoint (defaults to `md`, 768px), it is rendered as the SOLE `list-page-toolbar`,
   * replacing the desktop slots (status/filters/search/secondaryFilter/export/import/view).
   * `mobileToolbarBreakpoint` lets a denser toolbar keep this composition through tablet widths.
   * Projects is the only adopter.
   */
  mobileToolbar?: React.ReactNode;
  /** Viewport width at which the canonical desktop toolbar replaces `mobileToolbar` (default 768px). */
  mobileToolbarBreakpoint?: number;
  /** Page-specific desktop toolbar layout refinements. */
  desktopToolbarClassName?: string;

  /** Embedded under a page that already names the list (a switch labels it): no second title, help or count chip. */
  hideHeader?: boolean;

  /** Optional banner (e.g. an in-use delete `GateNotice`) above the toolbar. */
  banner?: React.ReactNode;
  /** Body — the table / board / cards / calendar render + list states. */
  children?: React.ReactNode;
  /** Frame the primary list/board body as a panel on the content canvas. */
  bodyPanel?: boolean;
  className?: string;
}

/**
 * Canonical list-page shell (DESIGN.md §7 "ListPage shell"). ONE anatomy for
 * every module's list so they read the same:
 *
 *   [title + count] … [primary "New <Entity>"]
 *   toolbar: status/filter controls · fixed search · view/actions
 *
 * Groups keep status/filter controls, search, and view/actions in reading order
 * on phones and on the desktop row.
 */
export const ListPage: React.FC<ListPageProps> = ({
  title,
  headingLevel = 1,
  help,
  description,
  count,
  total,
  primaryAction,
  filters,
  search,
  secondaryFilter,
  exportAction,
  importAction,
  view,
  mobileToolbar,
  mobileToolbarBreakpoint = 768,
  desktopToolbarClassName,
  hideHeader = false,
  banner,
  children,
  bodyPanel = false,
  className,
}) => {
  const { t } = useTranslation();
  const isBelowToolbarBreakpoint = !useIsDesktop(mobileToolbarBreakpoint);
  // A slot is "present" only when it renders something. Pages gate slots with
  // `state !== 'loading' && (…)`, which yields `false` during loading — so a
  // falsy slot (false/null/undefined) means absent, and the whole toolbar is
  // omitted (matching the per-page "hide the toolbar while loading" behavior).
  const hasToolbar = Boolean(
    filters || search || secondaryFilter || exportAction || importAction || view || mobileToolbar,
  );
  const useMobileToolbar = Boolean(mobileToolbar) && isBelowToolbarBreakpoint;

  return (
    <div className={className}>
      {hideHeader ? (
        count !== undefined && total !== undefined && count < total && (
          <p className="mb-2 text-control text-muted-foreground">{t('ui.listPage.showingOf', 'Showing {{count}} of {{total}}', { count, total })}</p>
        )
      ) : (
        <PageHeader
          data-testid="list-page-header"
          title={title}
          headingLevel={headingLevel}
          help={help}
          action={primaryAction}
          count={count === undefined ? undefined : total !== undefined && count < total
            ? t('ui.listPage.showingOf', 'Showing {{count}} of {{total}}', { count, total })
            : count}
        />
      )}
      {description && <p className="-mt-2 mb-4 max-w-[68ch] text-sm text-muted-foreground">{description}</p>}

      {banner}

      {hasToolbar &&
        (useMobileToolbar ? (
          <Toolbar
            standalone
            data-testid="list-page-toolbar"
            className="flex-col items-stretch gap-2.5"
          >
            {mobileToolbar}
          </Toolbar>
        ) : (
          <Toolbar standalone data-testid="list-page-toolbar" className={`grid min-w-0 grid-cols-1 gap-2 md:grid-cols-[minmax(0,1fr)_220px_auto] md:items-center ${desktopToolbarClassName ?? ''}`}>
            {(filters || secondaryFilter) && (
              <div data-testid="list-page-filter-group" className="flex min-w-0 flex-wrap items-center gap-2 md:col-start-1 md:row-start-1">
                {filters}
                {secondaryFilter}
              </div>
            )}
            {search && <div data-testid="list-page-search-group" className="min-w-0 md:col-start-2 md:row-start-1">{search}</div>}
            {(view || exportAction || importAction) && (
              <div data-testid="list-page-action-group" className="flex min-w-0 flex-wrap items-center gap-2 md:col-start-3 md:row-start-1">
                {view && <div data-testid="list-page-view" className="shrink-0">{view}</div>}
                {exportAction}
                {importAction}
              </div>
            )}
          </Toolbar>
        ))}

      {bodyPanel ? <Card className="min-w-0 overflow-hidden">{children}</Card> : children}
    </div>
  );
};
