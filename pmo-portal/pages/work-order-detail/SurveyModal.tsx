import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { EntityFormModal, FormGrid, FormSection, NumberField, SelectField, TextArea, TextField, type SubmitError } from '@/src/components/ui';
import { Button } from '@/src/components/ui/Button';
import { DateField } from '@/src/components/ui/DateField';
import { useRefusalText } from '@/src/lib/refusals';
import { formatNumberExact, parseMoneyInputAtScale } from '@/src/lib/format';
import { milli } from '@/src/lib/progressBilling';
import type { RecordSurveyInput } from '@/src/lib/db/surveyRecords';

/**
 * Record a survey (or a correction of a confirmed one) on one work-order line. Who took part is typed data: a name, an optional
 * company and role; nothing here knows what kind of survey it is. Quality documents come from the project register. The database
 * re-checks everything (quality-ready within surveyed, who may record, the work order issued).
 */
export interface SurveyLineOption { id: string; label: string; unit: string }
export interface SurveyDocumentOption { id: string; title: string }

export interface SurveyModalProps {
  workOrderId: string;
  lines: SurveyLineOption[];
  documents: SurveyDocumentOption[];
  /** A correction: the confirmed survey it supersedes (its line is fixed). */
  correcting?: { id: string; boqItemId: string } | null;
  today: string;
  onClose: () => void;
  onSave: (input: RecordSurveyInput) => Promise<unknown>;
}

interface Person { name: string; company: string; role: string }
const BLANK: Person = { name: '', company: '', role: '' };

