import React from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/src/components/ui';
import { ACTIVITY_PAGE_SIZE } from '@/src/lib/db/crmActivities';

/**
 * Footer of the paged activity timelines (#1990): says how many rows are shown and offers
 * "Show more" for as long as older activity exists. Renders nothing for a timeline that fits
 * on the first page, so short timelines look exactly as before.
 */
export const ActivityShowMore: React.FC<{
  shown: number;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  onShowMore: () => void;
}> = ({ shown, hasNextPage, isFetchingNextPage, onShowMore }) => {
  const { t } = useTranslation();
  if (!hasNextPage && shown <= ACTIVITY_PAGE_SIZE) return null;
  return (
    <div className="mt-3 flex items-center justify-between gap-2">
      <span data-testid="activity-shown-count" className="text-[12px] text-muted-foreground">
        {hasNextPage
          ? t('crm:activityShownRecent', 'Showing the {{shown}} most recent', { shown })
          : t('crm:activityShownAll', 'Showing all {{shown}}', { shown })}
      </span>
      {hasNextPage && (
        <Button variant="ghost" size="sm" loading={isFetchingNextPage} onClick={onShowMore}>
          {t('crm:activityShowMore', 'Show more')}
        </Button>
      )}
    </div>
  );
};
