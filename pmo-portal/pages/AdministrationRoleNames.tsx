import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { usePermission } from '@/src/auth/usePermission';
import { Button, Card, ListState, TextField, useToast } from '@/src/components/ui';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import { BUILT_IN_ROLES, type BuiltInRole } from '@/src/auth/builtInRoles';
import { ROLE_NAME_LOCALES, ROLE_NAME_MAX, resetOrgRoleName, saveOrgRoleName, validateRoleName, type RoleNameLocale } from '@/src/lib/db/orgRoleNames';
import { ORG_ROLE_NAMES_KEY, useOrgRoleNames } from '@/src/hooks/useOrgRoleNames';

/**
 * Administration › Terminology › Role names (#2712). The Admin renames each of the 28 built-in roles in English and
 * Bahasa Indonesia. Display only: the role key, access level and stored data never change. The default shown beside each
 * field comes from the catalogue, never from the override. RLS is the write authority (ADR-0016).
 */
const LOCALE_NAME: Record<RoleNameLocale, string> = { en: 'English', id: 'Bahasa Indonesia' };

const RoleNameRow: React.FC<{ role: BuiltInRole; locale: RoleNameLocale; current?: string }> = ({ role, locale, current }) => {
  const { t } = useTranslation();
  const { toast } = useToast();
  const canEdit = usePermission()('edit', 'user');
  const qc = useQueryClient();
  const fallback = locale === 'id' ? role.nameId : role.nameEn;
  const [name, setName] = useState(current ?? '');
  useEffect(() => setName(current ?? ''), [current]);
  const refresh = () => qc.invalidateQueries({ queryKey: ORG_ROLE_NAMES_KEY });
  const save = useMutation({
    mutationFn: () => saveOrgRoleName({ roleKey: role.key, locale, name }),
    onSuccess: () => {
      toast(t('administration:roleNames.saved', 'Role name saved'), 'success');
      return refresh();
    },
    onError: (e) => toast(classifyMutationError(e).headline, 'error'),
  });
  const reset = useMutation({
    mutationFn: () => resetOrgRoleName(role.key, locale),
    onSuccess: () => {
      toast(t('administration:roleNames.resetDone', 'Back to the default name'), 'success');
      return refresh();
    },
    onError: (e) => toast(classifyMutationError(e).headline, 'error'),
  });
  const invalid = name.trim() !== '' && validateRoleName({ roleKey: role.key, locale, name }) !== null;
  const dirty = name !== (current ?? '');
  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-[10rem_1fr_auto] sm:items-end" data-testid={`role-name-row-${role.key}-${locale}`}>
      <div className="text-sm text-text-secondary">
        {LOCALE_NAME[locale]} · {t('administration:terminology.default', 'Default')}: {fallback}
      </div>
      <TextField
        label={t('administration:roleNames.name', 'Name')}
        disabled={!canEdit}
        value={name}
        placeholder={fallback}
        maxLength={ROLE_NAME_MAX}
        onChange={setName}
        fullWidth
      />
      {canEdit && (
        <div className="flex gap-2">
          <Button variant="primary" disabled={!dirty || name.trim() === '' || invalid || save.isPending} onClick={() => save.mutate()}>
            {t('administration:terminology.save', 'Save')}
          </Button>
          <Button variant="outline" disabled={current === undefined || reset.isPending} onClick={() => reset.mutate()}>
            {t('administration:terminology.reset', 'Reset')}
          </Button>
        </div>
      )}
    </div>
  );
};

const AdministrationRoleNames: React.FC = () => {
  const { t } = useTranslation();
  const { data, isLoading, isError, refetch } = useOrgRoleNames();
  return (
    <section className="min-w-0 space-y-4" data-testid="administration-role-names">
      <h2 className="text-lg font-semibold">{t('administration:roleNames.title', 'Role names')}</h2>
      <p className="text-sm text-text-secondary">
        {t('administration:roleNames.intro', 'Rename the built-in roles to match your organisation. Only the displayed name changes; what each role can do stays the same.')}
      </p>
      {isLoading ? <ListState variant="loading" /> : null}
      {isError ? <ListState variant="error" onRetry={() => void refetch()} /> : null}
      {!isLoading && !isError
        ? BUILT_IN_ROLES.map((role) => (
            <Card key={role.key} className="space-y-3 p-4" data-testid={`role-name-card-${role.key}`}>
              <h3 className="text-base font-semibold">{role.nameEn}</h3>
              {ROLE_NAME_LOCALES.map((locale) => (
                <RoleNameRow key={locale} role={role} locale={locale} current={data?.[locale]?.[role.key]} />
              ))}
            </Card>
          ))
        : null}
    </section>
  );
};

export default AdministrationRoleNames;
