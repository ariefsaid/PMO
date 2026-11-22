import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Card, CardHead, CardPad, FieldError, SelectField } from '@/src/components/ui';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import {
  usePaymentChannelList, usePaymentChannelMutations, usePaymentChannelsOn, useRequestPaymentChannel,
} from '@/src/hooks/usePaymentChannels';

interface Props {
  procurementId: string;
  /** UX gate only: the database decides who may set it, by the request's status (1356). */
  canSet: boolean;
}

const ChannelForm: React.FC<{ procurementId: string; currentId: string }> = ({ procurementId, currentId }) => {
  const { t } = useTranslation();
  const list = usePaymentChannelList(true);
  const { setOnRequest } = usePaymentChannelMutations();
  const [value, setValue] = useState(currentId);
  const options = [{ value: '', label: t('procurement:paymentChannel.notSet', 'Not set') }, ...(list.data ?? [])
    .filter((c) => !c.archived || c.id === currentId)
    .map((c) => ({ value: c.id, label: c.archived ? `${c.name} (${t('procurement:paymentChannel.archivedTag', 'Archived')})` : c.name }))];
  const error = setOnRequest.isError ? classifyMutationError(setOnRequest.error) : null;
  if (list.isPending) return null;
  if (options.length === 1) {
    return <p className="text-control text-muted-foreground" data-testid="payment-channel-none">{t('procurement:paymentChannel.noneYet', 'No payment channels yet. An Admin adds them under Payment channels in Accounting setup.')}</p>;
  }
  return (
    <form
      className="flex max-w-md flex-col gap-3"
      onSubmit={(e) => { e.preventDefault(); setOnRequest.mutate({ procurementId, channelId: value || null }); }}
    >
      <SelectField
        label={t('procurement:paymentChannel.field', 'Payment channel')}
        hideLabel
        value={value}
        onChange={setValue}
        options={options}
        fullWidth
      />
      <div>
        <Button type="submit" variant="outline" loading={setOnRequest.isPending} disabled={value === currentId}>
          {t('procurement:paymentChannel.saveChannel', 'Save channel')}
        </Button>
      </div>
      {error && <FieldError>{error.detail || error.headline}</FieldError>}
    </form>
  );
};

/**
 * #2698 — how this request will be paid, beside its payment status. Renders nothing while the organisation's switch is
 * off (and without a data provider, which the hooks tolerate), so an existing organisation sees no change.
 */
export const PaymentChannelSection: React.FC<Props> = ({ procurementId, canSet }) => {
  const { t } = useTranslation();
  const { on } = usePaymentChannelsOn();
  const current = useRequestPaymentChannel(procurementId, on);
  if (!on || !current.data) return null;
  const currentId = current.data.channelId ?? '';
  return (
    <Card data-testid="payment-channel-section" className="mt-3">
      <CardHead>{t('procurement:paymentChannel.field', 'Payment channel')}</CardHead>
      <CardPad>
        {canSet
          ? <ChannelForm key={currentId} procurementId={procurementId} currentId={currentId} />
          : <p className="text-sm" data-testid="payment-channel-value">{current.data.name ?? t('procurement:paymentChannel.notSet', 'Not set')}</p>}
      </CardPad>
    </Card>
  );
};
