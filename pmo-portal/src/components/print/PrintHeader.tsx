import React from 'react';
import { cn } from '@/src/components/ui';

export interface PrintHeaderMetaItem {
  label: string;
  value: React.ReactNode;
}

export interface PrintHeaderProps {
  orgName?: string;
  documentTitle: string;
  documentNumber: string;
  numberLabel?: string;
  metaItems: PrintHeaderMetaItem[];
  className?: string;
}

/**
 * Standard printable document header for PMO layouts (#2687, #2688).
 * Shows org identifier, document type, number, and key reference metadata.
 */
export const PrintHeader: React.FC<PrintHeaderProps> = ({
  orgName,
  documentTitle,
  documentNumber,
  numberLabel = 'Number / No.',
  metaItems,
  className,
}) => {
  return (
    <header className={cn('border-b-2 border-foreground pb-6 mb-6', className)} data-testid="print-header">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 mb-6">
        <div>
          {orgName ? (
            <div className="text-xs font-semibold text-muted-foreground mb-1">
              {orgName}
            </div>
          ) : null}
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground">
            {documentTitle}
          </h1>
        </div>
        <div className="sm:text-right">
          <div className="text-xs font-semibold text-muted-foreground">
            {numberLabel}
          </div>
          <div className="text-xl sm:text-2xl font-bold font-mono tracking-tight text-foreground" data-testid="print-document-number">
            {documentNumber}
          </div>
        </div>
      </div>

      {metaItems.length > 0 ? (
        <dl className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-x-4 gap-y-3 pt-2 border-t border-border text-sm">
          {metaItems.map((item, idx) => (
            <div key={idx} className="min-w-0">
              <dt className="text-xs font-medium text-muted-foreground">
                {item.label}
              </dt>
              <dd className="font-medium text-foreground break-words mt-0.5">
                {item.value ?? '—'}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
    </header>
  );
};
