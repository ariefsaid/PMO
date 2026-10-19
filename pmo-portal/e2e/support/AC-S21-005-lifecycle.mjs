export const S21_FIXTURE_PHASE_TIMEOUT_MS = 30_000;

/**
 * Stop only resources created by this fixture, then clean rows only after its exact-ID preflight.
 * Cleanup continues after either phase fails so the caller can retain every failure.
 * @param {{preflightPassed: boolean, ownedServer: unknown, primaryFailure: unknown, stopOwnedServer: (server: unknown) => Promise<unknown>, cleanupOwnedRows: () => Promise<unknown>}} options
 */
export async function runS21FixtureCleanup({
  preflightPassed,
  ownedServer,
  primaryFailure,
  stopOwnedServer,
  cleanupOwnedRows,
}) {
  const cleanupFailures = [];
  const retainFailure = (error) => {
    if (error instanceof AggregateError) {
      for (const nested of error.errors) retainFailure(nested);
    } else {
      cleanupFailures.push(error);
    }
  };

  if (ownedServer) {
    try {
      await stopOwnedServer(ownedServer);
    } catch (error) {
      retainFailure(error);
    }
  }

  if (preflightPassed) {
    try {
      await cleanupOwnedRows();
    } catch (error) {
      retainFailure(error);
    }
  }

  if (cleanupFailures.length > 0) {
    throw new AggregateError(
      [...(primaryFailure ? [primaryFailure] : []), ...cleanupFailures],
      'S21 fixture cleanup failed',
    );
  }
}
