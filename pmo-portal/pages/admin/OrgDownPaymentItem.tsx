import React, { useCallback, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/src/auth/useAuth';
import { usePermission } from '@/src/auth/usePermission';
import { useErpnextBinding } from '@/src/hooks/useErpnextBinding';
import { useErpItemOptions } from '@/src/hooks/useErpItemOptions';
import { useRemoteStringDraft } from '@/src/hooks/useRemoteStringDraft';
import { repositories } from '@/src/lib/repositories';
import { SESSION_QUERY_OPTIONS } from '@/src/lib/queryPolicies';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import { Button, Combobox, FieldError, ListState, useToast } from '@/src/components/ui';
import type { ComboboxOption } from '@/src/components/ui';
import { useTranslation } from 'react-i18next';

const ITEM_QUERY_KEY = 'org-down-payment-item';

/** #766 / ADR-0077 — the item remains an existing ERP choice; its posting account is not visible here. */
export default function OrgDownPaymentItem() {
  const { t } = useTranslation();
  const { currentUser } = useAuth();
  const may = usePermission();
  const canManage = may('manage', 'orgAccounting');
  const binding = useErpnextBinding();
  const { loadOptions: loadErpItems } = useErpItemOptions('sales');
  const qc = useQueryClient();
  const { toast } = useToast();
  const [error, setError] = useState<string>();
  const [loadedItems, setLoadedItems] = useState<ComboboxOption[] | null>(null);
  const [itemLoadError, setItemLoadError] = useState(false);
  const orgId = currentUser?.org_id;
  const queryKey = [ITEM_QUERY_KEY, orgId];
  const query = useQuery({ queryKey, queryFn: () => repositories.orgSettings.getDownPaymentItem(), enabled: !!currentUser, ...SESSION_QUERY_OPTIONS });
  const hasActiveBinding = binding.data?.status === 'active' && !binding.isError;
  const canBrowse = Boolean(canManage && orgId && hasActiveBinding);
  const { draft, setDraft, dirty, remoteChanged, acceptSaved, reload } = useRemoteStringDraft({ remote: query.data, isSuccess: query.isSuccess });

  const loadOptions = useCallback(async () => {
    setItemLoadError(false);
    try {
      const options = await loadErpItems();
      setLoadedItems(options);
      return options;
    } catch (loadError) {
      setItemLoadError(true);
      throw loadError;
    }
  }, [loadErpItems]);

  const mutation = useMutation({
    mutationFn: (value: string | null) => repositories.orgSettings.setDownPaymentItem(value),
    onSuccess: (_result, value) => {
      acceptSaved(value);
      void qc.invalidateQueries({ queryKey });
      toast(t('uxs11.downPaymentSaved', 'Down payment item saved'), undefined, 'success');
    },
    onError: (err) => {
      const classified = classifyMutationError(err);
      setError(classified.detail || classified.headline);
    },
  });

  const selected = !draft
    ? null
    : {
        value: draft,
        label: draft,
        sub: loadedItems && !loadedItems.some((item) => item.value === draft)
          ? t('uxs11.downPaymentItemUnavailable', 'Saved item is not in the current item list; it remains saved until replaced.')
          : loadedItems?.find((item) => item.value === draft)?.sub,
      };
  const canSaveDraft = !draft || !dirty || Boolean(loadedItems?.some((item) => item.value === draft));
  const savedValue = query.data ?? t('uxs11.notConfigured', 'Not configured');

  return (
    <section aria-labelledby="down-payment-item-heading">
      <h2 id="down-payment-item-heading" tabIndex={-1} className="scroll-mt-4 text-group font-semibold">
        {t('uxs11.downPaymentHeading', 'Down payments')}
      </h2>
      <div className="mt-3 max-w-md">
        {query.isError ? <ListState variant="error" title={t('uxs11.downPaymentLoadError', "Couldn't load the down payment item")} onRetry={() => void query.refetch()} />
          : query.isPending ? <ListState variant="loading" rows={1} />
          : canManage ? <form onSubmit={(event) => { event.preventDefault(); setError(undefined); mutation.mutate(draft || null); }} className="space-y-3">
            {remoteChanged && (
              <div role="status" className="rounded-md bg-secondary px-3 py-2 text-control text-secondary-foreground">
                <p>{t('uxs11.downPaymentRemoteChanged', 'The saved item changed. Your edit is kept; reload the saved value to discard it.')}</p>
                <Button type="button" variant="outline" size="sm" className="mt-2" onClick={() => {
                  reload();
                  setError(undefined);
                }}>{t('uxs11.reloadSaved', 'Reload saved values')}</Button>
              </div>
            )}
            <Combobox
              label={t('uxs11.downPaymentItemLabel', 'Down payment item')}
              value={draft || null}
              selectedOption={selected}
              onChange={(value) => { setDraft(value); setError(undefined); }}
              onClear={() => { setDraft(''); setError(undefined); }}
              clearable={Boolean(draft && !mutation.isPending)}
              loadOptions={loadOptions}
              noun={t('uxs11.itemNoun', 'item')}
              placeholder={t('uxs11.downPaymentItemPlaceholder', 'Choose an ERPNext item')}
              searchPlaceholder={t('uxs11.itemSearch', 'Search ERPNext items')}
              disabled={mutation.isPending || !canBrowse}
              clearWhileDisabled
            />
            <p className="text-control text-muted-foreground">{t('uxs11.downPaymentUnverified', 'Its account must post customer advances to a liability.')}</p>
            {binding.isPending && <p role="status" className="text-control text-muted-foreground">{t('uxs11.checkingBinding', 'Checking ERPNext setup…')}</p>}
            {binding.isError && <div role="status" className="space-y-2 text-control text-muted-foreground"><p>{t('uxs11.bindingLoadError', "Couldn't check ERPNext setup. Retry before deciding whether a connection is needed.")}</p><Button type="button" variant="outline" size="sm" onClick={() => void binding.refetch()}>{t('uxs11.retryBinding', 'Check setup again')}</Button></div>}
            {!binding.isPending && !binding.isError && !hasActiveBinding && <p role="status" className="text-control text-muted-foreground">{t('uxs11.bindingRequired', 'An active ERPNext connection is needed to load these choices.')}</p>}
            {itemLoadError && <p role="status" className="text-control text-destructive">{t('uxs11.downPaymentItemsError', 'Couldn\'t load ERPNext items. Retry.')}</p>}
            {loadedItems?.length === 0 && <p role="status" className="text-control text-muted-foreground">{t('uxs11.downPaymentNoItems', 'No ERPNext sales items were returned.')}</p>}
            {loadedItems && draft && !loadedItems.some((item) => item.value === draft) && <p role="status" className="text-control text-muted-foreground">{t('uxs11.downPaymentItemUnavailable', 'Saved item is not in the current item list; it remains saved until replaced.')}</p>}
            {error && <FieldError>{error}</FieldError>}
            <Button type="submit" variant="outline" disabled={mutation.isPending || !dirty || !canSaveDraft}>{t('uxs11.saveDownPaymentItem', 'Save item')}</Button>
          </form> : <p className="text-control">{savedValue}<span className="ml-2 text-muted-foreground">{t('uxs11.onlyAdmin', 'Only an Admin can change this.')}</span></p>}
      </div>
    </section>
  );
}
