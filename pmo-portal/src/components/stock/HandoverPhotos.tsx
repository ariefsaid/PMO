import React from 'react';
import { useTranslation } from 'react-i18next';
import { useHandoverPhotoUrl } from '@/src/hooks/useStockTransfers';
import type { HandoverConfirmation } from '@/src/lib/repositories/stockTransfers';

const Photo: React.FC<{ path: string | null; label: string }> = ({ path, label }) => {
  const url = useHandoverPhotoUrl(path).data;
  if (!path || !url) return null;
  return (
    <a href={url} target="_blank" rel="noreferrer" className="inline-block">
      <img src={url} alt={label} className="h-16 w-16 rounded-md border border-border object-cover" />
    </a>
  );
};

/** The photos taken at one handover confirmation: the goods, the person receiving, the signed paper. */
export const HandoverPhotos: React.FC<{ confirmation: Pick<HandoverConfirmation, 'goodsPhotoPath' | 'signerPhotoPath' | 'paperPhotoPath'> }> = ({ confirmation: c }) => {
  const { t } = useTranslation('stock');
  if (!c.goodsPhotoPath && !c.signerPhotoPath && !c.paperPhotoPath) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-2" data-testid="handover-photos">
      <Photo path={c.goodsPhotoPath} label={t('handover.goodsPhoto')} />
      <Photo path={c.signerPhotoPath} label={t('handover.personPhoto')} />
      <Photo path={c.paperPhotoPath} label={t('handover.paperPhoto')} />
    </div>
  );
};
