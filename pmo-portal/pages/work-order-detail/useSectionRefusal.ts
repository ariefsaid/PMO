import { useTranslation } from 'react-i18next';
import { useRefusalText } from '@/src/lib/refusals';
import { useTerms } from '@/src/lib/i18n/terms';

export interface SectionRefusal { headline: string; detail?: string }

/**
 * Plain words for a refused section write. A rule the database names (`WOS_*`) reads from the `refusals` catalogue;
 * this adds the two Postgres constraint cases (a reused code, a record still pointing at the section). `terms` are the
 * organisation's words for the entity, so no screen spells them.
 */
export function useSectionRefusal(): (err: unknown) => SectionRefusal {
  const { t } = useTranslation('workOrderSections');
  const terms = useTerms();
  const refusal = useRefusalText();
  const vars = { section: terms.section.toLowerCase(), sections: terms.sections.toLowerCase() };
  return (err) => {
    const e = err as { code?: unknown; message?: unknown } | null;
    const code = typeof e?.code === 'string' ? e.code : '';
    const message = typeof e?.message === 'string' ? e.message : '';
    if (code === '23505' && /work_order_sections_code_uniq/.test(message)) {
      return { headline: t('errors.duplicateCode', 'That code is already used on this work order'), detail: t('errors.duplicateCodeSub', 'Codes stay reserved, even for archived {{sections}}. Choose another.', vars) };
    }
    if (code === '23503') return { headline: t('errors.inUse', 'In use'), detail: t('errors.inUseSub', 'Records still point at this {{section}}. Archive it instead.', vars) };
    const r = refusal(err);
    return { headline: r.headline, detail: r.detail || undefined };
  };
}
