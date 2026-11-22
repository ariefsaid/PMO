import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { fieldLoginLink } from '@/src/lib/db/adminUsers';
import { isLightRoleKey } from '@/src/auth/lightAccount';

/** A Foreman or Field user can clock in only as a person placed in a crew; the form says so while the role is being given. */
export const FieldLoginFlag: React.FC<{ userId: string; roleKey: string | null }> = ({ userId, roleKey }) => {
  const { t } = useTranslation('administration');
  const light = isLightRoleKey(roleKey);
  const q = useQuery({ queryKey: ['field-login-link', userId], queryFn: () => fieldLoginLink(userId), enabled: light, retry: false });
  if (!light || !q.data || q.data === 'ok') return null;
  return (
    <p role="status" className="text-control text-foreground" data-testid="field-login-flag">
      {q.data === 'no_person'
        ? t('admin.users.fieldLogin.noPerson', 'This login is not in the workforce list, so it cannot clock in. Add this person to the workforce list, then place them in a crew.')
        : t('admin.users.fieldLogin.noCrew', 'This person is not in any crew, so the clock-in shows nothing. Place them in a crew (a Foreman: set them as the crew lead).')}
    </p>
  );
};
