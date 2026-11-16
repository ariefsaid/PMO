import React from 'react';
import { useTranslation } from 'react-i18next';

/** The fixed, safe text shown when a widget payload cannot be rendered (NFR-ATC-SEC-002). */
export const WidgetFallback: React.FC = () => {
  const { t } = useTranslation('assistantPanel');
  return (
  <div
    role="note"
    className="rounded-md border border-border bg-secondary/40 px-3 py-2 text-xs text-muted-foreground"
  >
    {t('widgetFallback', "This result couldn't be displayed.")}
  </div>
  );
};
