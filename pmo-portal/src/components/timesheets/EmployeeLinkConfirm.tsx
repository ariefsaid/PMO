import React, { useCallback, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Combobox, ConfirmDialog } from '@/src/components/ui';
import type { ComboboxOption } from '@/src/components/ui';
import type { ProposedEmployeeLink } from '@/src/lib/db/timesheetPush';
import { employeeChoiceLabels } from './employeeChoiceLabels';

export interface EmployeeProfileOption {
  value: string;
  label: string;
  email?: string;
}

export interface EmployeeLinkConfirmProps {
  links: ProposedEmployeeLink[];
  /** ADR-0016 UX gate result — `can('confirm_employee_link', 'employeeLink', ctx)` (Admin only). The
   *  RPC (`confirm_erp_employee_link`) is the real authority regardless of this flag. */
  canConfirm: boolean;
  onConfirm: (link: ProposedEmployeeLink) => Promise<void> | void;
  /** Active, same-org choices supplied by the read-only review queue. */
  profileOptions?: EmployeeProfileOption[];
  /** the `erp_employees.id` currently being confirmed (mutation in flight) — disables its row. */
  confirmingId?: string | null;
}

/**
 * P3b (OQ-TSP-10(C) — the owner ruling) — the Employee-adopt-link Admin queue. A link the adopt probe
 * PROPOSED on a unique work-email match is NEVER auto-confirmed: re-pointing which PMO user a week of
 * ERP hours is attributed to is an identity decision, so it goes through an explicit `ConfirmDialog`
 * step, never a single click.
 *
 * ⚑ C-6 / C-7 (rendered Discover pass, 2026-07-22) — AND THE DECISION NAMES BOTH PARTIES, OR IS NOT
 * OFFERED. The paragraph above was true and the screen still made the decision impossible to make
 * responsibly: the dialog said the hours would go "to the matched PMO user" and never named that user
 * (`profile_id` was on the row, unused), while `Confirm` was offered on rows that identified nobody at
 * all (`Unknown employee` / `No email`) even though `employee_number` — the one stable identifier —
 * was fetched and never displayed. An Admin could re-point a week of someone's cost with zero
 * identifying facts on screen. Both ends are now named, and an unidentifiable end withholds the
 * decision rather than dressing it up.
 */

/** The ERP side is identifiable if ANY of its three identifying facts is present. */
const erpIdentity = (l: ProposedEmployeeLink): string | null =>
  [l.employee_name, l.employee_number, l.work_email]
    .map((value) => value?.trim() ?? '')
    .find((value): value is string => Boolean(value)) ?? null;

/** The PMO side is identifiable only if the destination profile is actually resolvable. */
const pmoIdentity = (l: ProposedEmployeeLink): string | null =>
  l.profile_id
    ? [l.profile_name, l.profile_email]
      .map((value) => value?.trim() ?? '')
      .find((value): value is string => Boolean(value)) ?? null
    : null;

const isDecidable = (l: ProposedEmployeeLink): boolean =>
  erpIdentity(l) !== null && pmoIdentity(l) !== null;

const profileName = (option: EmployeeProfileOption): string => {
  const emailSuffix = option.email ? ` · ${option.email}` : '';
  return emailSuffix && option.label.endsWith(emailSuffix)
    ? option.label.slice(0, -emailSuffix.length)
    : option.label;
};

interface PendingConfirmation {
  link: ProposedEmployeeLink;
  profileId: string | null;
  selectedProfile: EmployeeProfileOption | null;
  requiresActiveProfile: boolean;
}

/**
 * ⚑ NEW-7 / NEW-8 — the supporting facts, MINUS whatever is already the headline.
 *
 * `erpIdentity` falls back name → number → email, so on a record with no name the headline IS the
 * employee number — and both the card's detail line and the dialog's parenthetical then repeated it,
 * rendering "ERP employee HR-EMP-00112 (HR-EMP-00112)". On an irreversible attribution decision a
 * duplicated identifier reads as a bug in the very fact the operator is being asked to trust. The
 * disambiguator is still shown whenever it disambiguates anything.
 */
const erpSupportingFacts = (l: ProposedEmployeeLink): string[] => {
  const headline = erpIdentity(l);
  return [l.employee_number, l.work_email]
    .map((value) => value?.trim() ?? '')
    .filter((value): value is string => Boolean(value) && value !== headline);
};

