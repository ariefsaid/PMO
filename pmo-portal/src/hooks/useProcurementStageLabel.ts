import { useTranslation } from 'react-i18next';

/**
 * Display title of a procurement lifecycle stage (board column). The stage `key`
 * ('pr' | 'vq' | …) is DATA and never changes; only what the user reads is translated. English
 * defaults equal `PrStage.full`, so the English UI is unchanged.
 */
export function useProcurementStageLabel(): (stage: { key: string; full: string }) => string {
  const { t } = useTranslation();
  const labels: Record<string, string> = {
    pr: t('procurement.stage.pr', 'Purchase Request'),
    vq: t('procurement.stage.vq', 'Vendor Quote'),
    po: t('procurement.stage.po', 'Purchase Order'),
    gr: t('procurement.stage.gr', 'Goods Receipt'),
    vi: t('procurement.stage.vi', 'Vendor Invoice'),
    paid: t('procurement.stage.paid', 'Payment'),
  };
  return (stage) => labels[stage.key] ?? stage.full;
}
