/**
 * Primitive Registry (ADR-0036 §4a / ADR-0037 / FR-VC-001..004).
 *
 * Machine-readable manifest of the existing kit primitives the renderer (I3) will hydrate.
 * Every entry is derived verbatim from the actual component prop types in:
 *   src/components/ui/DataTable.tsx, KPITile.tsx, StatTiles.tsx, Funnel.tsx, ProgressBar.tsx, Card.tsx
 *   src/components/dashboard/StatusBarChart.tsx
 *
 * The registry exports:
 *   - registry.get(name)      — returns PrimitiveDescriptor | undefined (FR-VC-004: never throws)
 *   - validatePrimitive(name) — returns boolean (FR-VC-050)
 *
 * No primitive name is hardcoded outside this file (FR-VC-003).
 * No Supabase client import. No page/hook/route import (NFR-VC-LAYER-001).
 *
 * The type-only imports below bind each descriptor's prop/data union literals to the REAL
 * component types via `satisfies`, so a future rename or value change in a component will fail
 * `tsc` here — keeping the manifest honest without pulling React/runtime into this pure module.
 */

// Type-only imports from component source (no runtime dependency on React components)
import type { KPITone } from '@/src/components/ui/KPITile';
import type { ProgressTone } from '@/src/components/ui/ProgressBar';

// ── Descriptor types ───────────────────────────────────────────────────────────

/**
 * A prop schema descriptor is a plain object mapping prop names to their allowed
 * values or type tags. It is serialisation-safe (no function-typed VALUES are emitted;
 * function-backed props are tagged with the string literal 'function').
 * The renderer (I3) uses this to validate the `props` field of a PanelSpec.
 */
export type PropSchemaDescriptor = Record<string, unknown>;

/** The data shape a primitive accepts — describes the top-level structure of the data object. */
export type DataShapeDescriptor = Record<string, unknown>;

export interface PrimitiveDescriptor {
  name: string;
  description: string;
  /** Typed prop schema — renderer uses this to validate static props from PanelSpec.props. */
  propSchema: PropSchemaDescriptor;
  /** Data shape — the structure the primitive's data-driven props expect. */
  dataShape: DataShapeDescriptor;
}

// ── Registry implementation ────────────────────────────────────────────────────

class PrimitiveRegistryImpl {
  private readonly entries: ReadonlyMap<string, PrimitiveDescriptor>;

  constructor(entries: PrimitiveDescriptor[]) {
    this.entries = new Map(entries.map((e) => [e.name, e]));
  }

  /** Returns the descriptor for a known primitive, or undefined if unknown. Never throws. (FR-VC-004) */
  get(name: string): PrimitiveDescriptor | undefined {
    return this.entries.get(name);
  }

  /** Returns all registered primitive names (for agent catalog / spec-author). */
  keys(): string[] {
    return Array.from(this.entries.keys());
  }
}

// Compile-time guards binding descriptor literals to real component unions.
// If a component renames a tone, these `satisfies` checks fail tsc here.
const KPI_TONES = ['blue', 'violet', 'amber', 'red', 'green'] as const satisfies readonly KPITone[];
const PROGRESS_TONES = ['success', 'warning', 'destructive', 'primary'] as const satisfies readonly ProgressTone[];

// ── Registry entries (verbatim from component props) ──────────────────────────

/**
 * DataTable (src/components/ui/DataTable.tsx — DataTableProps<Row>)
 * Data shape: rows are generic records; columns are renderer-supplied.
 */
const DATA_TABLE: PrimitiveDescriptor = {
  name: 'DataTable',
  description: 'Generic typed data table with loading/empty/error states, sortable headers, and row actions.',
  propSchema: {
    // Static props the renderer supplies; `rows` and `columns` are data-driven.
    rowKey: 'function',
    sort: 'SortState | undefined',
    state: "'loading' | 'empty' | 'error' | undefined",
    emptyTitle: 'string | undefined',
    errorTitle: 'string | undefined',
  },
  dataShape: {
    rows: 'Record<string, unknown>[]',
  },
};

/**
 * KPITile (src/components/ui/KPITile.tsx — KPITileProps)
 * tone: KPITone ('blue'|'violet'|'amber'|'red'|'green')
 * Data-driven: value, delta, vs.
 */
