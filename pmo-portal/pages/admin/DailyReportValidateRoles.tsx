import React, { useEffect, useId, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BUILT_IN_ROLES } from '@/src/auth/builtInRoles';
import { useEffectiveRole } from '@/src/auth/impersonation';
import { usePermission } from '@/src/auth/usePermission';
import { Button, Checkbox, FieldError, ListState, useToast } from '@/src/components/ui';
import { useDailyReportValidateRoles, useSaveDailyReportValidateRoles } from '@/src/hooks/useDailyReportValidateRoles';
import { useBuiltInRoleName } from '@/src/hooks/useOrgRoleNames';
import { useOrgSwitch } from '@/src/hooks/useOrgSwitch';
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

  const [draft, setDraft] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDraft(null);
  }, [query.data]);

  const saved = useMemo(() => [...(query.data ?? [])].sort(), [query.data]);
  const selected = useMemo(() => draft ?? saved, [draft, saved]);
  const dirty = draft !== null && [...selected].sort().join(',') !== saved.join(',');
  const disabled = !isAdmin || !builtInOn || save.isPending;

  const toggle = (key: string, on: boolean) => {
    setError(null);
    const next = on ? [...selected, key] : selected.filter((k) => k !== key);
    setDraft([...new Set(next)].sort());
  };

  const onSave = async () => {
    setError(null);
    try {
      await save.mutateAsync(selected);
      setDraft(null);
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
          "Admin, Finance, and a project's own Project Manager can always validate another person's daily site report. Tick job roles whose active holders may also validate reports across your organisation.",
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
            <fieldset className="min-w-0" aria-describedby={helperId}>
              <legend className="sr-only">
                {t('admin.dsrValidateRoles.legend', 'Job roles that validate daily site reports')}
              </legend>
              <div className="grid grid-cols-1 gap-x-4 sm:grid-cols-2 lg:grid-cols-3">
                {ASSIGNABLE_ROLES.map((r) => (
                  <Checkbox
                    key={r.key}
                    label={roleName(r.key)}
                    checked={selected.includes(r.key)}
                    disabled={disabled}
                    onChange={(on) => toggle(r.key, on)}
                    className="min-h-11"
                  >
                    {roleName(r.key)}
                  </Checkbox>
                ))}
              </div>
            </fieldset>
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
