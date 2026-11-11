import React from 'react';
import { useTranslation } from 'react-i18next';
import { Button, GateNotice } from '@/src/components/ui';
import type { ProjectLoad } from './useProjectChoices';

export const ProjectLoadNotice: React.FC<{ projects: ProjectLoad }> = ({ projects }) => {
  const { t } = useTranslation();
  if (projects.isError) {
    return (
      <GateNotice variant="blocked" className="col-span-full">
        <p>{t('expenseClaims:projects.loadError', "Couldn't load projects. Saving is paused so this claim isn't filed under the wrong project.")}</p>
        <Button variant="outline" size="sm" className="mt-2" onClick={projects.refetch}>{t('expenseClaims:projects.retry', 'Retry projects')}</Button>
      </GateNotice>
    );
  }
  if (projects.isPending) {
    return <p role="status" className="col-span-full text-control text-muted-foreground">{t('expenseClaims:projects.loading', 'Loading projects…')}</p>;
  }
  return null;
};
