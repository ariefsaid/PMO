import React, { useState } from 'react';
import OrgTaxDefault from './OrgTaxDefault';
import OrgWithholdingAccount from './OrgWithholdingAccount';
import OrgVendorTaxAccounts from './OrgVendorTaxAccounts';
import OrgDownPaymentItem from './OrgDownPaymentItem';

type TaxSetting = 'default' | 'withholding' | 'vendor' | 'down-payment';

/** Saved values stay visible together; opening an editor closes the previous setting editor. */
const TaxAdvancesTask: React.FC = () => {
  const [activeEditor, setActiveEditor] = useState<TaxSetting | null>(null);
  const settingProps = (setting: TaxSetting) => ({
    editing: activeEditor === setting,
    onEdit: () => setActiveEditor(setting),
    onClose: () => setActiveEditor(null),
  });

  return (
    <div data-testid="tax-advances-task" className="min-w-0 space-y-4">
      <div className="min-w-0 border-b border-border pb-4">
        <OrgTaxDefault {...settingProps('default')} />
      </div>
      <div className="min-w-0 border-b border-border pb-4">
        <OrgWithholdingAccount {...settingProps('withholding')} />
      </div>
      <div className="min-w-0 border-b border-border pb-4">
        <OrgVendorTaxAccounts {...settingProps('vendor')} />
      </div>
      <div className="min-w-0">
        <OrgDownPaymentItem {...settingProps('down-payment')} />
      </div>
    </div>
  );
};

export default TaxAdvancesTask;
