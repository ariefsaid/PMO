import type { StockItemOption } from '@/src/lib/stockItemMatch';
import React from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Card, CardHead, CardPad, useToast } from '@/src/components/ui';
import type { useDomainOwnershipMode } from '@/src/hooks/useDomainOwnershipMode';
import type { useProcurementItemEligibility } from '@/src/hooks/useProcurementItemEligibility';
import type { useErpItemOptions } from '@/src/hooks/useErpItemOptions';
import type { useProcurementCrudMutations } from '@/src/hooks/useProcurementCrud';
import type { useProcurementMutations } from '@/src/hooks/useProcurementDetail';
import { useMaySeePrices } from '@/src/hooks/useHidePrices';
import type { ProcurementDetail } from '@/src/lib/db/procurementLifecycle';
import type { selectedQuotation } from '../../components/procurement';
import type { DetailRow } from './ProcurementOverviewTab';
import { LineItemsSection } from './LineItemsSection';
import { SubcontractLinesSection } from './SubcontractLinesSection';
import { VendorQuotesTab } from './VendorQuotesTab';

/** The tab panels the record page hands whole to this module: they read the loaded case and the page's
 *  permission facts, and report back through the page's own mutation-error handler. */

export interface ItemsTabProps {
  readOnly?: boolean;
  p: ProcurementDetail;
  stockItems?: StockItemOption[];
  ownership: ReturnType<typeof useDomainOwnershipMode>;
  ownershipReady: boolean;
  casePushInFlight: boolean;
  canEditItems: boolean;
  canEditItemValues: boolean;
  itemEligibility: ReturnType<typeof useProcurementItemEligibility>;
  erpItems: ReturnType<typeof useErpItemOptions>;
  crud: ReturnType<typeof useProcurementCrudMutations>;
  onMutationError: (err: unknown) => void;
  currentUserId: string | null;
  managerId: string | null | undefined;
}

export const ProcurementItemsTab: React.FC<ItemsTabProps> = ({ readOnly = false, p, stockItems, ownership, ownershipReady, casePushInFlight, canEditItems, canEditItemValues, itemEligibility, erpItems, crud, onMutationError, currentUserId, managerId }) => {
  const { t } = useTranslation();
  const { toast } = useToast();
  return (
    <div className="flex flex-col gap-3 [&>[data-testid=line-items-section]]:mb-0">
    {!ownershipReady && <p className="text-sm text-muted-foreground">{ownership.mode === 'error' ? t('procurementRecord:items.ownershipError', 'Ownership could not be loaded. Try again.') : t('procurementRecord:items.ownershipChecking', 'Checking ownership…')}{ownership.mode === 'error' && <Button variant="ghost" size="sm" onClick={ownership.retry}>{t('procurementRecord:items.retry', 'Retry')}</Button>}</p>}
    {ownership.mode === 'external' && canEditItems && !canEditItemValues && <p className="text-sm text-muted-foreground">{casePushInFlight ? t('procurementRecord:items.submitting', 'A case document is being submitted.') : itemEligibility.isError ? t('procurementRecord:items.eligibilityError', 'Line editing availability could not be loaded. Try again.') : (itemEligibility.isPending || itemEligibility.isFetching) ? t('procurementRecord:items.eligibilityChecking', 'Checking line editing availability…') : t('procurementRecord:items.valuesManaged', 'Quantity and unit price are managed by ERP for this purchase.')} {!casePushInFlight && itemEligibility.isError && <Button variant="ghost" size="sm" onClick={() => void itemEligibility.refetch()}>{t('procurementRecord:items.retry', 'Retry')}</Button>}</p>}
    <LineItemsSection
      erpItems={erpItems.connected ? erpItems : undefined}
      stockItems={erpItems.connected ? undefined : stockItems}
      items={p.items}
      editable={canEditItems}
      valuesEditable={canEditItemValues}
      busy={crud.createItem.isPending || crud.updateItem.isPending || crud.deleteItem.isPending}
      onError={onMutationError}
      onAdd={async (input) => {
        await crud.createItem.mutateAsync(input);
        toast(t('procurementDetail.toast.lineItemAdded', 'Line item added'), input.name, 'success');
      }}
      onUpdate={async (id, patch) => {
        await crud.updateItem.mutateAsync({ id, patch });
        toast(t('procurementDetail.toast.lineItemUpdated', 'Line item updated'), patch.name, 'success');
      }}
      onDelete={async (id) => {
        await crud.deleteItem.mutateAsync(id);
        toast(t('procurementDetail.toast.lineItemRemoved', 'Line item removed'), undefined, 'success');
      }}
      currency={p.currency}
    />
    {p.is_subcontract && p.project_id && p.purchase_orders[0] && (
      <SubcontractLinesSection
        readOnly={readOnly}
        poId={p.purchase_orders[0].id}
        procurementId={p.id}
        projectId={p.project_id}
        currency={p.currency}
        currentUserId={currentUserId ?? undefined}
        projectManagerId={managerId}
      />
    )}
    </div>
  );
};

