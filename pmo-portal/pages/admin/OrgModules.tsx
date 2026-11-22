import React from 'react';
import { useTranslation } from 'react-i18next';
import { OrgSwitchSetting } from '@/src/components/admin/OrgSwitchSetting';
import { TransferModeSettings } from '@/src/components/stock/TransferModeSettings';
import { DoneNotClaimedReminder } from '@/src/components/finance/DoneNotClaimedReminder';
import IdleCostScopeField from './admin/IdleCostScopeField';
import { ApproverInboxSetting } from '../materialRequests/ApproverInboxSetting';
import type { OrgModuleKey } from '@/src/lib/repositories/orgSwitches';

/**
 * Administration › Modules (#2746). Five switches, each a group of features that are on for everyone by default. Off hides the module's
 * navigation entries, panels, fields and Admin lists: UI only, nothing is deleted and no database rule reads it. Each card says in plain
 * words what the module contains. The settings that add a step or send notices stay off, and sit inside their module's card.
 */
export default function OrgModules() {
  const { t } = useTranslation('administration');
  const card = (key: OrgModuleKey, id: string, label: string, helper: string, children?: React.ReactNode) => (
    <section id={id} tabIndex={-1} className="scroll-mt-4 rounded-lg border border-border p-4" aria-label={label}>
      <OrgSwitchSetting setting={key} label={label} helper={helper}>{children}</OrgSwitchSetting>
    </section>
  );
  return (
    <div className="min-w-0 space-y-4">
      <p className="max-w-prose text-control text-muted-foreground">
        {t('admin.modules.intro', 'Each module switches a group of features on or off for everyone in your organisation. Turning a module off hides its screens and settings. Nothing is deleted, and turning it back on brings everything back.')}
      </p>
      {card('modulePeopleCrews', 'module-people-crews', t('admin.modules.peopleCrews.label', 'People and crews'),
        t('admin.modules.peopleCrews.helper', 'Built-in roles, the clearance checklist for site access, leave requests and crew loans.'))}
      {card('moduleSiteDay', 'module-site-day', t('admin.modules.siteDay.label', 'Site day'),
        t('admin.modules.siteDay.helper', 'Daily safety records, and the cost and schedule performance panels on work orders.'))}
      {card('moduleStock', 'module-stock', t('admin.modules.stock.label', 'Stock'),
        t('admin.modules.stock.helper', 'Work-order transfers, stock reservations and borrowing, two-step transfers and the approvals inbox for material requests.'),
        <div className="mt-3 space-y-4 border-t border-border pt-3">
          <h3 className="text-control font-semibold">{t('admin.modules.stock.stepsHeading', 'Steps and notices (off until you choose)')}</h3>
          <TransferModeSettings />
          <ApproverInboxSetting />
        </div>)}
      {card('modulePurchasingExtras', 'module-purchasing-extras', t('admin.modules.purchasingExtras.label', 'Purchasing extras'),
        t('admin.modules.purchasingExtras.helper', 'Purchase line planning, purchase types, payment channels, printable purchase orders and delivery notes.'))}
      {card('moduleBillingExtras', 'module-billing-extras', t('admin.modules.billingExtras.label', 'Billing extras'),
        t('admin.modules.billingExtras.helper', 'Revenue per discipline, the revenue plan, idle time as cost, and the reminder for work that is done but not claimed.'),
        <div className="mt-3 space-y-4 border-t border-border pt-3">
          <h3 className="text-control font-semibold">{t('admin.modules.billingExtras.noticesHeading', 'Notices (off until you choose)')}</h3>
          <DoneNotClaimedReminder />
          <IdleCostScopeField />
        </div>)}
    </div>
  );
}
