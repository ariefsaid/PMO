/**
 * A nullable SQL parameter, which `supabase gen types` cannot express.
 *
 * The generator types every function argument as NOT NULL: it marks an argument optional only when the SQL parameter
 * has a DEFAULT (`p_x?: string`). A parameter declared `p_note text` accepts NULL but is still emitted as `string`, so
 * passing the database's own nullable value fails typecheck for a reason that is not a defect in the call.
 *
 * This is the one place that gap is bridged. It keeps the argument NAME and its base type checked (a renamed or
 * retyped parameter still fails typecheck); only the "may be null" half is asserted here, deliberately, because the
 * database's own signature says so. Prefer it over `as unknown as` — and over `null as string`, which reads as if the
 * caller had proved something it did not.
 */
export const nullableArg = <T>(value: T | null): T => value as T;
