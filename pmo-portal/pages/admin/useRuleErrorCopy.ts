import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import type { SubmitError } from '@/src/components/ui';

export function useRuleErrorCopy() {
  const { t } = useTranslation();
  return useCallback((err: unknown, operation: 'create' | 'update'): SubmitError => {
    // 23505 (a tie) carries the other rule's name in the server's message: "conflicts with rule <name>".
    const message = err instanceof Error ? err.message : '';
    const other = /conflicts with rule (.+)$/.exec(message)?.[1];
    const { headline, detail } = classifyMutationError(
      err,
      {
        '22023': t('costAttribution:error.invalid', "This rule can't be saved"),
        '23505': t('costAttribution:error.tie', 'This rule overlaps another rule'),
        '40001': t('costAttribution:error.stale', 'This rule has changed since you opened it'),
        P0002: t('costAttribution:error.notFound', "Something this rule refers to wasn't found"),
      },
      {
        module: 'administration',
        operation,
        detailOverrides: {
          '42501': t('costAttribution:error.permission', 'Only Finance and Admin can change cost attribution rules.'),
          '23505': other
            ? t('costAttribution:error.tieNamed', 'It overlaps "{{name}}" with equal specificity. Narrow one of them by cost centre or party, or change the dates.', { name: other })
            : t('costAttribution:error.tieDetail', 'It overlaps another rule with equal specificity. Narrow one of them by cost centre or party, or change the dates.'),
          '40001': t('costAttribution:error.staleDetail', 'Someone saved a newer version. The list has been reloaded; reopen the rule to edit the latest version.'),
        },
      },
    );
    return { headline, detail };
  }, [t]);
}
