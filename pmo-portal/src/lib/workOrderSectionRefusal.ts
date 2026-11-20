import type { TFunction } from 'i18next';
import { classifyMutationError } from '@/src/lib/classifyMutationError';

export interface SectionRefusal { headline: string; detail?: string }

/**
 * Plain words for the refusals the section tables raise (1095..1099). The database wrote each with a stable
 * `WOS_*` prefix; anything else falls through to the shared classifier. The verbatim server text is never shown.
 * `terms` are the organisation's words for the entity (`useTerms()`), passed in so no screen spells them.
 */
export function sectionRefusal(err: unknown, t: TFunction<'workOrderSections'>, terms: { section: string; sections: string }): SectionRefusal {
  const e = err as { code?: unknown; message?: unknown } | null;
  const code = typeof e?.code === 'string' ? e.code : '';
  const message = typeof e?.message === 'string' ? e.message : '';
  const vars = { section: terms.section.toLowerCase(), sections: terms.sections.toLowerCase() };
  if (code === '23505' && /work_order_sections_code_uniq/.test(message)) {
    return { headline: t('errors.duplicateCode', 'That code is already used on this work order'), detail: t('errors.duplicateCodeSub', 'Codes stay reserved, even for archived {{sections}}. Choose another.', vars) };
  }
  if (message.includes('WOS_ALLOCATION_CAP')) {
    const m = /would be ([\d.]+) against a work-order plan of ([\d.]+)/.exec(message);
    return { headline: t('errors.allocationCap', 'Above the work-order plan'),
      detail: m ? t('errors.allocationCapSub', 'The planned quantities would add up to {{total}} against a work-order plan of {{plan}}.', { total: m[1], plan: m[2] }) : undefined };
  }
  if (message.includes('WOS_ITEM')) return { headline: t('errors.item', 'That item cannot be planned'), detail: t('errors.itemSub', 'Choose a live stock item of this organisation.') };
  if (message.includes('WOS_FOREMAN_COLUMNS')) return { headline: t('errors.foremanColumns', 'A foreman can only set readiness') };
  if (message.includes('WOS_FOREMAN')) return { headline: t('errors.foreman', 'The foreman must be an active user'), detail: t('errors.foremanSub', 'Choose someone who can sign in to this organisation.') };
  if (message.includes('WOS_ARCHIVE_BLOCKED')) return { headline: t('errors.archiveBlocked', "Can't archive yet"), detail: message.replace(/^.*WOS_ARCHIVE_BLOCKED:\s*/, '') };
  if (message.includes('WOS_SECTION_ARCHIVED')) return { headline: t('errors.archived', 'That {{section}} is archived', vars), detail: t('errors.archivedSub', 'Archived {{sections}} take no new records. Restore it first.', vars) };
  if (message.includes('WOS_STATUS') || message.includes('WOS_CANCELLED')) return { headline: t('errors.status', 'This work order no longer takes this change') };
  if (code === '23503') return { headline: t('errors.inUse', 'In use'), detail: t('errors.inUseSub', 'Records still point at this {{section}}. Archive it instead.', vars) };
  const c = classifyMutationError(err);
  return { headline: c.headline, detail: c.detail };
}
