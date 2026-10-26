import React from 'react';
import { Toolbar } from './DataTable';
import { useIsDesktop } from './useIsDesktop';
import { PageHeading } from './PageHeading';

export interface ListPageProps {
  /** Page H1 (the entity noun — "Companies", "Projects", "Pipeline", …). */
  title: React.ReactNode;
  /** One-line page subtitle below the title. */
  description?: React.ReactNode;
  /**
   * Optional result count chip riding alongside the title. Rendered only when a
   * number is supplied (0 still renders, so an empty list reads "0").
   */
  count?: number;
  /**
   * The single per-screen primary CTA ("New <Entity>" / "Raise request" / …),
   * gated by the consumer. Lives top-right in the header row.
   */
  primaryAction?: React.ReactNode;
  /** Place a collection primary after the toolbar controls instead of beside the title. */
  primaryActionPlacement?: 'heading' | 'toolbar';

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
   * OPT-IN phone-width toolbar (FR-PRJUX-001). When supplied AND the viewport is below
   * `md` (768px) it is rendered as the SOLE `list-page-toolbar`, replacing the desktop
   * slots (status/filters/search/secondaryFilter/export/import/view). At `md` and wider —
   * or when this prop is omitted — the canonical desktop toolbar renders exactly as before.
   * Projects is the only adopter.
   */
  mobileToolbar?: React.ReactNode;
  /** Page-specific desktop toolbar layout refinements. */
  desktopToolbarClassName?: string;
  /** Place search before the collection scope filters (used by the Projects workflow). */
  searchFirst?: boolean;
  /** Put view selection before secondary export/import actions in visual and keyboard order. */
  viewBeforeActions?: boolean;

  /** Optional banner (e.g. an in-use delete `GateNotice`) above the toolbar. */
  banner?: React.ReactNode;
  /** Body — the table / board / cards / calendar render + list states. */
  children?: React.ReactNode;
  className?: string;
}

/**
 * Canonical list-page shell (DESIGN.md §7 "ListPage shell"). ONE anatomy for
 * every module's list so they read the same:
 *
 *   [title + count] … [primary "New <Entity>"]
 *   toolbar: filters · search · secondaryFilter · export · import   …   view-switcher (right)
 *
 * The slot order is fixed and empty slots are held in place (no reflow). Status
 * **filters** render left as text chips; the **view-switcher** renders
 * right-aligned (icon segmented) so the two strips are never confused
 * (filter-vs-view trap). Each page supplies its OWN columns/filters/views as
 * slots — the shell is shared, the content is per-page.
 */
export const ListPage: React.FC<ListPageProps> = ({
  title,
  description,
  count,
  primaryAction,
  primaryActionPlacement = 'heading',
  filters,
  search,
  secondaryFilter,
  exportAction,
  importAction,
  view,
  mobileToolbar,
  desktopToolbarClassName,
  searchFirst = false,
  viewBeforeActions = false,
  banner,
  children,
  className,
}) => {
  const isBelowMd = !useIsDesktop();
  // A slot is "present" only when it renders something. Pages gate slots with
  // `state !== 'loading' && (…)`, which yields `false` during loading — so a
  // falsy slot (false/null/undefined) means absent, and the whole toolbar is
  // omitted (matching the per-page "hide the toolbar while loading" behavior).
  const hasToolbar = Boolean(
    filters || search || secondaryFilter || exportAction || importAction || view || mobileToolbar,
  );
  const useMobileToolbar = Boolean(mobileToolbar) && isBelowMd;
  const toolbarPrimaryAction = primaryActionPlacement === 'toolbar' && hasToolbar ? primaryAction : undefined;
  const headingPrimaryAction = toolbarPrimaryAction ? undefined : primaryAction;

  return (
    <div className={className}>
      <div data-testid="list-page-header" className="mb-4">
        <PageHeading
          kind="collection"
          title={title}
          scope={description}
          status={count !== undefined && (
            <span
              data-testid="list-page-count"
              className="inline-flex h-[22px] min-w-[22px] items-center justify-center rounded-full bg-secondary px-2 text-[12.5px] font-semibold tabular text-muted-foreground"
            >
              {count}
            </span>
          )}
          actions={headingPrimaryAction}
        />
      </div>

      {banner}

      {hasToolbar &&
        (useMobileToolbar ? (
          <Toolbar
            standalone
            data-testid="list-page-toolbar"
            className="flex-col items-stretch gap-2.5"
          >
            {mobileToolbar}
            {toolbarPrimaryAction && (
              <div data-testid="page-primary-action-slot" data-page-primary-action-slot="collection-toolbar" className="flex w-full justify-end max-sm:[&>*]:min-h-11 max-sm:[&>*]:w-full">
                {toolbarPrimaryAction}
              </div>
            )}
          </Toolbar>
        ) : (
          <Toolbar standalone data-testid="list-page-toolbar" className={desktopToolbarClassName}>
            {searchFirst ? search : filters}
            {searchFirst ? filters : search}
            {secondaryFilter}
            {viewBeforeActions && view && (
              <div data-testid="list-page-view" className="ml-auto">
                {view}
              </div>
            )}
            {exportAction}
            {importAction}
            {!viewBeforeActions && view && (
              <div data-testid="list-page-view" className="ml-auto">
                {view}
              </div>
            )}
            {toolbarPrimaryAction && (
              <div data-testid="page-primary-action-slot" data-page-primary-action-slot="collection-toolbar" className="basis-full flex justify-end xl:col-span-full">
                {toolbarPrimaryAction}
              </div>
            )}
          </Toolbar>
        ))}

      {children}
    </div>
  );
};
