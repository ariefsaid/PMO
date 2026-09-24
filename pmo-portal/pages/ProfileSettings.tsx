import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/src/auth/useAuth';
import { setMyLocalePreferences } from '@/src/lib/db/preferences';
import { SelectField, Button } from '@/src/components/ui';

type LangChoice = 'inherit' | 'id' | 'en';
type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

/** Map a stored profile.locale to the select's value. `inherit` (which the DAL stores as NULL)
 *  is the fallback for any value this slice does not recognise. */
function toChoice(locale: string | null | undefined): LangChoice {
  if (locale === 'id' || locale === 'en') return locale;
  return 'inherit';
}

/**
 * Personal profile language settings (RIS readiness slice). A signed-in user chooses their
 * interface-language override: inherit the organization default (stored NULL), Bahasa Indonesia
 * (`id`), or English (`en`). On save it writes ONLY the caller's own profile via the
 * RLS-authoritative `setMyLocalePreferences` DAL, passes the existing number-locale/timezone
 * values through VERBATIM (this slice must not reset or alter them), then awaits
 * `refreshCurrentUser()` so the provider's `currentUser` — and therefore UI text, formatting, and
 * `<html lang>` — update in the same session. Success is claimed only after that refresh returns
 * `{ error: null }`; a rejected write or refresh renders an assertive error and keeps the chosen
 * value retryable.
 */
export const ProfileSettings: React.FC = () => {
  const { t } = useTranslation();
  const { currentUser, refreshCurrentUser } = useAuth();
  const [choice, setChoice] = useState<LangChoice>(toChoice(currentUser?.locale));
  const [status, setStatus] = useState<SaveStatus>('idle');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Re-sync the SELECTION from the profile whenever its locale changes (e.g. after a successful
  // save refresh, the stored choice becomes the source of truth). Deliberately does NOT reset the
  // save status here: the identical locale change is what marks the save SUCCESSFUL, so wiping the
  // status would erase the very confirmation the save just earned.
  const userLocale = currentUser?.locale ?? null;
  useEffect(() => {
    setChoice(toChoice(userLocale));
  }, [userLocale]);

  if (!currentUser) {
    return (
      <div className="mx-auto w-full max-w-2xl px-4 py-8 sm:px-6">
        <p className="text-[13.5px] text-muted-foreground">
          {t('profileSettings.loading', 'Loading profile…')}
        </p>
      </div>
    );
  }

  const isSaving = status === 'saving';

  const options = [
    { value: 'inherit', label: t('profileSettings.language.options.inherit', 'Organization default') },
    { value: 'id', label: t('profileSettings.language.options.id', 'Bahasa Indonesia') },
    { value: 'en', label: t('profileSettings.language.options.en', 'English') },
  ];

  const handleSave = async () => {
    if (isSaving) return;
    setStatus('saving');
    setErrorMsg(null);
    // Only `inherit` maps to NULL; the explicit choices are stored as-is.
    const locale = choice === 'inherit' ? null : choice;
    try {
      // The id filter is NOT the authorization — the restrictive RLS policy
      // (`profiles_locale_self_only`) is. We only ever write the signed-in user's own profile.
      await setMyLocalePreferences(currentUser.id, {
        locale,
        numberLocale: currentUser.number_locale,
        timezone: currentUser.timezone,
      });
    } catch (e) {
      setErrorMsg(
        e instanceof Error ? e.message : t('profileSettings.error', 'Could not save your preference. Please try again.')
      );
      setStatus('error');
      return;
    }
    const { error } = await refreshCurrentUser();
    if (error) {
      setErrorMsg(error);
      setStatus('error');
      return;
    }
    setStatus('saved');
  };

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-6 sm:px-6">
      <div className="rounded-lg border border-border bg-card p-4 shadow-sm sm:p-6">
        <h1 className="text-xl font-bold tracking-[-0.01em] text-foreground">
          {t('profileSettings.title', 'Profile settings')}
        </h1>
        <p className="mt-1 text-[13.5px] leading-[1.5] text-muted-foreground">
          {t(
            'profileSettings.description',
            'Choose the language used for buttons, labels, and messages in this portal.'
          )}
        </p>

        <div className="mt-5 max-w-md">
          <SelectField
            label={t('profileSettings.language.label', 'Interface language')}
            value={choice}
            onChange={(v) => {
              setChoice(v as LangChoice);
              setStatus('idle');
              setErrorMsg(null);
            }}
            options={options}
            helper={t(
              'profileSettings.language.help',
              'Saved to your profile and applied across devices.'
            )}
            disabled={isSaving}
            fullWidth
          />
          {choice === 'inherit' && (
            <p className="mt-2 text-[12px] leading-[1.5] text-muted-foreground">
              {t(
                'profileSettings.language.inheritHint',
                'Organization default follows your organization’s setting. Choose a language below to override it.'
              )}
            </p>
          )}
        </div>

        <div className="mt-6">
          <Button
            type="button"
            variant="primary"
            onClick={handleSave}
            disabled={isSaving}
            loading={isSaving}
          >
            {t('profileSettings.save', 'Save')}
          </Button>
        </div>

        {status === 'saving' && (
          <p role="status" className="mt-3 text-[13px] text-muted-foreground">
            {t('profileSettings.saving', 'Saving your preference…')}
          </p>
        )}
        {status === 'saved' && (
          <p role="status" className="mt-3 text-[13px] font-medium text-foreground">
            {t('profileSettings.saved', 'Preferences saved')}
          </p>
        )}
        {status === 'error' && errorMsg && (
          <p role="alert" className="mt-3 text-[13px] font-medium text-destructive-text">
            {errorMsg}
          </p>
        )}
      </div>
    </div>
  );
};

export default ProfileSettings;