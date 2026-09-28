import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/src/auth/useAuth';
import { profilePreferencesRepository } from '@/src/lib/repositories/profilePreferences';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import { useOrgLocaleDefaults, useResolvedLocale } from '@/src/hooks/useResolvedLocale';
import { resolveLocale } from '@/src/lib/locale/resolveLocale';
import { isValidTimeZone, listTimeZoneIds } from '@/src/lib/locale/timezones';
import { Button, Combobox, SelectField, type ComboboxOption } from '@/src/components/ui';

type LocaleChoice = 'inherit' | 'id' | 'en';
type NumberLocaleChoice = 'inherit' | 'id-ID' | 'en-US';
type TimezoneChoice = 'inherit' | string;
type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

function toLocaleChoice(locale: string | null | undefined): LocaleChoice {
  if (locale === 'id' || locale === 'en') return locale;
  return 'inherit';
}

function toNumberLocaleChoice(locale: string | null | undefined): NumberLocaleChoice {
  if (locale === 'id-ID' || locale === 'en-US') return locale;
  return 'inherit';
}

function toTimezoneChoice(timezone: string | null | undefined): TimezoneChoice {
  return timezone ?? 'inherit';
}

/**
 * Self-service display preferences for the signed-in user. NULL choices inherit organization
 * defaults; explicit choices remain explicit even when they currently match those defaults. The
 * three stored values are written together, then the signed-in profile is refreshed before success
 * is announced so the same-session formatters and language provider see the saved values.
 */
