import React from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { StatusPill, useToast } from '@/src/components/ui';
import { repositories } from '@/src/lib/repositories';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import { useOrgFeatures } from '@/src/hooks/useOrgFeatures';
import {
  FEATURE_KEYS,
  FEATURE_KEYS_TOGGLEABLE,
  FEATURE_LABELS,
  FEATURE_ENV_DEFAULT,
  CORE_FEATURES,
  type OrgFeatureKey,
  type EntitleableKey,
} from '@/src/lib/features';
import { cn } from '@/src/components/ui/cn';

/**
 * Administration › Features section (ops-admin-surface S6, FR-ENT-008, AC-ENT-004).
 *
 * Lists the gatable per-org entitlement keys (`FEATURE_KEYS`) plus the always-on core set
 * (`CORE_FEATURES`). The Operator sees real `<button role="switch" aria-checked>` controls that
 * call `operator_toggle_feature` via the repository seam; a non-Operator org-Admin sees the same
 * list as read-only text + a status pill ("Included in your plan" / "Hidden"). Core modules are
 * always-on and never toggleable by anyone (FR-ENT-007, AC-ENT-002) — rendered as locked-on.
 *
 * UX-only (ADR-0049): a toggle hides a module's affordances/routes (`useFeature`/`<FeatureGate>`);
 * it does NOT server-enforce the module's tables/RPCs yet. A stored row overrides the env default;
 * absence falls back to the env default (FR-ENT-004 absence = included).
 *
 * Error mapping: a `core_not_gated` rejection (errcode `P0001`) → "Core modules can't be disabled"
 * toast; a non-Operator denial (`42501`) → the shared permission toast.
 */

export interface AdministrationFeaturesProps {
  /** Clarity projection only (ADR-0016/0019) — the RPC re-asserts Operator server-side. */
  isOperator: boolean;
  /** The org whose features are being managed (the Operator's selected org or the caller's own). */
  orgId: string;
}

const TRACK_STYLE =
  'relative inline-flex h-[22px] w-[40px] shrink-0 items-center rounded-full transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring';
const THUMB_STYLE =
  'pointer-events-none block size-[16px] translate-x-[3px] rounded-full bg-white shadow-sm transition-transform';

export const AdministrationFeatures: React.FC<AdministrationFeaturesProps> = ({
  isOperator,
  orgId,
}) => {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data: orgFeatures } = useOrgFeatures();

  const toggleMutation = useMutation({
    mutationFn: (args: { orgId: string; key: OrgFeatureKey; enabled: boolean }) =>
      repositories.orgFeature.toggle(args),
    onSuccess: () => {
      // Invalidate the entitlement map so the rail/routes/useFeature re-resolve on next render.
      qc.invalidateQueries({ queryKey: ['orgFeatures'] });
    },
    onError: (err: unknown) => {
      const { headline, detail } = classifyMutationError(err, {
        P0001: "Core modules can't be disabled.",
      });
      toast(headline, detail, 'warning');
    },
  });

  /** Resolve a gatable key: a stored row overrides the env default (FR-ENT-004). */
  const resolve = (key: OrgFeatureKey): boolean => orgFeatures?.[key] ?? FEATURE_ENV_DEFAULT[key];

  const handleToggle = (key: OrgFeatureKey, current: boolean) => {
    toggleMutation.mutate({ orgId, key, enabled: !current });
  };

  // Toggleable keys (take effect immediately via useFeature → Rail/FeatureRoute). The env-gated
  // keys (agent_assistant/user_views) are excluded — their effective gate is still the deployment
  // env flag (plan M5), so toggling them would look like a no-op; render them read-only instead.
  const toggleable: OrgFeatureKey[] = [...FEATURE_KEYS_TOGGLEABLE];
  const envGated: OrgFeatureKey[] = ([...FEATURE_KEYS] as OrgFeatureKey[]).filter(
    (k) => !FEATURE_KEYS_TOGGLEABLE.includes(k),
  );
  const core: EntitleableKey[] = [...CORE_FEATURES];

  return (
    <div className="rounded-lg border border-border bg-card">
      <ul className="divide-y divide-border">
        {toggleable.map((key) => {
          const enabled = resolve(key);
          const label = FEATURE_LABELS[key];
          if (isOperator) {
            return (
              <li key={key} className="flex items-center justify-between gap-3 px-4 py-3">
                <span className="text-[13.5px] font-medium">{label}</span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={enabled}
                  aria-label={label}
                  disabled={toggleMutation.isPending}
                  onClick={() => handleToggle(key, enabled)}
                  className={cn(
                    TRACK_STYLE,
                    enabled ? 'bg-primary' : 'bg-secondary',
                  )}
                >
                  <span
                    aria-hidden
                    className={cn(
                      THUMB_STYLE,
                      enabled && 'translate-x-[21px]',
                    )}
                  />
                </button>
              </li>
            );
          }
          return (
            <li key={key} className="flex items-center justify-between gap-3 px-4 py-3">
              <span className="text-[13.5px] font-medium">{label}</span>
              <StatusPill variant={enabled ? 'won' : 'neutral'}>
                {enabled ? 'Included in your plan' : 'Hidden'}
              </StatusPill>
            </li>
          );
        })}
        {envGated.map((key) => {
          // Read-only for BOTH personas: the toggle has no immediate effect (env flag is the
          // effective gate at the call site). Shown as a "Preview" so the UI is honest about that.
          const enabled = resolve(key);
          return (
            <li key={key} className="flex items-center justify-between gap-3 px-4 py-3">
              <span className="text-[13.5px] font-medium">{FEATURE_LABELS[key]}</span>
              <StatusPill variant={enabled ? 'won' : 'neutral'}>
                {enabled ? 'Preview — on' : 'Preview — off'}
              </StatusPill>
            </li>
          );
        })}
        {core.map((key) => (
          <li key={key} className="flex items-center justify-between gap-3 px-4 py-3">
            <span className="text-[13.5px] font-medium">{FEATURE_LABELS[key]}</span>
            <StatusPill variant="neutral">Always on</StatusPill>
          </li>
        ))}
      </ul>
    </div>
  );
};

export default AdministrationFeatures;
