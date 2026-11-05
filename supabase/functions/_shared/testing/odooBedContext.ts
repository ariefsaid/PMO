/** A private, throwaway context file keeps bed credentials out of test source and command output. */
export interface OdooBedContext {
  odooUrl: string;
  odooDatabase: string;
  odooKey: string;
  supabaseUrl: string;
  serviceRoleKey: string;
  orgId?: string;
}

export function readOdooBedContext(): OdooBedContext | null {
  const path = Deno.args[0];
  if (!path) return null;
  try {
    const value = JSON.parse(Deno.readTextFileSync(path)) as Partial<OdooBedContext>;
    if (typeof value.odooUrl !== 'string' || typeof value.odooDatabase !== 'string' || typeof value.odooKey !== 'string'
        || typeof value.supabaseUrl !== 'string' || typeof value.serviceRoleKey !== 'string') return null;
    return value as OdooBedContext;
  } catch {
    return null;
  }
}
