/**
 * EmptyState — shown when the transcript has no messages yet.
 * Includes heading, descriptor, read-only footnote, and example chips.
 * FR-AP-020; AC-AP-017/018.
 * Clicking a chip pre-fills the composer (does NOT auto-submit).
 */
import React from 'react';
import { useTranslation } from 'react-i18next';
import { useAgentContext } from '@/src/lib/agent/context/useAgentContext';
import { EXAMPLE_QUESTIONS } from './emptyState.constants';
import { SUGGESTION_CHIPS } from './suggestionChips.constants';

interface EmptyStateProps {
  /** Called with the selected question text when a chip is clicked. */
  onPick: (question: string) => void;
}

export const EmptyState: React.FC<EmptyStateProps> = ({ onPick }) => {
  const { getContext } = useAgentContext();
  const { t } = useTranslation('assistantPanel');
  const entityType = getContext().entity?.type;
  const examples = [
    t('examples.projectSchedule', EXAMPLE_QUESTIONS[0]),
    t('examples.openOpportunities', EXAMPLE_QUESTIONS[1]),
    t('examples.companiesWithoutProjects', EXAMPLE_QUESTIONS[2]),
  ];
  const translatedSuggestions: Record<string, readonly string[]> = {
    project: [
      t('suggestions.projectStatus', SUGGESTION_CHIPS.project[0]),
      t('suggestions.projectOverdueTasks', SUGGESTION_CHIPS.project[1]),
      t('suggestions.projectBudget', SUGGESTION_CHIPS.project[2]),
    ],
    procurement_case: [
      t('suggestions.procurementSummary', SUGGESTION_CHIPS.procurement_case[0]),
      t('suggestions.procurementNextStep', SUGGESTION_CHIPS.procurement_case[1]),
      t('suggestions.procurementOpenItems', SUGGESTION_CHIPS.procurement_case[2]),
    ],
    company: [
      t('suggestions.companyActiveWork', SUGGESTION_CHIPS.company[0]),
      t('suggestions.companyOpportunities', SUGGESTION_CHIPS.company[1]),
      t('suggestions.companyProjects', SUGGESTION_CHIPS.company[2]),
    ],
    contact: [
      t('suggestions.contactActivity', SUGGESTION_CHIPS.contact[0]),
      t('suggestions.contactOpenItems', SUGGESTION_CHIPS.contact[1]),
    ],
  };
  const chips = (entityType && translatedSuggestions[entityType]) || examples;

  return (
    <div className="flex flex-col items-start gap-4 px-4 py-6">
      <div>
        <h2 className="text-base font-semibold text-foreground">{t('title', 'Ask your agent')}</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {t('visibility', 'I only see what you can see.')}
        </p>
      </div>

      <div className="flex flex-col gap-2 w-full">
        {chips.map((q) => (
          <button
            key={q}
            type="button"
            onClick={() => onPick(q)}
            className="rounded-md border border-border px-3 py-2 text-left text-sm text-foreground hover:bg-accent focus:outline-none focus:ring-2 focus:ring-ring"
          >
            {q}
          </button>
        ))}
      </div>

      <p className="text-xs text-muted-foreground">{t('readOnly', 'Answers are read-only for now.')}</p>
    </div>
  );
};
