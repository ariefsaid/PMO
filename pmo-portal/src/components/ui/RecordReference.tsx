import { useTranslation } from 'react-i18next';
import { cn } from './cn';

export interface RecordReferenceProps {
  /** One or more raw system identifiers. Empty values are dropped, a wholly empty list renders nothing. */
  ids: Array<string | null | undefined>;
  className?: string;
}

/**
 * plain-words C20 (ruling 3b/3c): a raw record id is reference material, never the answer a person
 * reads first. It sits behind a disclosure beside the name, on the admin surfaces that need to
 * quote it. Shared so every surface hides it the same way instead of each inventing a label.
 */
export function RecordReference({ ids, className }: RecordReferenceProps) {
  const { t } = useTranslation();
  const shown = ids.filter((id): id is string => typeof id === 'string' && id.trim().length > 0);
  if (shown.length === 0) return null;
  return (
    <details className={cn('min-w-0 text-control text-muted-foreground', className)} data-testid="record-reference">
      <summary className="w-fit cursor-pointer rounded-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
        {t('ui.recordReference', 'Reference')}
      </summary>
      <code className="break-all font-mono">{shown.join(', ')}</code>
    </details>
  );
}
