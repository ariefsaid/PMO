import React from 'react';
import { useTranslation } from 'react-i18next';
import { usePermission } from '@/src/auth/usePermission';
import { useSetupWorkflows } from '@/src/hooks/useSetupWorkflows';
import { Card, CardHead, CardPad, Switch } from '@/src/components/ui';

/** One Admin control for the per-organisation opt-in shared by the two new setup surfaces. */
export const SetupWorkflowSetting: React.FC = () => {
  const { t } = useTranslation('financeHub');
  const may = usePermission();
  const setting = useSetupWorkflows();
  if (!may('configure', 'setupWorkflowSettings')) return null;

  return (
    <Card role="region" aria-labelledby="setup-workflows-title">
      <CardHead id="setup-workflows-title">{t('setupWorkflows.title', 'Setup workflows')}</CardHead>
      <CardPad>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p id="setup-workflows-label" className="text-control font-medium text-foreground">
              {t('setupWorkflows.label', 'Enable setup workflows')}
            </p>
            <p id="setup-workflows-help" className="mt-1 text-control text-muted-foreground">
              {t('setupWorkflows.help', 'Allow work-order imports and show the opening balances overview for this organisation.')}
            </p>
          </div>
          <Switch
            checked={setting.enabled}
            onChange={setting.setEnabled}
            labelledBy="setup-workflows-label"
            describedBy="setup-workflows-help"
            disabled={setting.isLoading || setting.isSaving}
          />
        </div>
        {setting.isError && <p role="alert" className="mt-2 text-control text-destructive">{t('setupWorkflows.error', 'Could not load or save this setting. Try again.')}</p>}
      </CardPad>
    </Card>
  );
};
