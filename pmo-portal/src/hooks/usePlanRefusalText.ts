import { useTranslation } from 'react-i18next';
import { planRefusal } from '@/src/lib/repositories/equipmentPlans';
import { classifyMutationError } from '@/src/lib/classifyMutationError';

/** English wording for each refusal key; the translated strings live in `public/locales/<lang>/equipmentPlans.json` under `refusal`. */
const DEFAULTS: Record<string, string> = {
  ADMIN_ONLY: 'Only an Admin can change the monthly plan settings.', OFF: 'The monthly plan is not turned on.',
  PREREQ: 'Turn on purchase types and keep an active rental type first.', INVALID: 'Check the plan and try again.',
  DENIED: 'You cannot do this on this plan.', DUPLICATE: 'A category with that name already exists.', UNAVAILABLE: 'That item is not available.',
  REFERENCE: 'One of the choices on a line is not available.', DATE_RANGE: "A line's dates must be inside the plan's month.",
  LOCKED: 'This plan can no longer be changed.', STATE: 'This plan is not in a state that allows that.', NOT_FOUND: 'The plan is not available.',
  NOT_APPROVER: 'You are not an approver of this plan.', SELF_APPROVAL: 'You cannot approve your own plan.',
  NO_RENTAL_TYPE: 'Purchase types must be on with an active rental type before a plan can be approved.',
};

/** The text of a plan refusal in the user's language; any other failure reads as the shared mutation headline. */
export function usePlanRefusalText(): (error: unknown) => string {
  const { t } = useTranslation('equipmentPlans');
  return (error) => {
    const r = planRefusal(error);
    if (r) return t(`refusal.${r.key}`, DEFAULTS[r.key] ?? r.message);
    return classifyMutationError(error, undefined, { suppressCapture: true }).headline;
  };
}
