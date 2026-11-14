import React from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Card, CardHead, CardPad, ListState, StatusPill } from '@/src/components/ui';
import { useProjectsByClient, useProcurementsByVendor } from '@/src/hooks/useCompanies';

/**
 * The company record page's related-record sections (CROSS-68): the shared presentational list
 * plus the related-projects and related-procurement cards, moved verbatim off CompanyDetail.
 * Card wrapper and gating stay with the data hooks here; the page only composes.
 */

// ── RelatedList — shared presentational component for related-object lists ───
//
// AC-IFW-COMPANY-01: eliminates the ~45-line duplication between RelatedProjects
// and RelatedProcurement. Both sections share the same load/empty/error/list shape;
// the only differences are the card heading, the empty label, the link href, and
// which text fields to display (title vs name, optional subtitle).

interface RelatedItem {
  id: string;
  title: string;
  subtitle?: string | null;
}

interface RelatedListProps {
  record: 'project' | 'procurement';
  heading: string;
  items: RelatedItem[];
  isPending: boolean;
  isError: boolean;
  hrefFor: (id: string) => string;
  emptyLabel: string;
  listAriaLabel: string;
  onRetry: () => void;
}

/**
 * Presentational list for "related objects" cards (AC-IFW-COMPANY-01). Handles
 * loading / empty / error / populated states via the shared `ListState` component.
 * Each item renders as a Link row. The card wrapper and gating (Vendor-only etc.)
 * remain with the calling component.
 */
const RelatedList: React.FC<RelatedListProps> = ({
  record,
  heading,
  items,
  isPending,
  isError,
  hrefFor,
  emptyLabel,
  listAriaLabel,
  onRetry,
}) => {
  const { t } = useTranslation();
  return (
  <Card variant="bare" className="mb-4">
    <CardHead>{heading}</CardHead>
    <CardPad>
      {isPending && <ListState variant="loading" rows={2} />}
      {isError && !isPending && (
        <ListState
          variant="error"
          title={t('companyDetail.related.loadError', "Couldn't load {{section}}", {
            section: heading.toLowerCase(),
          })}
          sub={t('companyDetail.related.loadErrorSub', 'Something went wrong. Try again.')}
          onRetry={onRetry}
        />
      )}
      {!isPending && !isError && items.length === 0 && (
        <p className="text-control text-muted-foreground">{emptyLabel}</p>
      )}
      {!isPending && !isError && items.length > 0 && (
        <ul className="flex flex-col gap-1" aria-label={listAriaLabel}>
          {items.map((item) => (
            <li key={item.id}>
              <Link
                to={hrefFor(item.id)}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              >
                <span className="text-[14px] font-medium text-foreground">{item.title}</span>
                {item.subtitle && (
                  /* Fix #9 — Tinted-Status rule: status must be a dot+pill, never bare grey text. */
                  <StatusPill record={record} state={item.subtitle} />
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </CardPad>
  </Card>
  );
};

/**
 * AC-IFW-COMPANY-01: Related projects list (client view). Shows all projects where the
 * company is the client — clickable rows that navigate to /projects/:id. Always rendered.
 */
export const RelatedProjects: React.FC<{ companyId: string }> = ({ companyId }) => {
  const { t } = useTranslation();
  const { data, isPending, isError, refetch } = useProjectsByClient(companyId);
  const items = (data ?? []).map((p) => ({ id: p.id, title: p.name, subtitle: p.status ?? null }));

  return (
    <RelatedList
      record="project"
      heading={t('companyDetail.relatedProjects.heading', 'Related projects')}
      items={items}
      isPending={isPending}
      isError={isError}
      hrefFor={(id) => `/projects/${id}`}
      emptyLabel={t('companyDetail.relatedProjects.empty', 'No related projects yet')}
      listAriaLabel={t('companyDetail.relatedProjects.heading', 'Related projects')}
      onRetry={() => refetch()}
    />
  );
};

/**
 * AC-IFW-COMPANY-01 + AC-G3C-CD-3: Related procurement list. Shows all PRs where the company
 * is the vendor — clickable rows that navigate to /procurement/:id.
 *
 * CD-3 fix: no longer gated solely on `type==='Vendor'` — renders for ANY company type when
 * `useProcurementsByVendor` returns rows (dual-role accounts have vendor PRs even when typed
 * "Client"). For Vendor companies the card always renders (showing empty state if none). For
 * non-Vendor companies the card is suppressed when genuinely empty (hide-when-empty).
 */
export const RelatedProcurement: React.FC<{ companyId: string; isVendor: boolean }> = ({ companyId, isVendor }) => {
  const { t } = useTranslation();
  const { data, isPending, isError, refetch } = useProcurementsByVendor(companyId);
  const items = (data ?? []).map((pr) => ({ id: pr.id, title: pr.title, subtitle: pr.status ?? null }));

  // For non-Vendor companies suppress the card when there are no rows (genuinely empty).
  // Vendor companies always show the card so they can see "No procurement yet" clearly.
  if (!isVendor && !isPending && !isError && items.length === 0) return null;

  return (
    <RelatedList
      record="procurement"
      heading={t('companyDetail.relatedProcurement.heading', 'Procurement')}
      items={items}
      isPending={isPending}
      isError={isError}
      hrefFor={(id) => `/procurement/${id}`}
      emptyLabel={t('companyDetail.relatedProcurement.empty', 'No procurement yet')}
      listAriaLabel={t('companyDetail.relatedProcurement.listLabel', 'Procurement list')}
      onRetry={() => refetch()}
    />
  );
};
