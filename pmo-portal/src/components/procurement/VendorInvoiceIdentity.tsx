import type { FC } from 'react';
import { useTranslation } from 'react-i18next';
import { vendorInvoiceIdentityLines, type VendorInvoiceIdentityFacts } from './vendorInvoiceIdentityLabels';

export const VendorInvoiceIdentity: FC<VendorInvoiceIdentityFacts & { className?: string }> = ({
  referenceNumber,
  viNumber,
  invoiceDate,
  context,
  className = '',
}) => {
  const { t } = useTranslation();
  const lines = vendorInvoiceIdentityLines({ referenceNumber, viNumber, invoiceDate, context }, t);
  return (
    <div className={`min-w-0 space-y-0.5 break-words text-[13px] leading-5 ${className}`.trim()}>
      <p className="break-words font-medium text-foreground">{lines[0]}</p>
      {lines.slice(1).map((line, index) => (
        <p key={index} className="break-words text-muted-foreground">{line}</p>
      ))}
    </div>
  );
};
