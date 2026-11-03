/**
 * #1505 P8 (FR-OPP-030/031): what was received, per line, on an Odoo-owned org. Blank everywhere means everything still open
 * (the shipped default); a figure on a line receives just that quantity and leaves the rest open in Odoo.
 */
import React from 'react';
import { useTranslation } from 'react-i18next';
import { FieldError, TextField } from '@/src/components/ui';

import type { ReceiptItem } from '@/src/lib/procurement/receiptQuantities';

export const OdooReceiptQuantities: React.FC<{
  items: readonly ReceiptItem[];
  value: Record<string, string>;
  onChange: (next: Record<string, string>) => void;
  invalid?: string;
}> = ({ items, value, onChange, invalid }) => {
  const { t } = useTranslation('procurement');
  return (
    <fieldset className="min-w-0 border-0 p-0">
      <legend className="mb-1 text-[12px] font-semibold text-muted-foreground">{t('odoo.receipt.title', 'Quantity received')}</legend>
      <p className="mb-2 text-[12px] text-muted-foreground">{t('odoo.receipt.hint', 'Leave blank to receive everything still open. Odoo refuses more than is open.')}</p>
      <div className="grid gap-2 sm:grid-cols-2">
        {items.map((item) => (
          <TextField
            key={item.name}
            label={t('odoo.receipt.line', '{{name}} (ordered {{qty}})', { name: item.name, qty: item.quantity })}
            type="number"
            inputMode="decimal"
            min={0}
            step="any"
            value={value[item.name] ?? ''}
            onChange={(next) => onChange({ ...value, [item.name]: next })}
          />
        ))}
      </div>
      {invalid && <FieldError>{t('odoo.receipt.invalid', 'Enter a quantity above zero and no more than was ordered for {{name}}.', { name: invalid })}</FieldError>}
    </fieldset>
  );
};
