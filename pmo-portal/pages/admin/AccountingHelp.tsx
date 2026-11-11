import React from 'react';
import { useTranslation } from 'react-i18next';

/**
 * The Accounting setup page's one help popover: each section's explanation lives here, so the
 * page itself shows headings, fields and state only. Same strings the sections used to print.
 */
export const AccountingHelp: React.FC = () => {
  const { t } = useTranslation();
  const roles = t('uxs32.roleList', {
    defaultValue: '{{first}}, {{second}}, {{third}} or {{fourth}}',
    first: t('admin.roles.admin', 'Admin'),
    second: t('admin.roles.executive', 'Executive'),
    third: t('admin.roles.projectManager', 'Project Manager'),
    fourth: t('admin.roles.finance', 'Finance'),
  });
  const items: Array<[string, string]> = [
    [
      t('admin.taxDefault.title', 'Default tax treatment'),
      t('admin.taxDefault.description', 'New contracts, work orders and invoices start on this basis. Existing records keep theirs.'),
    ],
    [
      t('admin.spendApprovers.title', 'Spend approvers'),
      `${t('admin.spendApprovers.description', 'Spend within a project\'s budget goes to its approvers; all other spend goes to the overhead approvers.')} ${t('administration:admin.spendApprovers.helpRule', {
        defaultValue: 'With nobody listed, {{roles}} can approve another person\'s case.',
        roles,
      })}`,
    ],
    [
      t('uxs11.withholdingHeading', 'Receipt withholding'),
      `${t('uxs11.withholdingIntro', 'Asset account for income tax withheld by clients. Set it before recording a receipt with withholding.')} ${t('administration:admin.receiptWithholding.fallbackHint', 'Receipts without their own account post to the default.')}`,
    ],
    [
      t('uxs11.vendorTaxHeading', 'Supplier bill tax accounts'),
      t('uxs11.vendorTaxIntro', 'Accounts for input VAT (Asset) and tax withheld from supplier bills (Liability).'),
    ],
    [
      t('uxs11.downPaymentHeading', 'Down payments'),
      t('uxs11.downPaymentIntro', 'The ERPNext item that bills a customer advance and recovers it from billing claims.'),
    ],
    [
      t('procurement:gates.heading', 'Purchase rules'),
      t('procurement:gates.intro', 'All off: a purchase can start at any step.'),
    ],
    [
      t('admin.budgetMap.title', 'Budget account map'),
      `${t('admin.budgetMap.description', 'Each budget category needs one ERP account to receive its budget; other accounts count toward actuals only. An unmapped category blocks the whole push.')} ${t('uxs10.proposalsHelp', 'Suggestions use direct-cost ledger accounts; existing choices are kept.')}`,
    ],
    [
      t('admin.expenseMap.title', 'Expense account map'),
      t('admin.expenseMap.description', 'ERPNext accounts that approved claims and advances post to. A posting with an unmapped account stops and is reported.'),
    ],
  ];
  return (
    <dl className="space-y-2">
      {items.map(([name, text]) => (
        <div key={name}>
          <dt className="font-semibold">{name}</dt>
          <dd>{text}</dd>
        </div>
      ))}
    </dl>
  );
};
