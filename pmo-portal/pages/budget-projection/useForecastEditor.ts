import { useEffect, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { BudgetProjectionCellRow } from '@/src/lib/repositories/budgetProjection';
import { upsertBudgetProjectionEtc } from '@/src/lib/repositories/budgetProjection';
import { parseMoneyInputAtScale } from '@/src/lib/format';
import { classifyMutationError } from '@/src/lib/classifyMutationError';

type Entry = { category: BudgetProjectionCellRow['category']; amount: number };

export function useForecastEditor(projectId: string, fiscalYear: string, rows: BudgetProjectionCellRow[]) {
  const { t } = useTranslation('finance');
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const draftRef = useRef(draft);
  const baseline = useRef<Record<string, number>>({});
  const session = useRef(0);
  const editorKey = useRef<{ project: string; year: string } | null>(null);
  const inFlight = useRef(false);
  const [pending, setPending] = useState(false);
  const sectionRef = useRef<HTMLElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const restoreFocus = useRef(false);
  useEffect(() => {
    if (editing) { sectionRef.current?.querySelector<HTMLInputElement>('[data-forecast-editor] input')?.focus(); return; }
    if (restoreFocus.current) { restoreFocus.current = false; triggerRef.current?.focus(); }
  }, [editing]);
  const updateDraft = (next: Record<string, string>) => { draftRef.current = next; setDraft(next); };
  const closeEdit = () => { restoreFocus.current = true; setEditing(false); };
  const save = useMutation({
    mutationFn: async ({ entries, year, project }: { entries: Entry[]; year: string; project: string; sessionId: number }) => {
      const failed: Array<Entry & { reason: string }> = [];
      const saved: Entry[] = [];
      for (const entry of entries) {
        try { await upsertBudgetProjectionEtc(project, year, entry.category, entry.amount); saved.push(entry); }
        catch (error) { failed.push({ ...entry, reason: classifyMutationError(error).headline }); }
      }
      return { failed, saved };
    },
    onSuccess: ({ failed, saved }, { project, year, sessionId }) => {
      void queryClient.invalidateQueries({ queryKey: ['budget-projection', project, year] });
      if (editorKey.current?.project === project && editorKey.current.year === year) {
        for (const entry of saved) baseline.current[entry.category] = entry.amount;
      }
      if (session.current !== sessionId) return;
      setErrors(Object.fromEntries(failed.map((item) => [item.category, t('projectDetail.budget.etcRowNotSaved', 'Not saved. {{reason}}', { reason: item.reason })])));
      const hasNewerDraft = Object.entries(draftRef.current).some(([category, value]) => parseMoneyInputAtScale(value, 2) !== baseline.current[category]);
      if (failed.length === 0 && !hasNewerDraft) closeEdit();
    },
    onSettled: () => { inFlight.current = false; setPending(false); },
  });
  const beginEdit = () => {
    session.current += 1;
    editorKey.current = { project: projectId, year: fiscalYear };
    baseline.current = Object.fromEntries(rows.map((row) => [row.category, row.pmoEtc]));
    updateDraft(Object.fromEntries(rows.map((row) => [row.category, String(row.pmoEtc)])));
    setErrors({});
    save.reset();
    setEditing(true);
  };
  const cancelEdit = () => { session.current += 1; editorKey.current = null; setErrors({}); updateDraft({}); closeEdit(); };
  const changeDraft = (category: string, value: string) => updateDraft({ ...draftRef.current, [category]: value });
  const saveEdits = () => {
    if (inFlight.current) return;
    const entries: Entry[] = [];
    const nextErrors: Record<string, string> = {};
    for (const row of rows) {
      const parsed = parseMoneyInputAtScale(draftRef.current[row.category] ?? String(row.pmoEtc), 2);
      if (parsed === null || parsed < 0) nextErrors[row.category] = t('projectDetail.budget.etcValidation', 'Enter a non-negative amount with up to 2 decimal places.');
      else if (parsed !== baseline.current[row.category]) entries.push({ category: row.category, amount: parsed });
    }
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;
    if (!entries.length) { closeEdit(); return; }
    inFlight.current = true;
    setPending(true);
    save.mutate({ entries, project: projectId, year: fiscalYear, sessionId: session.current });
  };
  return { editing, draft, errors, sectionRef, triggerRef, beginEdit, cancelEdit, changeDraft, saveEdits, save: { ...save, isPending: pending } };
}
