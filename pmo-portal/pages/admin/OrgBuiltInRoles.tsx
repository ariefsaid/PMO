import React, { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Button, FieldError, ListState, useToast } from '@/src/components/ui';
import { usePermission } from '@/src/auth/usePermission';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import { builtInRolesRepository } from '@/src/lib/repositories/builtInRoles';
import { BUILT_IN_ROLES_ENABLED_KEY, useBuiltInRolesEnabled } from '@/src/hooks/useBuiltInRoles';

/**
 * Administration › People › Built-in roles (#2709). One organization setting, off by default: while off, the Users screen is
 * exactly what it was. Turning it on lets an Admin give people any of the 28 built-in roles from Edit role; turning it off keeps
 * the roles people already hold. Admin-only via `can('manage', 'orgAccounting')` (UX); the server setter enforces it (ADR-0016).
 */
const OrgBuiltInRoles: React.FC = () => {
  const { t } = useTranslation('administration');
  const may = usePermission();
  const canManage = may('manage', 'orgAccounting');
  const { toast } = useToast();
  const qc = useQueryClient();
  const query = useBuiltInRolesEnabled();
  const [error, setError] = useState<string>();
  const enabled = query.data === true;

  const mutation = useMutation({
    mutationFn: (next: boolean) => builtInRolesRepository.setEnabled(next),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: [BUILT_IN_ROLES_ENABLED_KEY] });
      toast(t('admin.builtInRoles.saved', 'Built-in roles setting saved'), undefined, 'success');
    },
    onError: (err) => {
      const { headline, detail } = classifyMutationError(err);
      setError(detail || headline);
    },
  });

  return (
    <section id="org-built-in-roles" tabIndex={-1} className="scroll-mt-4 mt-8 border-t border-border pt-6" aria-labelledby="org-built-in-roles-heading">
      <h2 id="org-built-in-roles-heading" className="text-group font-semibold tracking-[-0.01em]">
        {t('admin.builtInRoles.title', 'Built-in roles')}
      </h2>
      <div className="mt-3 max-w-md space-y-3">
        {query.isError && !query.data ? (
          <ListState variant="error" title={t('admin.builtInRoles.loadError', "Couldn't load the built-in roles setting")} onRetry={() => void query.refetch()} />
        ) : query.data === undefined ? (
          <ListState variant="loading" rows={1} />
        ) : (
          <>
            <p className="text-control text-muted-foreground">
              {t('admin.builtInRoles.helper', 'Offer 28 roles across the functions of a contractor, in three levels. Each starts from one of the five access levels, so turning this on changes nothing until someone is given a role. People already given a role keep it if you turn this off.')}
            </p>
            <p className="text-control">
              <span className="font-semibold">{enabled ? t('admin.builtInRoles.on', 'On') : t('admin.builtInRoles.off', 'Off')}</span>
              {!canManage && <span className="ml-2 text-muted-foreground">{t('admin.builtInRoles.adminOnly', 'Only an Admin can change this.')}</span>}
            </p>
            {error && <FieldError>{error}</FieldError>}
            {canManage && (
              <Button
                variant={enabled ? 'outline' : 'primary'}
                disabled={mutation.isPending}
                onClick={() => { setError(undefined); mutation.mutate(!enabled); }}
              >
                {enabled ? t('admin.builtInRoles.turnOff', 'Turn off built-in roles') : t('admin.builtInRoles.turnOn', 'Turn on built-in roles')}
              </Button>
            )}
          </>
        )}
      </div>
    </section>
  );
};

export default OrgBuiltInRoles;
