import React from 'react';
import { Button, Icon } from '@/src/components/ui';

export interface PrintActionBarProps {
  title: string;
  onBack: () => void;
  onPrint?: () => void;
  printLabel?: string;
  backLabel?: string;
}

/**
 * Screen-only action bar for printable documents (#2687, #2688).
 * Hidden automatically when printing via CSS `@media print` / `print:hidden`.
 */
export const PrintActionBar: React.FC<PrintActionBarProps> = ({
  title,
  onBack,
  onPrint,
  printLabel = 'Print',
  backLabel = 'Back',
}) => {
  const handlePrint = () => {
    if (onPrint) {
      onPrint();
    } else if (typeof window !== 'undefined') {
      window.print();
    }
  };

  return (
    <div
      data-testid="print-action-bar"
      className="print-hide print:hidden sticky top-0 z-20 flex items-center justify-between gap-4 border-b border-border bg-card/90 px-4 py-3 backdrop-blur-sm sm:px-8"
    >
      <div className="flex items-center gap-3 min-w-0">
        <Button
          variant="outline"
          size="sm"
          onClick={onBack}
          aria-label={backLabel}
          data-testid="print-back-button"
        >
          <Icon name="back" className="h-4 w-4 mr-1.5" />
          <span>{backLabel}</span>
        </Button>
        <span className="truncate text-sm font-semibold text-foreground sm:text-base">
          {title}
        </span>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <Button
          variant="primary"
          size="sm"
          onClick={handlePrint}
          data-testid="print-trigger-button"
        >
          <Icon name="doc" className="h-4 w-4 mr-1.5" />
          <span>{printLabel}</span>
        </Button>
      </div>
    </div>
  );
};
