/**
 * #876 slice 2 (OD-VWH-1, DD-VWH-11) — the vendor's default tax treatment on the company page: VAT rate, withholding
 * type and PPh rate. It PRE-FILLS new bills from this vendor; each bill's amounts stay editable and are what is
 * recorded (DD-VWH-19). Saved only through `set_vendor_tax_defaults` (Admin/Finance, audited);
 * `can('manage', 'vendorTaxDefault')` mirrors that gate and is UX only.
 */
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation } from '@tanstack/react-query';
import { Button, Card, CardHead, CardPad, FieldError, SelectField, TextField, useToast } from '@/src/components/ui';
import { usePermission } from '@/src/auth/usePermission';
import { repositories } from '@/src/lib/repositories';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import { formatMoneyInputValue } from '@/src/lib/format';
import { queryClient } from '@/src/lib/queryClient';
import { parseVendorTaxDefaultsDraft, vendorTaxDefaultOf, type VendorTaxDefaultsInput } from '@/src/lib/vendorWithholding';
import type { CompanyRow } from '@/src/lib/db/companies';

const rateDraft = (rate: number | null | undefined): string => (rate == null ? '' : formatMoneyInputValue(rate));

export const VendorTaxDefaultsCard: React.FC<{ company: CompanyRow }> = ({ company }) => {
  const { t } = useTranslation();
  const may = usePermission();
  const canManage = may('manage', 'vendorTaxDefault');
  const { toast } = useToast();
  const [vatRaw, setVatRaw] = useState(rateDraft(company.default_vat_rate));
  const [pphType, setPphType] = useState(company.default_pph_type ?? '');
  const [pphRaw, setPphRaw] = useState(rateDraft(company.default_pph_rate));
  // The PPh-rate error waits for the rate field (an untouched, empty rate is an offer, not a mistake);
  // the disabled Save is the gate until then.
  const [pphTouched, setPphTouched] = useState(false);
  const [error, setError] = useState<string>();
  const draft = parseVendorTaxDefaultsDraft(vatRaw, pphType, pphRaw);
  // The app's singleton client (App.tsx provides the same one), as `useVendorTaxDefault` reads it: saving here
  // refreshes an open bill form's pre-fill, and the card renders wherever CompanyDetail does.
  const mutation = useMutation({
    mutationFn: (input: VendorTaxDefaultsInput) => repositories.company.setTaxDefaults(company.id, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['company'] });
      toast(t('companyDetail.vendorTax.saved', 'Vendor tax defaults saved'), undefined, 'success');
    },
    onError: (err) => {
      const classified = classifyMutationError(err);
      setError(classified.detail || classified.headline);
    },
  }, queryClient);

  const saved = vendorTaxDefaultOf(company);
  const parts = [
    saved?.vatRate != null
      ? t('companyDetail.vendorTax.summaryVat', 'VAT {{rate}}%', { rate: formatMoneyInputValue(saved.vatRate) }) : null,
    saved?.pphType && saved.pphRate != null
      ? t('companyDetail.vendorTax.summaryPph', '{{type}} at {{rate}}%', {
        type: saved.pphType === 'pph23' ? t('companyDetail.vendorTax.pph23', 'PPh 23') : t('companyDetail.vendorTax.pph4_2', 'PPh 4(2)'),
        rate: formatMoneyInputValue(saved.pphRate),
      }) : null,
  ].filter(Boolean);
  const summary = parts.length > 0 ? parts.join(' · ') : t('companyDetail.vendorTax.notSet', 'Not set');

  return (
    <div data-testid="vendor-tax-defaults">
      <Card variant="bare" className="mb-4">
        <CardHead>{t('companyDetail.vendorTax.title', 'Vendor tax defaults')}</CardHead>
        <CardPad>
          <p className="mb-3 text-[13px] text-muted-foreground">
            {t('companyDetail.vendorTax.hint', 'Pre-fills new bills from this vendor. The amounts stay editable on each bill.')}
          </p>
          {canManage ? (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                setError(undefined);
                if (draft.ok) mutation.mutate(draft.value);
              }}
              className="grid max-w-xl grid-cols-1 gap-3 sm:grid-cols-3"
            >
              <TextField
                label={t('companyDetail.vendorTax.vatRate', 'VAT rate (%)')}
                value={vatRaw}
                onChange={setVatRaw}
                inputMode="decimal"
                disabled={mutation.isPending}
                error={!draft.ok && draft.field === 'vat'
                  ? t('companyDetail.vendorTax.vatRateError', 'Enter a rate from 0 to 100 with no more than 3 decimal places, or leave it blank.')
                  : undefined}
              />
              <SelectField
                label={t('companyDetail.vendorTax.withholding', 'Withholding')}
                value={pphType}
                onChange={setPphType}
                disabled={mutation.isPending}
                options={[
                  { value: '', label: t('companyDetail.vendorTax.none', 'None') },
                  { value: 'pph23', label: t('companyDetail.vendorTax.pph23', 'PPh 23') },
                  { value: 'pph4_2', label: t('companyDetail.vendorTax.pph4_2', 'PPh 4(2)') },
                ]}
              />
              {pphType !== '' && (
                <TextField
                  label={t('companyDetail.vendorTax.pphRate', 'PPh rate (%)')}
                  required
                  helper={t('companyDetail.vendorTax.pphRateHelper', 'Required when withholding is selected. Enter a rate above 0 and below 100%.')}
                  value={pphRaw}
                  onChange={(next) => { setPphTouched(true); setPphRaw(next); }}
                  inputMode="decimal"
                  disabled={mutation.isPending}
                  error={pphTouched && !draft.ok && draft.field === 'pph'
                    ? t('companyDetail.vendorTax.pphRateError', 'Enter a rate above 0 and below 100 with no more than 3 decimal places.')
                    : undefined}
                />
              )}
              <div className="flex flex-col items-start gap-2 sm:col-span-3">
                <FieldError>{error}</FieldError>
                <Button type="submit" variant="outline" disabled={mutation.isPending || !draft.ok}>
                  {t('companyDetail.vendorTax.save', 'Save defaults')}
                </Button>
              </div>
            </form>
          ) : (
            <p className="text-[13px]" data-testid="vendor-tax-defaults-summary">
              {summary}
              <span className="ml-2 text-muted-foreground">
                {t('companyDetail.vendorTax.onlyRoles', 'Only Admin or Finance can change these.')}
              </span>
            </p>
          )}
        </CardPad>
      </Card>
    </div>
  );
};
