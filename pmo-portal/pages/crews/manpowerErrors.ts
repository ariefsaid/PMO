import { refusalLine, useRefusalText } from '@/src/lib/refusals';
import { useCrewErrorText } from './crewErrors';

/**
 * One sentence for a refused manpower write. A rule the database names (`MPN_FULL: …`) reads from the `refusals` catalogue; it is
 * tried first because a duplicate link carries Postgres code 23505, which the crew text would read as a duplicate crew code.
 */
export function useManpowerErrorText(): (err: unknown) => string {
  const refusal = useRefusalText();
  const crewText = useCrewErrorText();
  return (err) => {
    const message = (err as { message?: string } | null)?.message ?? '';
    return /\bMPN_[A-Z_]+:/.test(message) ? refusalLine(refusal(err)) : crewText(err);
  };
}
