import React, { useContext, useState } from 'react';
import { QueryClientContext } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Checkbox, ListState, RecordSection, useToast } from '@/src/components/ui';
import { FormErrorStrip } from '@/src/components/ui/FormFields';
import { useApproverInboxSetting, useSetApproverInbox } from '@/src/hooks/useApproverInbox';
import { useRefusalText } from './useMaterialRequestText';

const Editor: React.FC = () => {
  const { t } = useTranslation('materialRequests');
  const { toast } = useToast();
  const refusal = useRefusalText();
  const setting = useApproverInboxSetting();
  const save = useSetApproverInbox();
  const [error, setError] = useState<string | null>(null);
  const change = async (on: boolean) => {
    setError(null);
    try { await save.mutateAsync(on); toast(t('settings.approverInboxSaved', 'Approvals inbox setting saved'), undefined, 'success'); }
    catch (err) { setError(refusal(err)); }
  };
  return (
    <RecordSection title={t('settings.approverInbox', 'Approvals inbox and notifications')}
      subline={t('settings.approverInboxSub', 'When on, each approver is also notified in the app when a request step becomes theirs. The step is always listed on the Approvals page, whatever this says. Off by default.')}>
      {setting.isError && <ListState variant="error" title={t('settings.approverInboxError', "Couldn't load this setting")} onRetry={() => void setting.refetch()} />}
      {error && <FormErrorStrip>{error}</FormErrorStrip>}
      {!setting.isError && (
        <Checkbox checked={setting.data === true} disabled={setting.isPending || save.isPending} onChange={(v) => void change(v)}
          label={t('settings.approverInboxLabel', 'Show material request approvals in the approvals inbox and notify approvers')}>
          {t('settings.approverInboxLabel', 'Show material request approvals in the approvals inbox and notify approvers')}
        </Checkbox>
      )}
    </RecordSection>
  );
};

/** Admin-only toggle (#2685 FR-MRI-013). Renders nothing outside a query client, so a bare render of the settings page is unaffected. */
export const ApproverInboxSetting: React.FC = () => {
  const client = useContext(QueryClientContext);
  return client ? <Editor /> : null;
};
