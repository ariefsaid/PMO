import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/src/auth/useAuth';
import { useTextSize, type TextSize } from '@/src/hooks/useTextSize';
import { useHomeLayout, type HomeLayout } from '@/src/hooks/useHomeLayout';
import { profilePreferencesRepository } from '@/src/lib/repositories/profilePreferences';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import { useOrgLocaleDefaults, useResolvedLocale } from '@/src/hooks/useResolvedLocale';
import { resolveLocale } from '@/src/lib/locale/resolveLocale';
import { isValidTimeZone, listTimeZoneIds } from '@/src/lib/locale/timezones';
import { formatMoneyInputValue } from '@/src/lib/format';
import { Button, Combobox, ConfirmDialog, PageHeader, SelectField, type ComboboxOption } from '@/src/components/ui';
import { useUnsavedChangesGuard } from '@/src/hooks/useUnsavedChangesGuard';

type LocaleChoice = 'inherit' | 'id' | 'en';
type NumberLocaleChoice = 'inherit' | 'id-ID' | 'en-US';
type TimezoneChoice = 'inherit' | string;
/** `stale` = the write landed but the session refresh failed — saved, not errored. */
type SaveStatus = 'idle' | 'saving' | 'saved' | 'stale' | 'error';

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

const NUMBER_EXAMPLE = 1234567.89;

/** The number convention shown as its own example (`1.234.567,89`), never as a bare tag like `id`. */
function numberExample(numberLocale: string): string {
  return formatMoneyInputValue(NUMBER_EXAMPLE, numberLocale);
}

/**
 * Self-service display preferences for the signed-in user. NULL choices inherit organization
 * defaults; explicit choices remain explicit even when they currently match those defaults. The
 * three stored values are written together, then the signed-in profile is refreshed before success
 * is announced so the same-session formatters and language provider see the saved values.
 */