export const EmployeeLinkConfirm: React.FC<EmployeeLinkConfirmProps> = ({
  links,
  canConfirm,
  onConfirm,
  profileOptions,
  confirmingId = null,
}) => {
  const { t } = useTranslation();
  const [pending, setPending] = useState<PendingConfirmation | null>(null);
  const [selectedProfileIds, setSelectedProfileIds] = useState<Record<string, string>>({});
  const [saveError, setSaveError] = useState(false);
  const [savingId, setSavingId] = useState<string | null>(null);
  const savingRef = useRef(false);
  const comboboxOptions = useMemo<ComboboxOption[]>(
    () => employeeChoiceLabels((profileOptions ?? []).map((option) => ({
      value: option.value,
      name: profileName(option),
      email: option.email,
    }))),
    [profileOptions],
  );
  const activeProfilesById = useMemo(
    () => new Map((profileOptions ?? []).map((option) => [option.value, option])),
    [profileOptions],
  );
  const loadProfileOptions = useCallback(async () => comboboxOptions, [comboboxOptions]);

  const openConfirmation = (link: ProposedEmployeeLink, profileId: string | null, requiresActiveProfile: boolean) => {
    setSaveError(false);
    setPending({
      link,
      profileId,
      selectedProfile: profileId ? activeProfilesById.get(profileId) ?? null : null,
      requiresActiveProfile,
    });
  };

  const confirmPending = async () => {
    if (!pending || savingRef.current) return;

    let confirmedLink = pending.link;
    if (pending.profileId) {
      const selected = activeProfilesById.get(pending.profileId);
      if (!selected) return;
      confirmedLink = {
        ...pending.link,
        profile_id: selected.value,
        profile_name: profileName(selected),
        profile_email: selected.email ?? null,
      };
    } else if (!isDecidable(pending.link)) {
      return;
    }

    savingRef.current = true;
    setSavingId(pending.link.id);
    setSaveError(false);
    try {
      await onConfirm(confirmedLink);
      setPending(null);
    } catch {
      setSaveError(true);
    } finally {
      savingRef.current = false;
      setSavingId(null);
    }
  };

  const pendingLink = pending?.link ?? null;
  const pendingActiveProfile = pending?.profileId ? activeProfilesById.get(pending.profileId) : undefined;
  const pendingSelected = pendingActiveProfile ?? pending?.selectedProfile ?? undefined;
  const pendingDestination = pending
    ? pending.profileId
      ? pendingSelected ? profileName(pendingSelected) : null
      : pmoIdentity(pending.link)
    : null;
  const staleSelection = Boolean(
    pending?.requiresActiveProfile && (!pendingActiveProfile || profileOptions === undefined),
  );
  const pendingCanConfirm = Boolean(
    pendingLink && erpIdentity(pendingLink) !== null && pendingDestination !== null && !staleSelection,
  );

  if (links.length === 0) return null;

  return (
    <div className="space-y-2">
      {links.map((link) => {
        const erp = erpIdentity(link);
        const needsProfileChoice = profileOptions !== undefined;
        const selectedProfileId = selectedProfileIds[link.id] ?? (needsProfileChoice ? link.profile_id : null);
        const selectedProfile = selectedProfileId ? activeProfilesById.get(selectedProfileId) : undefined;
        const pmo = needsProfileChoice
          ? selectedProfile ? profileName(selectedProfile) : null
          : pmoIdentity(link);
        const decidable = erp !== null && pmo !== null;
        return (
          <div
            key={link.id}
            className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-card px-3 py-2.5"
          >
            <div className="min-w-0">
              {/* C-7: the ERP side — name if known, else the stable employee number, else the email. */}
              <div className="text-sm font-medium">{link.employee_name?.trim() || erp || 'Unidentified ERP employee'}</div>
              <div className="mt-0.5 text-[12px] text-muted-foreground">
                {erpSupportingFacts(link).join(' · ') || 'No further identifying details on record'}
              </div>
              {/* C-6: the DESTINATION. This is what the confirm actually decides, so it is stated on the
                  card, not only in the dialog. */}
              <div className="mt-1 text-[12px]">
                {pmo ? (
                  <>
                    <span className="text-muted-foreground">
                      {t('approvals.employeeLinks.uxs30.destination', 'Hours would be attributed to {{profile}}', { profile: pmo })}
                    </span>
                  </>
                ) : (
                  <span className="text-muted-foreground">
                    {needsProfileChoice
                      ? (profileOptions?.length ?? 0) === 0
                        ? t('approvals.employeeLinks.uxs30.noActiveProfiles', 'No active PMO profiles are available.')
                        : t('approvals.employeeLinks.uxs30.chooseProfile', 'Choose an active PMO profile to attribute hours to.')
                      : 'No PMO user is matched to this employee.'}
                  </span>
                )}
              </div>
              {canConfirm && needsProfileChoice && (profileOptions?.length ?? 0) > 0 && erp !== null && (
                <div className="mt-2 max-w-sm">
                  <Combobox
                    label={t('approvals.employeeLinks.uxs30.profileLabel', 'PMO user to attribute hours to')}
                    value={selectedProfile?.value ?? null}
                    selectedOption={selectedProfile ? { value: selectedProfile.value, label: selectedProfile.label } : null}
                    onChange={(value) => setSelectedProfileIds((current) => ({ ...current, [link.id]: value }))}
                    loadOptions={loadProfileOptions}
                    placeholder={t('approvals.employeeLinks.uxs30.profilePlaceholder', 'Select a PMO profile')}
                    noun={t('approvals.employeeLinks.uxs30.profileNoun', 'PMO profile')}
                    searchPlaceholder={t('approvals.employeeLinks.uxs30.searchProfiles', 'Search active profiles')}
                  />
                </div>
              )}
              {link.link_proposed_reason && (
                <div className="mt-0.5 text-[12px] text-muted-foreground">{link.link_proposed_reason}</div>
              )}
              {/* An unidentifiable end is not a disabled button with no explanation — it is a stated
                  reason, because the operator's next act depends on WHICH end is missing. */}
              {!decidable && (!needsProfileChoice || erp === null) && (
                <div className="mt-1 text-[12px] text-muted-foreground">
                  This link cannot be confirmed:{' '}
                  {erp === null
                    ? 'the ERP record carries no name, employee number or work email, so there is nothing to confirm it against.'
                    : needsProfileChoice
                      ? (profileOptions?.length ?? 0) === 0
                        ? t('approvals.employeeLinks.uxs30.noActiveProfiles', 'No active PMO profiles are available.')
                        : t('approvals.employeeLinks.uxs30.chooseProfile', 'Choose an active PMO profile to attribute hours to.')
                      : 'no PMO user is matched to it yet.'}
                </div>
              )}
            </div>
            {canConfirm && decidable && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => openConfirmation(
                  link,
                  needsProfileChoice ? selectedProfile?.value ?? null : null,
                  needsProfileChoice,
                )}
                loading={confirmingId === link.id}
                disabled={confirmingId === link.id}
              >
                Confirm
              </Button>
            )}
          </div>
        );
      })}

      {pending && pendingLink && (
        <ConfirmDialog
          open
          tone="default"
          title={pendingDestination
            ? t('approvals.employeeLinks.uxs30.confirmTitle', "Attribute {{employee}}'s hours to {{profile}}?", {
              employee: erpIdentity(pendingLink),
              profile: pendingDestination,
            })
            : t('approvals.employeeLinks.uxs30.confirmTitleUnknown', 'Confirm employee link for {{employee}}?', {
              employee: erpIdentity(pendingLink) ?? t('approvals.employeeLinks.uxs30.unknownEmployee', 'this employee'),
            })}
          description={<>
            <span>{t(
              'approvals.employeeLinks.uxs30.confirmDescription',
              'ERP employee {{employee}}{{employeeNumber}} will have their ERP timesheet hours attributed to the PMO user {{profile}}{{profileEmail}} from now on. An ERP-side email change can never silently re-point a confirmed link.',
              {
                employee: erpIdentity(pendingLink),
                // NEW-7: only add the number when it adds something the headline does not already say.
                employeeNumber: pendingLink.employee_number?.trim()
                  && pendingLink.employee_number.trim() !== erpIdentity(pendingLink)
                  ? ` (${pendingLink.employee_number.trim()})`
                  : '',
                profile: pendingDestination ?? '',
                profileEmail: (pendingSelected?.email ?? pendingLink.profile_email)
                  ? ` (${pendingSelected?.email ?? pendingLink.profile_email})`
                  : '',
              },
            )}</span>
            {staleSelection && <>
              <div role="alert" className="mt-2 text-sm text-destructive">
                {t('approvals.employeeLinks.uxs30.staleProfile', 'The selected employee is no longer available. Choose another active employee before confirming.')}
              </div>
              {(profileOptions?.length ?? 0) > 0 && <div className="mt-2 max-w-sm">
                <Combobox
                  label={t('approvals.employeeLinks.uxs30.profileLabel', 'PMO user to attribute hours to')}
                  value={pendingActiveProfile?.value ?? null}
                  selectedOption={pendingActiveProfile
                    ? { value: pendingActiveProfile.value, label: pendingActiveProfile.label }
                    : null}
                  onChange={(value) => {
                    const selectedProfile = activeProfilesById.get(value) ?? null;
                    setSaveError(false);
                    setPending((current) => current ? {
                      ...current,
                      profileId: value,
                      selectedProfile,
                    } : current);
                    setSelectedProfileIds((current) => ({ ...current, [pendingLink.id]: value }));
                  }}
                  loadOptions={loadProfileOptions}
                  placeholder={t('approvals.employeeLinks.uxs30.profilePlaceholder', 'Select a PMO profile')}
                  noun={t('approvals.employeeLinks.uxs30.profileNoun', 'PMO profile')}
                  searchPlaceholder={t('approvals.employeeLinks.uxs30.searchProfiles', 'Search active profiles')}
                />
              </div>}
            </>}
            {saveError && !staleSelection && <div role="alert" className="mt-2 text-sm text-destructive">
              {t('approvals.employeeLinks.uxs30.saveFailure', "Couldn't confirm this employee link. The selected profile is still available; try again.")}
            </div>}
          </>}
          confirmLabel={t('approvals.employeeLinks.uxs30.confirmLabel', 'Confirm link')}
          loading={confirmingId === pendingLink.id || savingId === pendingLink.id}
          confirmDisabled={!pendingCanConfirm}
          onCancel={() => setPending(null)}
          onConfirm={() => { void confirmPending(); }}
        />
      )}
    </div>
  );
};
