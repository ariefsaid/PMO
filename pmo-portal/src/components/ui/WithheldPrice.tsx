import { useTranslation } from 'react-i18next';

export function WithheldPrice() {
  const { t } = useTranslation('priceVisibility');
  return (
    <span className="block text-sm font-normal text-muted-foreground">
      {t('withheld', 'Prices are hidden from requesters.')}
    </span>
  );
}
