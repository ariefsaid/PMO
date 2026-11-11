import React from 'react';
import { useTranslation } from 'react-i18next';
import { formatDateTime } from '@/src/lib/format';

export function RejectionDetails({ reason, person, at }: { reason?: string | null; person?: string | null; at?: string | null }) {
  const { t } = useTranslation();
  return <span className="block break-words text-control">
    <span className="block">{reason?.trim() || t('rejection.reasonUnavailable', 'Reason unavailable')}</span>
    <span className="block text-muted-foreground">{person || t('rejection.personUnavailable', 'Person unavailable')}{at ? ` · ${formatDateTime(new Date(at))}` : ''}</span>
  </span>;
}