const KPI_TILE: PrimitiveDescriptor = {
  name: 'KPITile',
  description: 'Key performance indicator tile with icon, tone, value, and optional delta/vs comparison.',
  propSchema: {
    icon: 'IconName',
    tone: KPI_TONES,
    label: 'string',
    negative: 'boolean | undefined',
    help: 'string | undefined',
    vs: 'string | undefined',
  },
  dataShape: {
    value: 'string | number',
    delta: '{ dir: "up" | "down" | "neutral"; text: string } | undefined',
    vs: 'string | undefined',
  },
};

/**
 * StatTiles (src/components/ui/StatTiles.tsx — StatTilesProps)
 * Data-driven: tiles array.
 */
const STAT_TILES: PrimitiveDescriptor = {
  name: 'StatTiles',
  description: 'Hairline-gap strip of stat tiles — one metric per tile, with optional pos/neg tone.',
  propSchema: {
    columns: 'number | undefined',
  },
  dataShape: {
    tiles: '{ label: string; value: string | number; tone?: "pos" | "neg"; sub?: string }[]',
  },
};

/**
 * Funnel (src/components/ui/Funnel.tsx — FunnelProps)
 * Data-driven: stages array.
 */
const FUNNEL: PrimitiveDescriptor = {
  name: 'Funnel',
  description: 'Connected pipeline stage band — one cell per stage with bar fill and probability.',
  propSchema: {
    selectedIndex: 'number | undefined',
  },
  dataShape: {
    stages: '{ name: string; value: string | number; barPct?: number; dotColor?: string; prob?: string; weighted?: string; barColor?: string }[]',
  },
};

/**
 * StatusBarChart (src/components/dashboard/StatusBarChart.tsx — StatusBarChartProps<S>)
 * Data-driven: data array of { status, count }.
 */
const STATUS_BAR_CHART: PrimitiveDescriptor = {
  name: 'StatusBarChart',
  description: 'Status-toned bar chart: one bar per status value, with color-safe legend and aria summary.',
  propSchema: {
    label: 'string',
    noun: 'string',
    height: 'number | undefined',
    toneFor: 'function',
  },
  dataShape: {
    data: '{ status: string; count: number }[]',
  },
};

/**
 * ProgressBar (src/components/ui/ProgressBar.tsx — ProgressBarProps)
 * Data-driven: value (0–100), tone.
 */
const PROGRESS_BAR: PrimitiveDescriptor = {
  name: 'ProgressBar',
  description: 'Utilization progress bar with auto-computed or fixed tone, optional numeric label.',
  propSchema: {
    tone: PROGRESS_TONES,
    showValue: 'boolean | undefined',
    compact: 'boolean | undefined',
    widthless: 'boolean | undefined',
    'aria-label': 'string | undefined',
  },
  dataShape: {
    value: 'number (0–100)',
    tone: '"success" | "warning" | "destructive" | "primary" | undefined',
  },
};

/**
 * Card (src/components/ui/Card.tsx — CardProps)
 * Data-driven: title, body.
 */
const CARD: PrimitiveDescriptor = {
  name: 'Card',
  description: 'Flat-by-default bordered card surface; optionally interactive (hover lift), clipping, or seamed.',
  propSchema: {
    interactive: 'boolean | undefined',
    clip: 'boolean | undefined',
    seam: 'boolean | undefined',
  },
  dataShape: {
    title: 'string | undefined',
    body: 'string',
  },
};

// ── Exported registry singleton (FR-VC-003: single source of truth for primitive names) ──

export const registry = new PrimitiveRegistryImpl([
  DATA_TABLE,
  KPI_TILE,
  STAT_TILES,
  FUNNEL,
  STATUS_BAR_CHART,
  PROGRESS_BAR,
  CARD,
]);

/**
 * Returns true if name is a key in the PrimitiveRegistry, false otherwise.
 * Used by spec validators (I3/I4) to check panel primitive names without throwing. (FR-VC-050)
 */
export function validatePrimitive(name: string): boolean {
  return registry.get(name) !== undefined;
}
