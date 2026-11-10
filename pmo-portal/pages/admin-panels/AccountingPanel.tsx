import React from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { SectionHeader } from '@/src/components/ui';
import BudgetAccountMap from '../admin/BudgetAccountMap';
import CostAttribution from '../admin/CostAttribution';
import ExpenseAccountMap from '../admin/ExpenseAccountMap';
import OrgDownPaymentItem from '../admin/OrgDownPaymentItem';
import OrgProcurementGates from '../admin/OrgProcurementGates';
import OrgTaxDefault from '../admin/OrgTaxDefault';
import OrgVendorTaxAccounts from '../admin/OrgVendorTaxAccounts';
import OrgWithholdingAccount from '../admin/OrgWithholdingAccount';
import SpendApprovers from '../admin/SpendApprovers';
import type { AdministrationPanelProps } from './types';

const AccountingSectionNavigation: React.FC = () => {
  const { t } = useTranslation();
  const anchors = [
    { id: 'org-tax-default', label: t('uxs31.accounting.taxDefault', 'Default tax treatment') },
    { id: 'spend-approvers', label: t('uxs31.accounting.spendApprovers', 'Spend approvers') },
    { id: 'withholding-account-heading', label: t('uxs31.accounting.withholding', 'Receipt withholding') },
    { id: 'vendor-tax-accounts-heading', label: t('uxs31.accounting.vendorTax', 'Supplier bill tax accounts') },
    { id: 'down-payment-item-heading', label: t('uxs31.accounting.downPayments', 'Down payments') },
    { id: 'procurement-gates-heading', label: t('procurement:gates.heading', 'Purchase rules') },
    { id: 'budget-account-map', label: t('uxs31.accounting.budgetMap', 'Budget account map') },
    { id: 'expense-account-map', label: t('uxs31.accounting.expenseMap', 'Expense account map') },
    { id: 'cost-attribution', label: t('costAttribution:title', 'Cost attribution') },
  ];
  return (
    <nav aria-label={t('uxs31.accounting.sectionsLabel', 'Accounting setup sections')} className="mb-5">
      <ul className="flex flex-wrap gap-x-4 gap-y-1 border-b border-border pb-3 text-[13px]">
        {anchors.map(({ id, label }) => (
          <li key={id}>
            <Link className="touch-target inline-flex items-center rounded-sm px-1 text-muted-foreground underline-offset-4 hover:text-foreground hover:underline focus-visible:text-foreground" to={{ hash: `#${id}` }}>
              {label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
};

const AccountingPanel: React.FC<AdministrationPanelProps> = ({ label }) => (
  <div data-testid="administration-panel-accounting" className="min-w-0">
    <SectionHeader title={label('accounting')} />
    <AccountingSectionNavigation />
    <div className="space-y-6">
      <OrgTaxDefault />
      <SpendApprovers />
      <OrgWithholdingAccount />
      <OrgVendorTaxAccounts />
      <OrgDownPaymentItem />
      <OrgProcurementGates />
      <BudgetAccountMap />
      <ExpenseAccountMap />
      <CostAttribution />
    </div>
  </div>
);

export default AccountingPanel;