const SurveyModal: React.FC<SurveyModalProps> = ({ workOrderId, lines, documents, correcting = null, today, onClose, onSave }) => {
  const { t } = useTranslation('survey');
  const refusal = useRefusalText();
  const [boqItemId, setBoqItemId] = useState(correcting?.boqItemId ?? '');
  const [date, setDate] = useState(today);
  const [surveyed, setSurveyed] = useState('');
  const [quality, setQuality] = useState('');
  const [note, setNote] = useState('');
  const [people, setPeople] = useState<Person[]>([{ ...BLANK }]);
  const [docIds, setDocIds] = useState<string[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<SubmitError | null>(null);
  const unit = lines.find((l) => l.id === boqItemId)?.unit ?? '';

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (!boqItemId) errs.line = t('form.errors.line', 'Choose a contract line');
    if (!date) errs.date = t('form.errors.date', 'Enter the survey date');
    const s = parseMoneyInputAtScale(surveyed.trim(), 3);
    const q = quality.trim() === '' ? 0 : parseMoneyInputAtScale(quality.trim(), 3);
    if (s === null || s < 0) errs.surveyed = t('form.errors.surveyed', 'Enter a quantity of 0 or more with at most 3 decimal places');
    if (q === null || q < 0) errs.quality = t('form.errors.quality', 'Enter a quantity of 0 or more with at most 3 decimal places');
    else if (s !== null && milli(q) > milli(s)) errs.quality = t('form.errors.qualityOver', 'The quality-ready quantity cannot be more than the surveyed quantity');
    const named = people.filter((p) => p.name.trim() !== '');
    if (named.length === 0 || named.length !== people.filter((p) => p.name.trim() !== '' || p.company.trim() !== '' || p.role.trim() !== '').length) {
      errs.people = t('form.errors.person', 'Add at least one person, each with a name');
    }
    setErrors(errs);
    if (Object.keys(errs).length > 0 || s === null || q === null) return;
    setSaving(true);
    setSaveError(null);
    void onSave({
      workOrderId, boqItemId, surveyDate: date, surveyedQuantity: s, qualityReadyQuantity: q,
      participants: named.map((p) => ({ name: p.name.trim(), company: p.company.trim() || undefined, role: p.role.trim() || undefined })),
      ...(correcting ? { supersedesId: correcting.id } : {}),
      ...(note.trim() ? { note: note.trim() } : {}),
      documentIds: docIds,
    }).then(onClose).catch((err: unknown) => {
      const r = refusal(err);
      setSaveError({ headline: r.headline, detail: r.detail || undefined });
    }).finally(() => setSaving(false));
  };
  const setPerson = (i: number, patch: Partial<Person>) => setPeople((cur) => cur.map((p, j) => (j === i ? { ...p, ...patch } : p)));

  return (
    <EntityFormModal open width="lg"
      title={correcting ? t('form.titleCorrect', 'Correct a survey') : t('form.titleNew', 'Record a survey')}
      submitLabel={t('form.submit', 'Save draft')} onSubmit={submit} submitError={saveError} onClose={onClose} loading={saving}
      dirty={surveyed !== '' || quality !== '' || note !== '' || docIds.length > 0 || people.some((p) => p.name !== '')}>
      <FormSection legend={t('title', 'Surveys')}>
        <FormGrid>
          <SelectField id="survey-line" label={t('form.line', 'Contract line')} required value={boqItemId} onChange={setBoqItemId}
            placeholder={t('form.linePlaceholder', 'Choose a line')} disabled={correcting !== null}
            options={lines.map((l) => ({ value: l.id, label: l.label }))} error={errors.line} />
          <DateField id="survey-date" label={t('form.date', 'Survey date')} required value={date} max={today} onChange={setDate} error={errors.date} />
          <NumberField id="survey-surveyed" required localeAware error={errors.surveyed} value={surveyed} onChange={setSurveyed}
            label={unit ? t('form.surveyed', 'Surveyed quantity ({{unit}})', { unit }) : t('form.surveyedNoUnit', 'Surveyed quantity')} />
          <NumberField id="survey-quality" localeAware error={errors.quality} value={quality} onChange={setQuality}
            label={t('form.quality', 'Quality-ready quantity')} helper={t('form.qualityHelp', 'The part of the surveyed quantity that has quality documents. Attach them below.')} />
        </FormGrid>
      </FormSection>
      <FormSection legend={t('form.people', 'Who took part')}>
        <p className="text-sm text-muted-foreground">{t('form.peopleHelp', 'Anyone who took part, with or without an account: a customer representative, a supervisor, a surveyor.')}</p>
        {people.map((p, i) => (
          <div key={i} className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-[1fr_1fr_1fr_auto] md:items-end">
            <TextField label={t('form.name', 'Name')} value={p.name} onChange={(v) => setPerson(i, { name: v })} maxLength={120} />
            <TextField label={t('form.company', 'Company (optional)')} value={p.company} onChange={(v) => setPerson(i, { company: v })} maxLength={120} />
            <TextField label={t('form.role', 'Role (optional)')} value={p.role} onChange={(v) => setPerson(i, { role: v })} maxLength={120} />
            {people.length > 1 && <Button variant="outline" size="sm" aria-label={t('form.removePerson', 'Remove person {{n}}', { n: formatNumberExact(i + 1) })}
              onClick={() => setPeople((cur) => cur.filter((_, j) => j !== i))}>×</Button>}
          </div>
        ))}
        {errors.people && <p role="alert" className="mt-1 text-sm text-destructive-text">{errors.people}</p>}
        {people.length < 30 && <div className="mt-3"><Button variant="outline" size="sm" onClick={() => setPeople((cur) => [...cur, { ...BLANK }])}>{t('form.addPerson', 'Add a person')}</Button></div>}
      </FormSection>
      <FormSection legend={t('form.documents', 'Quality documents')}>
        {documents.length === 0
          ? <p className="text-sm text-muted-foreground">{t('form.noDocuments', 'No issued document with a file in the project register yet.')}</p>
          : <>
              <p className="text-sm text-muted-foreground">{t('form.documentsHelp', "From this project's register: issued or approved, with a file.")}</p>
              <ul className="mt-2 space-y-1">
                {documents.map((d) => (
                  <li key={d.id}><label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={docIds.includes(d.id)}
                      onChange={(e) => setDocIds((cur) => (e.target.checked ? [...cur, d.id] : cur.filter((x) => x !== d.id)))} />
                    {d.title}
                  </label></li>
                ))}
              </ul>
            </>}
      </FormSection>
      <TextArea id="survey-note" label={t('form.note', 'Note (optional)')} value={note} onChange={setNote} maxLength={500} rows={2} fullWidth />
    </EntityFormModal>
  );
};

export default SurveyModal;
