import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Card, CardHead, CardPad } from '@/src/components/ui';
import { RecordHistory } from './RecordHistory';

/**
 * Collapsed History card for record pages that have no tab bar (company, contact): same structure as
 * the page's other Card sections, and nothing is fetched until it is opened.
 */
export const HistorySection: React.FC<{ entityType: string; entityId: string }> = ({ entityType, entityId }) => {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  return (
    <Card variant="bare" className="mt-4">
      <CardHead>
        <button
          type="button"
          aria-expanded={open}
          aria-controls={`history-${entityId}`}
          onClick={() => setOpen((o) => !o)}
          className="flex min-h-8 w-full items-center justify-between gap-2 text-left"
        >
          <span>{t('history.title', 'History')}</span>
          <span aria-hidden className="text-muted-foreground">{open ? '−' : '+'}</span>
        </button>
      </CardHead>
      <CardPad>
        <div id={`history-${entityId}`} hidden={!open}>
          {open && <RecordHistory entityType={entityType} entityId={entityId} />}
        </div>
      </CardPad>
    </Card>
  );
};

export default HistorySection;
