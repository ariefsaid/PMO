import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, FieldError, ListState, TextField, useToast } from '@/src/components/ui';
import { usePermission } from '@/src/auth/usePermission';
import { useAttendanceTarget, useSetAttendanceTarget } from '@/src/hooks/useAttendanceRate';
import { attendanceTargetIssue } from '@/src/lib/db/attendanceRate';
import { classifyMutationError } from '@/src/lib/classifyMutationError';

/**
 * Administration › Projects › Attendance target (#2706, FR-ATR-001..003).
 *
 * One organisation percentage. Empty (off) is a real choice and the default: until an Admin sets it, the Crews page
 * offers no rate view, so an existing organisation sees no change. The database enforces who may write it
 * (organizations' Admin-only update policy plus 1436's column grant); this control mirrors that and is UX only.
 */
const OrgAttendanceTarget: React.FC = () => {
  const { t } = useTranslation('administration');
  const may = usePermission();
  const canManage = may('manage', 'attendanceTarget');
  const { toast } = useToast();
  const query = useAttendanceTarget();
  const mutation = useSetAttendanceTarget();
  const saved = query.data ?? null;
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const shown = draft ?? (saved === null ? '' : String(saved));

  useEffect(() => {
    if (query.isSuccess) setDraft(null);
  }, [query.isSuccess, saved]);

  if (!canManage) return null;

  const parse = (): number | null => {
    const trimmed = shown.trim();
    if (trimmed === '') return null;
    const value = Number(trimmed.replace(',', '.'));
    return Number.isFinite(value) ? value : Number.NaN;
  };

  const run = async (value: number | null) => {
    setError(null);
    const issue = attendanceTargetIssue(value);
    if (issue === 'range') { setError(t('administration:admin.attendanceTarget.range', 'The target runs from 0 to 100.')); return; }
    if (issue === 'precision') { setError(t('administration:admin.attendanceTarget.precision', 'Give the target at most two decimals.')); return; }
    try {
      await mutation.mutateAsync(value);
      toast(t('administration:admin.attendanceTarget.saved', 'Attendance target saved'), undefined, 'success');
    } catch (err) {
      const { headline, detail } = classifyMutationError(err);
      setError(detail || headline);
    }
  };

  return (
    <section id="attendance-target" tabIndex={-1} className="scroll-mt-4" aria-labelledby="attendance-target-heading">
      <h2 id="attendance-target-heading" className="text-group font-semibold tracking-[-0.01em]">
        {t('administration:admin.attendanceTarget.title', 'Attendance target')}
      </h2>
      <p className="mt-1 max-w-prose text-control text-muted-foreground">
        {t('administration:admin.attendanceTarget.helper', 'The attendance rate each crew is measured against, as a percentage. Leave it empty to keep the attendance-rate view off.')}
      </p>
      {query.isError && !query.data ? (
        <div className="mt-3">
          <ListState variant="error" title={t('administration:admin.attendanceTarget.loadError', "Couldn't load the target")} onRetry={() => void query.refetch()} />
        </div>
      ) : (
        <form
          className="mt-3 flex flex-wrap items-end gap-2"
          onSubmit={(event) => { event.preventDefault(); void run(parse()); }}
        >
          <TextField
            label={t('administration:admin.attendanceTarget.label', 'Target rate (%)')}
            value={shown}
            inputMode="decimal"
            onChange={(value) => { setDraft(value); setError(null); }}
            disabled={mutation.isPending}
          />
          <Button type="submit" variant="primary" disabled={mutation.isPending || parse() === saved}>
            {t('administration:admin.attendanceTarget.save', 'Save target')}
          </Button>
          {saved !== null && (
            <Button type="button" variant="outline" disabled={mutation.isPending} onClick={() => { setDraft(''); void run(null); }}>
              {t('administration:admin.attendanceTarget.turnOff', 'Turn off')}
            </Button>
          )}
        </form>
      )}
      {error && <FieldError id="attendance-target-error">{error}</FieldError>}
      <p className="mt-2 text-control text-muted-foreground" role="status">
        {saved === null
          ? t('administration:admin.attendanceTarget.off', 'Off: the attendance-rate view is not offered.')
          : t('administration:admin.attendanceTarget.on', 'Crews are measured against this target.')}
      </p>
    </section>
  );
};

export default OrgAttendanceTarget;
