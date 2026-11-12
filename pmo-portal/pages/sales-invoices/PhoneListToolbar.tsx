import React from 'react';
import { useTranslation } from 'react-i18next';
import { MobileToolbarDisclosure, RecordMenu, type RecordMenuItem } from '@/src/components/ui';

/**
 * The receivables phone toolbar: search and one Filters disclosure share a row, the less-used actions
 * (Export, the other create action) sit in the ⋯ menu, so the first row of the list shows without scrolling.
 */
export const PhoneListToolbar: React.FC<{
  search: React.ReactNode;
  filters: React.ReactNode;
  activeFilters: number;
  menuItems: RecordMenuItem[];
  selectionBar?: React.ReactNode;
}> = ({ search, filters, activeFilters, menuItems, selectionBar }) => {
  const { t } = useTranslation();
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2">
      <div className="min-w-0 flex-1">{search}</div>
      {/* `contents` puts the trigger in this row; the opened panel drops to its own full-width line below. */}
      <MobileToolbarDisclosure
        label={t('finance:receivables.filters', 'Filters')}
        count={activeFilters}
        className="contents [&>[role=region]]:order-last [&>[role=region]]:basis-full"
      >
        {filters}
      </MobileToolbarDisclosure>
      <RecordMenu items={menuItems} ariaLabel={t('finance:receivables.moreActions', 'More actions')} />
      {selectionBar && <div className="order-last basis-full">{selectionBar}</div>}
    </div>
  );
};