export const ProfileSettings: React.FC = () => {
  const { t } = useTranslation();
  const { currentUser, refreshCurrentUser } = useAuth();
  const resolvedLocale = useResolvedLocale();
  // What "Organization default" would give this user: the SAME resolver with the timezone
  // preference cleared. Not `resolvedLocale.timezone`, which is the user's own override when set.
  const inheritedTimezone = resolveLocale(
    { locale: null, numberLocale: null, timezone: null },
    useOrgLocaleDefaults(),
  ).timezone;
  const [languageChoice, setLanguageChoice] = useState<LocaleChoice>(toLocaleChoice(currentUser?.locale));
  const [numberChoice, setNumberChoice] = useState<NumberLocaleChoice>(
    toNumberLocaleChoice(currentUser?.number_locale),
  );
  const [timezoneChoice, setTimezoneChoice] = useState<TimezoneChoice>(toTimezoneChoice(currentUser?.timezone));
  const [status, setStatus] = useState<SaveStatus>('idle');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => setLanguageChoice(toLocaleChoice(currentUser?.locale)), [currentUser?.locale]);
  useEffect(() => setNumberChoice(toNumberLocaleChoice(currentUser?.number_locale)), [currentUser?.number_locale]);
  useEffect(() => setTimezoneChoice(toTimezoneChoice(currentUser?.timezone)), [currentUser?.timezone]);

  const timezoneOptions = useMemo<ComboboxOption[]>(() => {
    const inheritLabel = t('profileSettings.timezone.options.inherit', 'Organization default');
    return [
      {
        value: 'inherit',
        label: t('profileSettings.timezone.options.inheritWithEffective', {
          defaultValue: `${inheritLabel} — ${inheritedTimezone}`,
          timezone: inheritedTimezone,
        }),
      },
      ...listTimeZoneIds([inheritedTimezone, resolvedLocale.timezone, currentUser?.timezone ?? '']).map((timezone) => ({
        value: timezone,
        label: timezone,
      })),
    ];
  }, [currentUser?.timezone, inheritedTimezone, resolvedLocale.timezone, t]);
  const loadTimezoneOptions = useCallback(async () => timezoneOptions, [timezoneOptions]);
  const selectedTimezone = timezoneOptions.find((option) => option.value === timezoneChoice)
    ?? (timezoneChoice === 'inherit' ? null : { value: timezoneChoice, label: timezoneChoice });

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
  const languageOptions = [
    { value: 'inherit', label: t('profileSettings.language.options.inherit', 'Organization default') },
    { value: 'id', label: t('profileSettings.language.options.id', 'Bahasa Indonesia') },
    { value: 'en', label: t('profileSettings.language.options.en', 'English') },
  ];
  const numberOptions = [
    { value: 'inherit', label: t('profileSettings.number.options.inherit', 'Organization default') },
    { value: 'id-ID', label: t('profileSettings.number.options.id', 'Indonesian (1.234.567,89)') },
    { value: 'en-US', label: t('profileSettings.number.options.en', 'English (1,234,567.89)') },
  ];
  const effectiveLanguage = resolvedLocale.locale === 'id'
    ? t('profileSettings.language.options.id', 'Bahasa Indonesia')
    : t('profileSettings.language.options.en', 'English');
  const effectiveNumberFormat = resolvedLocale.numberLocale === 'id-ID'
    ? '1.234.567,89'
    : resolvedLocale.numberLocale === 'en-US'
      ? '1,234,567.89'
      : resolvedLocale.numberLocale;

  const resetStatus = () => {
    setStatus('idle');
    setErrorMsg(null);
  };

  const handleSave = async () => {
    if (isSaving) return;
    if (timezoneChoice !== 'inherit' && !isValidTimeZone(timezoneChoice)) {
      setErrorMsg(t('profileSettings.invalidTimezone', 'Choose a valid timezone before saving.'));
      setStatus('error');
      return;
    }

    setStatus('saving');
    setErrorMsg(null);
    const preferences = {
      locale: languageChoice === 'inherit' ? null : languageChoice,
      numberLocale: numberChoice === 'inherit' ? null : numberChoice,
      timezone: timezoneChoice === 'inherit' ? null : timezoneChoice,
    };
    try {
      await profilePreferencesRepository.setLocalePreferences(currentUser.id, preferences);
      const { error } = await refreshCurrentUser();
      if (error) throw new Error(error);
      setStatus('saved');
    } catch (error) {
      classifyMutationError(error);
      setErrorMsg(t('profileSettings.error', 'Could not save your preferences. Please try again.'));
      setStatus('error');
    }
  };

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-6 sm:px-6">
      <div className="rounded-lg border border-border bg-card p-4 shadow-sm sm:p-6">
        <h1 className="text-xl font-bold tracking-[-0.01em] text-foreground">
          {t('profileSettings.title', 'Profile & preferences')}
        </h1>
        <p className="mt-1 text-[13.5px] leading-[1.5] text-muted-foreground">
          {t(
            'profileSettings.description',
            'Choose your language, number format, and timezone for this portal.',
          )}
        </p>

        <div className="mt-5 grid grid-cols-1 gap-5 sm:grid-cols-2">
          <div>
            <SelectField
              label={t('profileSettings.language.label', 'Interface language')}
              value={languageChoice}
              onChange={(value) => {
                setLanguageChoice(value as LocaleChoice);
                resetStatus();
              }}
              options={languageOptions}
              helper={t('profileSettings.language.help', 'Saved to your profile and applied across devices.')}
              disabled={isSaving}
              fullWidth
            />
            <p className="mt-2 text-[12px] leading-[1.5] text-muted-foreground">
              {t('profileSettings.language.effective', { defaultValue: 'Effective language: {{value}}', value: effectiveLanguage })}
            </p>
          </div>

          <div>
            <SelectField
              label={t('profileSettings.number.label', 'Number format')}
              value={numberChoice}
              onChange={(value) => {
                setNumberChoice(value as NumberLocaleChoice);
                resetStatus();
              }}
              options={numberOptions}
              helper={t('profileSettings.number.help', { defaultValue: 'Preview: {{value}}', value: effectiveNumberFormat })}
              disabled={isSaving}
              fullWidth
            />
            <p className="mt-2 text-[12px] leading-[1.5] text-muted-foreground">
              {t('profileSettings.number.effective', { defaultValue: 'Effective number format: {{value}}', value: effectiveNumberFormat })}
            </p>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[12px] tabular-nums text-muted-foreground">
              <span>
                <span className="sr-only">{t('profileSettings.number.options.idLabel', 'Indonesian: ')}</span>
                <span>1.234.567,89</span>
              </span>
              <span>
                <span className="sr-only">{t('profileSettings.number.options.enLabel', 'English: ')}</span>
                <span>1,234,567.89</span>
              </span>
            </div>
          </div>

          <div className="sm:col-span-2">
            <Combobox
              label={t('profileSettings.timezone.label', 'Timezone')}
              value={timezoneChoice}
              selectedOption={selectedTimezone}
              onChange={(value) => {
                setTimezoneChoice(value);
                resetStatus();
              }}
              loadOptions={loadTimezoneOptions}
              placeholder={t('profileSettings.timezone.placeholder', 'Select a timezone')}
              searchPlaceholder={t('profileSettings.timezone.search', 'Search timezones…')}
              noun={t('profileSettings.timezone.noun', 'timezone')}
              disabled={isSaving}
            />
            <p className="mt-2 text-[12px] leading-[1.5] text-muted-foreground">
              {t('profileSettings.timezone.effective', { defaultValue: 'Effective timezone: {{value}}', value: resolvedLocale.timezone })}
            </p>
          </div>
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
            {t('profileSettings.saving', 'Saving your preferences…')}
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
