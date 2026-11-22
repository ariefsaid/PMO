import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { RecordSection, SelectField, TextField, useToast } from '@/src/components/ui';
import { useSafetyMutations } from '@/src/hooks/useSafetyDays';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import type { SafetyChecklistAnswer, SafetyDayDetail } from '@/src/lib/db/safetyDays';

const NoteField: React.FC<{ label: string; placeholder: string; saved: string; onCommit: (note: string) => void }> = ({ label, placeholder, saved, onCommit }) => {
  const [value, setValue] = useState(saved);
  return <TextField label={label} hideLabel placeholder={placeholder} value={value} onChange={setValue} onBlur={() => { if (value !== saved) onCommit(value); }} />;
};

/** Pre-work checklist (OD-DSF-5): the organisation's active list copied onto the day; each item yes / no / not applicable, a note on no. */
export const ChecklistPart: React.FC<{ detail: SafetyDayDetail; editable: boolean }> = ({ detail, editable }) => {
  const { t } = useTranslation('safety');
  const { toast } = useToast();
  const m = useSafetyMutations();
  const answerLabel = (a: SafetyChecklistAnswer['answer']) => (a ? t(`checklist.answer.${a}`, { yes: 'Yes', no: 'No', not_applicable: 'Not applicable' }[a]) : t('checklist.unanswered', 'Not answered'));
  const save = (c: SafetyChecklistAnswer, answer: SafetyChecklistAnswer['answer'], note: string | null) =>
    m.answerChecklist.mutateAsync({ id: c.id, answer, note }).catch((err) => { const { headline, detail: d } = classifyMutationError(err); toast(headline, d, 'warning'); });
  if (detail.checklist.length === 0) {
    return <RecordSection title={t('checklist.title', 'Pre-work checklist')} data-testid="safety-checklist"><p className="text-muted-foreground">{t('checklist.none', 'No checklist is set up yet. An Admin adds the items under Safety records in Project setup.')}</p></RecordSection>;
  }
  return (
    <RecordSection title={t('checklist.title', 'Pre-work checklist')} data-testid="safety-checklist">
      <ul className="divide-y divide-border">
        {detail.checklist.map((c) => (
          <li key={c.id} className="grid gap-2 py-2 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,2fr)] sm:items-end" data-testid="safety-checklist-row" data-answer={c.answer ?? ''}>
            <span className="font-medium">{c.label}</span>
            {editable ? (
              <>
                <SelectField label={t('checklist.answerLabel', { defaultValue: 'Answer for {{item}}', item: c.label })} hideLabel value={c.answer ?? ''} onChange={(v) => void save(c, (v || null) as SafetyChecklistAnswer['answer'], c.note)}
                  options={[{ value: '', label: t('checklist.unanswered', 'Not answered') }, ...(['yes', 'no', 'not_applicable'] as const).map((a) => ({ value: a, label: answerLabel(a) }))]} />
                {c.answer === 'no' && (
                  <NoteField label={t('checklist.noteLabel', { defaultValue: 'Note for {{item}}', item: c.label })} placeholder={t('checklist.note', 'Note (required when no)')}
                    saved={c.note ?? ''} onCommit={(note) => void save(c, c.answer, note)} />
                )}
              </>
            ) : (
              <>
                <span>{answerLabel(c.answer)}</span>
                <span className="text-muted-foreground">{c.note}</span>
              </>
            )}
          </li>
        ))}
      </ul>
    </RecordSection>
  );
};
