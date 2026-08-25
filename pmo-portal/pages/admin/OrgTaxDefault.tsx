import React from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { ListState, SelectField, useToast } from '@/src/components/ui';
import { usePermission } from '@/src/auth/usePermission';
import { useAuth } from '@/src/auth/useAuth';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import { repositories } from '@/src/lib/repositories';
import { useOrgTaxDefault, ORG_TAX_DEFAULT_KEY } from '@/src/hooks/useOrgTaxDefault';
import { TAX_TREATMENT_OPTIONS } from '@/src/lib/taxTreatment';
import type { TaxTreatment } from '@/src/lib/db/procurementLifecycle';

/**
 * Administration › Tax treatment default (`OD-TAX-1` / #548, migration 0207).
 *
 * The owner declined to pick one basis for the product: commercial contracts and vendor agreements
 * are normally quoted EXCLUSIVE of PPN, government/SOE tender contracts INCLUSIVE, and a contractor
 * working both sides needs both. This setting says which one an org meets most days, so the common
 * case is pre-filled and the uncommon one is a deliberate, visible choice on the form.
 *
 * ⛔ WHAT THIS SETTING DOES NOT DO, and the sentence the panel puts in front of the Admin before
 * they change it: it does not restate a single existing figure. Every stored row keeps the
 * treatment recorded ON it. That is not a limitation — a setting that re-interpreted history would
 * silently change what past contracts and invoices MEANT each time it was flipped, and no later
 * inference recovers the original (#478).
 *
 * ⚑ Admin-only, gated on `can('manage', 'orgAccounting')` against the REAL JWT role. The identical
 * predicate is enforced server-side by 0207's `organizations_update_tax_default` policy plus a
 * column-scoped UPDATE grant — this gate is UX, RLS is the authority (ADR-0016).
 */
const OrgTaxDefault: React.FC = () => {
  const { t } = useTranslation();
  const may = usePermission();
  const canManage = may('manage', 'orgAccounting');
  const { currentUser } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const current = useOrgTaxDefault();

  const mutation = useMutation({
    mutationFn: (value: TaxTreatment) => repositories.orgSettings.setTaxDefault(value),
    onSuccess: () => qc.invalidateQueries({ queryKey: [ORG_TAX_DEFAULT_KEY, currentUser?.org_id] }),
  });

  const onChange = async (raw: string) => {
    if (raw !== 'inclusive' && raw !== 'exclusive') return;
    try {
      await mutation.mutateAsync(raw);
      toast(
        t('admin.taxDefault.toast.saved', 'Default tax treatment updated'),
        t(
          'admin.taxDefault.toast.savedDetail',
          'New contracts, work orders and invoices will start on this basis. Existing records are unchanged.',
        ),
        'success',
      );
    } catch (err) {
      const { headline, detail } = classifyMutationError(err);
      toast(headline, detail, 'warning');
    }
  };

  return (
    <section id="org-tax-default" aria-label={t('admin.taxDefault.title', 'Default tax treatment')}>
      <h2 className="text-[15px] font-semibold tracking-[-0.01em]">
        {t('admin.taxDefault.title', 'Default tax treatment')}
      </h2>
      <p className="mt-1 text-[13px] text-muted-foreground">
        {t(
          'admin.taxDefault.description',
          'The basis a new contract value, work order or invoice starts on. Anyone recording one can change it on the form.',
        )}
      </p>
      <p className="mt-1 text-[13px] text-muted-foreground">
        {t(
          'admin.taxDefault.doesNotRestate',
          'Changing this does not restate any existing figure. Every record keeps the tax treatment it was recorded with.',
        )}
      </p>
      <div className="mt-3 max-w-md">
        {current === undefined ? (
          <ListState variant="loading" rows={1} testId="org-tax-default-loading" />
        ) : canManage ? (
          <SelectField
            id="org-tax-default-select"
            label={t('admin.taxDefault.label', 'Default tax treatment')}
            value={current}
            onChange={(value) => void onChange(value)}
            options={TAX_TREATMENT_OPTIONS}
            disabled={mutation.isPending}
            data-testid="org-tax-default-select"
          />
        ) : (
          // read-only-distinction: a role that cannot change this sees the VALUE, never a dead
          // control. It is org configuration every member's forms already read.
          <p data-testid="org-tax-default-readonly" className="text-[13px]">
            <span className="font-semibold">
              {current === 'inclusive'
                ? t('admin.taxDefault.value.inclusive', 'Inclusive — the amount already includes tax')
                : t('admin.taxDefault.value.exclusive', 'Exclusive — tax is on top of the amount')}
            </span>
            <span className="ml-2 text-muted-foreground">
              {t('admin.taxDefault.adminOnly', 'Only an Admin can change this.')}
            </span>
          </p>
        )}
      </div>
    </section>
  );
};

export default OrgTaxDefault;
