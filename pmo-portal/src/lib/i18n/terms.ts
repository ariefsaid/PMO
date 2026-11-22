import { useTranslation } from 'react-i18next';

/**
 * The catalogue's shared terms (`common:terms.*`). Each names ONE thing in ONE place; a string
 * that mentions it embeds `$t(common:terms.<key>)` instead of spelling the word, so the owner's
 * rulings (Bahasa: "Timesheet", "Supplier", "Work order", "Dasbor" on every device) change in one line.
 * Literal `t(key, default)` calls keep the key visible to the i18n completeness gate.
 */
export function useTerms() {
  const { t } = useTranslation();
  return {
    dashboard: t('terms.dashboard', 'Dashboard'),
    supplier: t('terms.supplier', 'Supplier'),
    timesheet: t('terms.timesheet', 'Timesheet'),
    clientWorkOrder: t('terms.clientWorkOrder', 'Work order'),
    /** #2576: a section of a work order. The one place the word is spelled; no screen types it. */
    section: t('terms.section', 'Section'),
    sections: t('terms.sections', 'Sections'),
  };
}
