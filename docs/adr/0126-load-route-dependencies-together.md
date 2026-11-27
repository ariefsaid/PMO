# ADR-0126 — Load a route and its repository implementations together

- Status: Accepted under the release repair brief
- Date: 2026-11-27
- Related: ADR-0017, ADR-0030

## Context

Splitting the repository registry reduced bootstrap scripts but allowed a mounted section's first query to start another implementation-module download. A route's first open must retain its existing behavior and timing contract.

## Decision

The Vite transform loads each literal route or section import concurrently with the repository implementation modules used by its static runtime dependencies. Top-level routes include the shared application shell. Named barrel exports are followed selectively; type-only imports and other lazy destinations remain outside that dependency set.

The route or section becomes ready when that parallel group completes. Repository calls retain their existing arguments, query keys, permissions, error handling and query enablement. Preparing a module never executes its repository methods.

Each implementation import is emitted once per importer and reused by its route groups, keeping bootstrap dependency metadata small. The public lazy registry remains available to callers outside a route entry.

## Verification

Behavior tests prove parallel starts, destination identity, exclusion of other destinations, selective barrel traversal and source-change invalidation. The built browser journey retains its five-second expectation. The existing first-load budget remains unchanged.
