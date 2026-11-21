import React from 'react';
import { cn } from '@/src/components/ui';

export interface PrintDocumentProps {
  children: React.ReactNode;
  className?: string;
  testId?: string;
}

/**
 * Reusable paper container for browser-printable PMO documents (#2687, #2688).
 *
 * Screen: centered card on canvas with max-width and subtle shadow.
 * Print: fills 100% width, margin 0, removes shadows and backgrounds.
 */
export const PrintDocument: React.FC<PrintDocumentProps> = ({
  children,
  className,
  testId = 'print-document',
}) => {
  return (
    <div
      data-testid={testId}
      className={cn(
        'mx-auto w-full max-w-4xl bg-card text-foreground',
        'p-6 sm:p-10 my-4 sm:my-8 rounded-lg border border-border shadow-sm',
        'print:my-0 print:p-0 print:border-none print:shadow-none print:max-w-none print:w-full print:bg-transparent',
        className,
      )}
    >
      <style>{`
        @media print {
          @page {
            size: auto;
            margin: 15mm;
          }
          body {
            background-color: transparent !important;
            color: #000 !important;
          }
          .print-hide {
            display: none !important;
          }
          .break-inside-avoid {
            break-inside: avoid;
            page-break-inside: avoid;
          }
        }
      `}</style>
      {children}
    </div>
  );
};
