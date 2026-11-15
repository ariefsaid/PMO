import React from 'react';
import OrgTaxDefault from '../admin/OrgTaxDefault';
import SpendApprovers from '../admin/SpendApprovers';
import OrgWithholdingAccount from '../admin/OrgWithholdingAccount';
import OrgVendorTaxAccounts from '../admin/OrgVendorTaxAccounts';
import OrgDownPaymentItem from '../admin/OrgDownPaymentItem';
import OrgProcurementGates from '../admin/OrgProcurementGates';
import BudgetAccountMap from '../admin/BudgetAccountMap';
import ExpenseAccountMap from '../admin/ExpenseAccountMap';
import { SectionName } from './SectionName';
import type { AdministrationPanelProps } from './types';

const AccountingPanel: React.FC<AdministrationPanelProps> = ({ label }) => (
  <div data-testid="administration-panel-accounting" className="min-w-0">
    <SectionName name={label('accounting')} />
    <div className="space-y-6 [&>section+section]:border-t [&>section+section]:border-border [&>section+section]:pt-6">
      <OrgTaxDefault />
      <SpendApprovers />
      <OrgWithholdingAccount />
      <OrgVendorTaxAccounts />
      <OrgDownPaymentItem />
      <OrgProcurementGates />
      <BudgetAccountMap />
      <ExpenseAccountMap />
    </div>
  </div>
);

export default AccountingPanel;