const ProfileSettings: React.FC = () => {
  const { t } = useTranslation();
  const { textSize, setTextSize } = useTextSize();
  const { homeLayout, setHomeLayout } = useHomeLayout();
  const { currentUser, refreshCurrentUser } = useAuth();
  const resolvedLocale = useResolvedLocale();
  const orgDefaults = useOrgLocaleDefaults();
  const [languageChoice, setLanguageChoice] = useState<LocaleChoice>(toLocaleChoice(currentUser?.locale));
  const [numberChoice, setNumberChoice] = useState<NumberLocaleChoice>(
    toNumberLocaleChoice(currentUser?.number_locale),
  );
  const [timezoneChoice, setTimezoneChoice] = useState<TimezoneChoice>(toTimezoneChoice(currentUser?.timezone));
  const [savedPreferences, setSavedPreferences] = useState(() => ({
    language: toLocaleChoice(currentUser?.locale),
    number: toNumberLocaleChoice(currentUser?.number_locale),
    timezone: toTimezoneChoice(currentUser?.timezone),
  }));
  const [pendingLeave, setPendingLeave] = useState<{ leave: () => void; stay: () => void } | null>(null);
  const [status, setStatus] = useState<SaveStatus>('idle');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [refreshBusy, setRefreshBusy] = useState(false);

  useEffect(() => {
    const next = {
      language: toLocaleChoice(currentUser?.locale),
      number: toNumberLocaleChoice(currentUser?.number_locale),
      timezone: toTimezoneChoice(currentUser?.timezone),
    };
    setLanguageChoice(next.language);
    setNumberChoice(next.number);
    setTimezoneChoice(next.timezone);
    setSavedPreferences(next);
  }, [currentUser?.locale, currentUser?.number_locale, currentUser?.timezone]);
  const dirty = languageChoice !== savedPreferences.language || numberChoice !== savedPreferences.number || timezoneChoice !== savedPreferences.timezone;
  const holdLeave = useCallback((leave: () => void, stay: () => void) => setPendingLeave({ leave, stay }), []);
  const guardLeave = useUnsavedChangesGuard({ dirty, guardHistory: true, onBlocked: holdLeave });

  // What each "Organization default" would give this user: the SAME resolver with that preference
  // cleared — never `resolvedLocale`, which carries the user's own override when one is set. The
  // number default derives from the language when the org sets none, so it follows the pending
  // language choice (what saving now would actually produce).
  const inherited = resolveLocale({ locale: null, numberLocale: null, timezone: null }, orgDefaults);
  const inheritedTimezone = inherited.timezone;
  const inheritedNumberLocale = resolveLocale(
    { locale: languageChoice === 'inherit' ? null : languageChoice, numberLocale: null, timezone: null },
    orgDefaults,
  ).numberLocale;

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
        <p className="text-control text-muted-foreground">
          {t('profileSettings.loading', 'Loading profile…')}
        </p>
      </div>
    );
  }

  const isSaving = status === 'saving';
  const languageName = (locale: string) => (locale === 'id'
    ? t('profileSettings.language.options.id', 'Bahasa Indonesia')
    : locale === 'en'
      ? t('profileSettings.language.options.en', 'English')
      : locale);
  const languageInheritLabel = t('profileSettings.language.options.inherit', 'Organization default');
  const inheritedLanguageName = languageName(inherited.locale);
  const numberInheritLabel = t('profileSettings.number.options.inherit', 'Organization default');
  const inheritedNumberFormat = numberExample(inheritedNumberLocale);
  const languageOptions = [
    {
      value: 'inherit',
      label: t('profileSettings.language.options.inheritWithEffective', {
        defaultValue: `${languageInheritLabel} — ${inheritedLanguageName}`,
        value: inheritedLanguageName,
      }),
    },
    { value: 'id', label: t('profileSettings.language.options.id', 'Bahasa Indonesia') },
    { value: 'en', label: t('profileSettings.language.options.en', 'English') },
  ];
  const numberOptions = [
    {
      value: 'inherit',
      label: t('profileSettings.number.options.inheritWithEffective', {
        defaultValue: `${numberInheritLabel} — ${inheritedNumberFormat}`,
        value: inheritedNumberFormat,
      }),
    },
    { value: 'id-ID', label: t('profileSettings.number.options.id', 'Indonesian (1.234.567,89)') },
    { value: 'en-US', label: t('profileSettings.number.options.en', 'English (1,234,567.89)') },
  ];
  // #684: the preview reflects what SAVING NOW would produce (the pending selection), never the
  // still-in-effect saved value — otherwise picking a new convention shows no visible feedback
  // until after Save + refresh.
  const previewNumberLocale = numberChoice === 'inherit' ? inheritedNumberLocale : numberChoice;
  const previewNumberFormat = numberExample(previewNumberLocale);

  const resetStatus = () => {
    setStatus('idle');
    setErrorMsg(null);
  };

  // Re-run only the session refresh after a successful write: the preferences are already
  // stored, so this retry never re-writes them.
  const retryProfileRefresh = async () => {
    if (refreshBusy) return;
    setRefreshBusy(true);
    const { error } = await refreshCurrentUser();
    setRefreshBusy(false);
    if (!error) setStatus('saved');
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
    const saved = { language: languageChoice, number: numberChoice, timezone: timezoneChoice };
    try {
      await profilePreferencesRepository.setLocalePreferences(currentUser.id, preferences);
    } catch (error) {
      classifyMutationError(error);
      setErrorMsg(t('profileSettings.error', 'Could not save your preferences. Please try again.'));
      setStatus('error');
      return;
    }
    setSavedPreferences(saved);
    // The write LANDED. Refreshing the signed-in profile is a separate step: when it fails the
    // preferences are still stored (they apply on the next session), so that outcome is reported
    // as saved-with-stale-session — never as a failed save — with a scoped refresh retry.
    const { error: refreshError } = await refreshCurrentUser();
    if (refreshError) {
      setStatus('stale');
      return;
    }
    setStatus('saved');
  };

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-6 sm:px-6">
      <PageHeader title={t('profileSettings.title', 'Profile & preferences')} />
      <div className="rounded-lg border border-border bg-card p-4 sm:p-6">
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          <div>
            <SelectField
              label={t('profileSettings.language.label', 'Interface language')}
              value={languageChoice}
              onChange={(value) => {
                setLanguageChoice(value as LocaleChoice);
                resetStatus();
              }}
              options={languageOptions}
              disabled={isSaving}
              fullWidth
            />
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
              helper={t('profileSettings.number.help', { defaultValue: 'Preview: {{value}}', value: previewNumberFormat })}
              disabled={isSaving}
              fullWidth
            />
          </div>

          <div>
            <SelectField label={t('profilePreferences:textSize.label', 'Text size')}
              value={textSize} onChange={(value) => setTextSize(value as TextSize)}
              options={[
                { value: 'default', label: t('profilePreferences:textSize.default', 'Default') },
                { value: 'large', label: t('profilePreferences:textSize.large', 'Large') },
                { value: 'larger', label: t('profilePreferences:textSize.larger', 'Larger') },
              ]}
              helper={t('profilePreferences:textSize.help', 'Applied immediately on this device.')} fullWidth />
          </div>

          <div>
            <SelectField label={t('profilePreferences:homeLayout.label', 'Home layout')}
              value={homeLayout} onChange={(value) => setHomeLayout(value as HomeLayout)}
              options={[
                { value: 'overview', label: t('profilePreferences:homeLayout.overview', 'Overview') },
                { value: 'focused', label: t('profilePreferences:homeLayout.focused', 'Focused') },
              ]}
              helper={t('profilePreferences:homeLayout.help', 'Applied immediately on this device.')} fullWidth />
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
          <p role="status" className="mt-3 text-control text-muted-foreground">
            {t('profileSettings.saving', 'Saving your preferences…')}
          </p>
        )}
        {status === 'saved' && (
          <p role="status" className="mt-3 text-control font-medium text-foreground">
            {t('profileSettings.saved', 'Preferences saved')}
          </p>
        )}
        {status === 'stale' && (
          <div className="mt-3 space-y-2">
            <p role="status" className="text-control font-medium text-foreground">
              {t('profileSettings.saved', 'Preferences saved')}
            </p>
            <p role="alert" className="text-control leading-[1.5] text-muted-foreground">
              {t(
                'profileSettings.staleRefresh',
                'Refreshing this session failed — your choices are stored and will apply on your next sign-in.',
              )}
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              loading={refreshBusy}
              onClick={() => void retryProfileRefresh()}
            >
              {t('profileSettings.refreshRetry', 'Retry refresh')}
            </Button>
          </div>
        )}
        {status === 'error' && errorMsg && (
          <p role="alert" className="mt-3 text-control font-medium text-destructive-text">
            {errorMsg}
          </p>
        )}
      </div>
      <ConfirmDialog
        open={pendingLeave !== null}
        tone="default"
        title={t('entityForm.discardTitle', 'Discard your changes?')}
        description={t('entityForm.discardBody', 'This form has unsaved changes. Discarding will lose them.')}
        confirmLabel={t('entityForm.discard', 'Discard')}
        cancelLabel={t('entityForm.keepEditing', 'Keep editing')}
        onConfirm={() => { const pending = pendingLeave; setPendingLeave(null); pending?.leave(); }}
        onCancel={() => { const pending = pendingLeave; setPendingLeave(null); pending?.stay(); }}
      />
    </div>
  );
};

export default ProfileSettings;
