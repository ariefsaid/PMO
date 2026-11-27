import React, { useId, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BUILT_IN_ROLES } from '@/src/auth/builtInRoles';
import { useEffectiveRole } from '@/src/auth/impersonation';
import { usePermission } from '@/src/auth/usePermission';
import { Button, FieldError, ListState, useToast } from '@/src/components/ui';
import { RoleChecklist } from '@/src/components/admin/RoleChecklist';
import { useDailyReportValidateRoles, useSaveDailyReportValidateRoles } from '@/src/hooks/useDailyReportValidateRoles';
import { useBuiltInRoleName } from '@/src/hooks/useOrgRoleNames';
import { useOrgSwitch } from '@/src/hooks/useOrgSwitch';
import { useRemoteStringDraft } from '@/src/hooks/useRemoteStringDraft';
import { useRefusalLine } from '@/src/lib/refusals';

/** Field accounts are refused by dsr_may_validate and set_daily_report_validate_roles, so only manager and officer roles are offered. */
const ASSIGNABLE_ROLES = BUILT_IN_ROLES.filter((r) => r.tier !== 'field');

/**
 * Administration › Project setup › Validate daily site reports (migration 2290).
 * An Admin assigns the `daily_report_validate` capability to built-in manager/officer job roles for their organisation.
 * Defaults are unchanged (none ticked). `set_daily_report_validate_roles` and `actor_has_role_capability` enforce the rule in the database.
 */
const DailyReportValidateRoles: React.FC = () => {
  const { t } = useTranslation('administration');
  const { toast } = useToast();
  const refusal = useRefusalLine();
  const { realRole, effectiveRole } = useEffectiveRole();
  const viewOnly = realRole !== effectiveRole;
  const isAdminRole = usePermission()('manage', 'siteReportLists');
  const isAdmin = isAdminRole && !viewOnly;
  const builtInOn = useOrgSwitch('builtInRoles').data === true;
  const query = useDailyReportValidateRoles();
  const save = useSaveDailyReportValidateRoles();
  const roleName = useBuiltInRoleName();
  const helperId = useId();

  const remoteDraft = useRemoteStringDraft({ remote: JSON.stringify([...(query.data ?? [])].sort()), isSuccess: query.isSuccess });
  const draft: string[] | null = remoteDraft.dirty ? JSON.parse(remoteDraft.draft) : null;
  const setDraft = (value: string[]) => remoteDraft.setDraft(JSON.stringify([...value].sort()));
  const [error, setError] = useState<string | null>(null);


  const saved = useMemo(() => [...(query.data ?? [])].sort(), [query.data]);
  const selected = useMemo(() => draft ?? saved, [draft, saved]);
  const dirty = draft !== null && [...selected].sort().join(',') !== saved.join(',');
  const disabled = !isAdmin || !builtInOn || save.isPending;

  const onSave = async () => {
    setError(null);
    try {
      await save.mutateAsync(selected);
      remoteDraft.acceptSaved(JSON.stringify([...selected].sort()));
      toast(t('admin.dsrValidateRoles.saved', 'Site report validator roles saved'), undefined, 'success');
    } catch (err) {
      setError(refusal(err));
    }
  };

  return (
    <section
      id="daily-report-validate-roles"
      tabIndex={-1}
      className="scroll-mt-4"
      aria-labelledby="daily-report-validate-roles-heading"
      data-testid="daily-report-validate-roles"
    >
      <h2 id="daily-report-validate-roles-heading" className="text-group font-semibold tracking-[-0.01em]">
        {t('admin.dsrValidateRoles.title', 'Validate daily site reports')}
      </h2>
      <p id={helperId} className="mt-1 max-w-prose text-control text-muted-foreground">
        {t(
          'admin.dsrValidateRoles.intro',
          "Admin, Finance, and a project's own Project Manager can always validate another person's daily site report. Choose job roles whose active holders may also validate reports across your organisation.",
        )}
      </p>
      <div className="mt-3 space-y-3">
        {query.isError ? (
          <ListState
            variant="error"
            title={t('admin.dsrValidateRoles.loadError', "Couldn't load site report validator roles")}
            onRetry={() => void query.refetch()}
          />
        ) : query.isPending ? (
          <ListState variant="loading" rows={2} />
        ) : (
          <>
            {remoteDraft.remoteChanged && <div role="status"><p>{t('common:uxs11.downPaymentRemoteChanged', 'The saved item changed. Your edit is kept; reload the saved value to discard it.')}</p><Button variant="outline" size="sm" onClick={remoteDraft.reload}>{t('common:uxs11.reloadSaved', 'Reload saved values')}</Button></div>}
            <RoleChecklist
              legend={t('admin.dsrValidateRoles.legend', 'Job roles that validate daily site reports')}
              hideLegend
              describedBy={helperId}
              options={ASSIGNABLE_ROLES.map((r) => ({ key: r.key, name: roleName(r.key) }))}
              value={selected}
              onChange={(next) => { setError(null); setDraft([...new Set(next)].sort()); }}
              disabled={disabled}
            />
            {!isAdminRole ? (
              <p className="text-control text-muted-foreground">
                {t('admin.dsrValidateRoles.adminOnly', 'Only an Admin can change this.')}
              </p>
            ) : viewOnly ? (
              <p className="text-control text-muted-foreground">
                {t('admin.dsrValidateRoles.viewOnly', 'Exit view-as mode to change this setting.')}
              </p>
            ) : !builtInOn ? (
              <p className="text-control text-muted-foreground">
                {t(
                  'admin.dsrValidateRoles.turnOn',
                  'Turn on built-in roles in Administration > People to assign this capability.',
                )}
              </p>
            ) : (
              <div className="flex items-center gap-3 pt-1">
                <Button
                  variant="primary"
                  onClick={() => void onSave()}
                  loading={save.isPending}
                  disabled={!dirty || save.isPending}
                >
                  {t('admin.dsrValidateRoles.save', 'Save')}
                </Button>
              </div>
            )}
            {error && <FieldError>{error}</FieldError>}
          </>
        )}
      </div>
    </section>
  );
};

export default DailyReportValidateRoles;