export interface QuotesTabProps {
  p: ProcurementDetail;
  selectedQuote: ReturnType<typeof selectedQuotation>;
  vendorMap: Record<string, string>;
  mutations: ReturnType<typeof useProcurementMutations>;
  crud: ReturnType<typeof useProcurementCrudMutations>;
  canAddQuote: boolean;
  canSelectQuote: boolean;
  canManageFiles: boolean;
  currentUserId: string | null;
  onMutationError: (err: unknown) => void;
}

export const ProcurementQuotesTab: React.FC<QuotesTabProps> = ({ p, selectedQuote, vendorMap, mutations, crud, canAddQuote, canSelectQuote, canManageFiles, currentUserId, onMutationError }) => {
  const { t } = useTranslation();
  const { toast } = useToast();
  const maySeePrices = useMaySeePrices(); // #2699: a requester sees the quotation, not its price
  return (
    <VendorQuotesTab
      quotations={p.quotations}
      selectedId={selectedQuote?.id ?? null}
      canAdd={canAddQuote}
      canSelect={canSelectQuote}
      addBusy={mutations.createQuotation.isPending}
      selectBusy={crud.selectQuote.isPending}
      procurementId={p.id}
      currency={p.currency}
      canManageFiles={canManageFiles}
      currentUserId={currentUserId}
      vendorMap={maySeePrices ? { ...vendorMap, ...(p.vendor_id && p.vendor?.name && !vendorMap[p.vendor_id] ? { [p.vendor_id]: p.vendor.name } : {}) } : {}}
      onError={onMutationError}
      onAdd={async (input) => {
        await mutations.createQuotation.mutateAsync(input);
        toast(t('procurementDetail.toast.quotationAdded', 'Quotation added'), undefined, 'success');
      }}
      onSelect={async (quotationId) => {
        // The server returns the request for approval when the quote exceeds the approved
        // amount (0349); say which outcome happened rather than always "advanced".
        const quote = p.quotations.find((q) => q.id === quotationId);
        const rerouted = p.approved_total_value != null && quote != null
          && Number(quote.total_amount) > Number(p.approved_total_value);
        await crud.selectQuote.mutateAsync(quotationId);
        toast(
          t('procurementDetail.toast.quoteSelected', 'Quote selected'),
          rerouted
            ? t(
                'procurement:quoteSelection.reroutedDetail',
                'The quote is above the approved amount, so the procurement went back for approval.',
              )
            : t(
                'procurementDetail.toast.quoteSelectedDetail',
                'The procurement advanced to Quote Selected',
              ),
          'success',
        );
      }}
    />
  );
};

export const ProcurementDetailsTab: React.FC<{ rows: DetailRow[]; canEditHeader: boolean; onEdit: () => void; extra?: React.ReactNode }> = ({ rows: detailRows, canEditHeader, onEdit, extra }) => {
  const { t } = useTranslation();
  return (
    <Card data-testid="procurement-detail-dl"><CardHead>{t('procurementRecord:tabs.details', 'Details')}</CardHead><CardPad>
      <dl className="grid grid-cols-1 gap-x-8 gap-y-4 sm:grid-cols-2">
        {detailRows.map((row) => <div key={row.label}><dt className="text-sm font-semibold text-muted-foreground">{row.label}</dt><dd className="mt-0.5 text-sm">{row.value}</dd></div>)}
        {extra}
      </dl>
      {canEditHeader && <Button className="mt-4" variant="outline" onClick={onEdit}>{t('procurementRecord:editDetails', 'Edit details')}</Button>}
    </CardPad></Card>
  );
};
