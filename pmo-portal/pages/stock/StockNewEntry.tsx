import React from 'react';
import { useParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Button, ListState } from '@/src/components/ui';
import { useOrderReceivingEnabled } from '@/src/hooks/useOrderReceiving';
import StockNewDocument from './StockMovementForm';
import OrderReceiving, { OrderReceivingSetting } from './OrderReceiving';

function ReceivingEntry() {
  const flag = useOrderReceivingEnabled();
  const { t } = useTranslation('stock');
  if (flag.isPending) return <ListState variant="loading" rows={4} />;
  if (flag.isError) return <div role="alert"><p>{t('receiving.loadError')}</p><Button onClick={() => void flag.refetch()}>{t('receiving.retry')}</Button></div>;
  return flag.data ? <OrderReceiving /> : <><StockNewDocument /><OrderReceivingSetting /></>;
}
export default function StockNewEntry() {
  return useParams<{ kind: string }>().kind === 'receive' ? <ReceivingEntry /> : <StockNewDocument />;
}
