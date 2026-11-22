import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Combobox, EntityFormModal } from '@/src/components/ui';
import { useProcurements } from '@/src/hooks/useProcurements';

/** A supplier bill is recorded against a purchase that has been ordered; a closed or unapproved one takes none. */
export const BILLABLE_STATUSES: ReadonlySet<string> = new Set(['Approved', 'Quote Selected', 'Ordered', 'Received', 'Vendor Invoiced']);

/**
 * "New vendor bill" from the payables list: pick the purchase the bill belongs to, then the purchase page opens its
 * supplier-bill form (the same form the purchase's own page uses, with its hold and exception notes). The picker only
 * narrows the choice; the database decides whether the bill can be recorded.
 */
export const NewVendorBillDialog: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const purchases = useProcurements({ lean: true, withoutRoutes: true });
  const [purchaseId, setPurchaseId] = useState<string | null>(null);
  const options = useMemo(() => (purchases.data ?? [])
    .filter((p) => BILLABLE_STATUSES.has(p.status))
    .map((p) => ({
      value: p.id,
      label: p.code ?? p.title,
      sub: [p.code ? p.title : null, p.vendor?.name].filter(Boolean).join(' · ') || undefined,
      searchTerms: [p.title, p.code ?? '', p.vendor?.name ?? ''],
    })), [purchases.data]);
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!purchaseId) return;
    navigate(`/procurement/${purchaseId}/timeline?record=invoice`, { state: { recordContext: { origin: 'finance-payables' } } });
    onClose();
  };
  return (
    <EntityFormModal open title={t('financeHub:hub.newVendorBill.title', 'New vendor bill')}
      submitLabel={t('financeHub:hub.newVendorBill.continue', 'Continue to the bill')} onSubmit={submit} onClose={onClose}
      submitDisabled={!purchaseId}>
      <Combobox id="new-vendor-bill-purchase" label={t('financeHub:hub.newVendorBill.purchase', 'Purchase')} required
        noun={t('financeHub:hub.newVendorBill.purchaseNoun', 'purchase')}
        value={purchaseId} selectedOption={options.find((o) => o.value === purchaseId) ?? null}
        loadOptions={() => Promise.resolve(options)} onChange={(v) => setPurchaseId(v || null)}
        statusOverride={purchases.isPending ? 'loading' : purchases.isError ? 'error' : undefined} onRetry={() => void purchases.refetch()}
        emptyMessage={(query) => query ? undefined : t('financeHub:hub.newVendorBill.none', 'No purchase is ready for a bill. A purchase takes a bill once it is approved or ordered.')}
        helper={t('financeHub:hub.newVendorBill.help', 'Choose the purchase this supplier bill is for. The next screen shows whether the order and receipt hold the bill.')} />
    </EntityFormModal>
  );
};
