import React from 'react';
import { useTranslation } from 'react-i18next';
import { Button, GateNotice } from '@/src/components/ui';
import type { OwnAdvanceOptions } from './useOwnAdvanceOptions';

type AdvanceLoad = Pick<OwnAdvanceOptions, 'isPending' | 'isError' | 'refetch'>;

export const AdvanceLoadNotice: React.FC<{ advances: AdvanceLoad }> = ({ advances }) => {
  const { t } = useTranslation();
  if (advances.isError) {
    return (
      <GateNotice variant="blocked" className="col-span-full">
        <p>{t('expenseClaims:advances.loadError', "Couldn't load your advances. Saving is paused so this claim isn't filed without its advance.")}</p>
        <Button variant="outline" size="sm" className="mt-2" onClick={advances.refetch}>{t('expenseClaims:advances.retry', 'Retry')}</Button>
      </GateNotice>
    );
  }
  if (advances.isPending) {
    return <p role="status" className="col-span-full text-xs text-muted-foreground">{t('expenseClaims:advances.loading', 'Loading your advances…')}</p>;
  }
  return null;
};
