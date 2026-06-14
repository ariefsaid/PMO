import React from 'react';
import { Toolbar } from './DataTable';

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
  filters,
  search,
  secondaryFilter,
  exportAction,
  importAction,
  view,
  banner,
  children,
  className,
}) => {
  // A slot is "present" only when it renders something. Pages gate slots with
  // `state !== 'loading' && (…)`, which yields `false` during loading — so a
  // falsy slot (false/null/undefined) means absent, and the whole toolbar is
  // omitted (matching the per-page "hide the toolbar while loading" behavior).
  const hasToolbar = Boolean(
    filters || search || secondaryFilter || exportAction || importAction || view,
  );

  return (
    <div className={className}>
      <div
        data-testid="list-page-header"
        className="mb-4 flex flex-wrap items-start justify-between gap-3"
      >
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-[24px] font-bold tracking-[-0.02em]">{title}</h1>
            {count !== undefined && (
              <span
                data-testid="list-page-count"
                className="inline-flex h-[22px] min-w-[22px] items-center justify-center rounded-full bg-secondary px-2 text-[12.5px] font-semibold tabular text-muted-foreground"
              >
                {count}
              </span>
            )}
          </div>
          {description && (
            <p className="mt-0.5 max-w-[68ch] text-sm text-muted-foreground">{description}</p>
          )}
        </div>
        {primaryAction}
      </div>

      {banner}

      {hasToolbar && (
        <Toolbar standalone data-testid="list-page-toolbar">
          {filters}
          {search}
          {secondaryFilter}
          {exportAction}
          {importAction}
          {view && (
            <div data-testid="list-page-view" className="ml-auto">
              {view}
            </div>
          )}
        </Toolbar>
      )}

      {children}
    </div>
  );
};
