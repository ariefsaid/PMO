/**
 * Right timeline pane of the Task Gantt (ADR-0031 split layout) — extracted from
 * ProjectGantt (XG03-003): the frozen time axis, the absolute-px content box with its
 * SVG overlay (gridlines, today line, dependency connectors), the on-axis milestone
 * diamonds and the bar blocks. Pure painting over `buildGanttModel` geometry — the
 * geometry/flat-row seam is the only input; this component owns no scroll of its own
 * (the single scroll container stays in ProjectGantt) and no independent geometry math.
 */
import React from 'react';
import { useTranslation } from 'react-i18next';
import {
  type GanttAxisTick,
  type GanttBar,
  type GanttBarBox,
  type GanttEdge,
  type GanttGeometry,
  type GanttLane,
  type GanttMarkerBox,
} from '@/src/lib/gantt/ganttLayout';
import { edgePath, arrowHead } from '@/src/lib/gantt/ganttGeometry';
import { GANTT_AXIS_H, type GanttFlatRow } from '@/src/lib/gantt/ganttRows';
import { usePrefersReducedMotion } from '@/src/components/dashboard/usePrefersReducedMotion';

// ── Axis ──────────────────────────────────────────────────────────────────────

interface GanttAxisProps {
  ticks: GanttAxisTick[];
  todayLeft: number | null;
  contentWidth: number;
}

const GanttAxis: React.FC<GanttAxisProps> = ({ ticks, todayLeft, contentWidth }) => {
  const { t } = useTranslation('project');
  return (
  <div
    className="relative border-b border-border"
    style={{ height: GANTT_AXIS_H, width: contentWidth }}
    aria-hidden="true"
  >
    {ticks.map((tick) =>
      tick.showLabel ? (
        <span
          key={tick.iso}
          className="absolute top-0 translate-y-1/4 whitespace-nowrap text-xs text-muted-foreground"
          style={{ left: tick.left * contentWidth }}
        >
          {tick.label}
        </span>
      ) : null,
    )}
    {todayLeft != null && (
      <span
        className="absolute bottom-0 text-[10px] font-semibold text-primary"
        style={{ left: todayLeft * contentWidth, transform: 'translateX(-50%)' }}
      >
        {t('projectDetail.gantt.today', 'Today')}
      </span>
    )}
  </div>
  );
};

// ── Milestone diamond (on the axis — D4) ──────────────────────────────────────

interface MilestoneDiamondProps {
  marker: GanttMarkerBox;
  name: string;
  targetIso: string;
  contentHeight: number;
}

const MilestoneDiamond: React.FC<MilestoneDiamondProps> = ({
  marker,
  name,
  targetIso,
  contentHeight,
}) => {
  const { t } = useTranslation('project');
  return (
  <>
    {/* Vertical dotted guide from the diamond through the lane band */}
    <span
      aria-hidden="true"
      className="pointer-events-none absolute"
      style={{
        left: marker.x,
        top: marker.y,
        height: Math.max(0, contentHeight - marker.y),
        borderLeft: '1px dashed hsl(var(--violet) / 0.3)',
      }}
    />
    {/* The diamond glyph (rotated square) — a labelled image now the figure no longer carries role="img" */}
    <span
      role="img"
      aria-label={`${name} ${t('projectDetail.gantt.milestoneWord', 'phase')} — ${t(
        'projectDetail.gantt.targetWord',
        'target',
      )} ${targetIso}`}
      title={`${name} — ${t('projectDetail.gantt.targetWord', 'target')} ${targetIso}`}
      className="absolute"
      style={{
        left: marker.x,
        top: marker.y,
        width: 10,
        height: 10,
        transform: 'translate(-50%, -50%) rotate(45deg)',
        background: 'hsl(var(--violet))',
        borderRadius: 2,
      }}
    />
  </>
  );
};

// ── Bar block (absolute-positioned via geometry) ──────────────────────────────

interface GanttBarBlockProps {
  bar: GanttBar;
  box: GanttBarBox;
  predecessorNames: string[];
  prefersReducedMotion: boolean;
  onActivate?: () => void;
}

const GanttBarBlock: React.FC<GanttBarBlockProps> = ({
  bar,
  box,
  predecessorNames,
  prefersReducedMotion,
  onActivate,
}) => {
  const { t } = useTranslation('project');
  const isPoint = bar.kind === 'point';
  const depsSuffix =
    predecessorNames.length > 0
      ? `, ${t('projectDetail.gantt.dependsOn', 'depends on')} ${predecessorNames.join(', ')}`
      : '';
  const datesPart = `${bar.startIso ?? ''}${bar.startIso && bar.endIso ? '–' : ''}${bar.endIso ?? ''}`;
  // Accessible name: keep the task name FIRST so getByRole('button', {name}) matches it.
  const label = `${bar.name}: ${bar.status}${datesPart ? `, ${datesPart}` : ''}${depsSuffix}`;

  const handleKeyDown = onActivate
    ? (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onActivate();
        }
      }
    : undefined;

  const width = Math.max(0, box.xEnd - box.xStart);
  /** A3: suppress the in-bar label when the bar is too narrow to show text legibly. */
  const showInBarLabel = width >= 40;

  if (isPoint) {
    return (
      <span
        role={onActivate ? 'button' : undefined}
        tabIndex={onActivate ? 0 : undefined}
        aria-label={label}
        onClick={onActivate}
        onKeyDown={handleKeyDown}
        title={label}
        className={`absolute -translate-x-1/2 -translate-y-1/2 text-[14px] text-violet${onActivate ? ' cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring' : ''}`}
        style={{ left: box.xStart, top: box.y + box.h / 2 }}
      >
        <span aria-hidden="true" className="block size-2.5 rotate-45 rounded-[2px] bg-violet" />
      </span>
    );
  }

  return (
    <div
      role={onActivate ? 'button' : undefined}
      tabIndex={onActivate ? 0 : undefined}
      aria-label={onActivate ? label : undefined}
      onClick={onActivate}
      onKeyDown={handleKeyDown}
      title={label}
      className={`absolute flex items-center overflow-hidden rounded px-2${onActivate ? ' cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring' : ''}`}
      style={{
        left: box.xStart,
        width,
        top: box.y,
        height: box.h,
        background: 'hsl(var(--violet) / 0.12)',
        border: '1px solid hsl(var(--violet) / 0.35)',
        transition: prefersReducedMotion ? 'none' : 'opacity 150ms ease',
      }}
    >
      {showInBarLabel && (
        <span className="truncate text-[11.5px] font-semibold leading-none text-foreground">
          {bar.name}
        </span>
      )}
    </div>
  );
};

// ── Helpers to resolve marker name/iso from lanes ─────────────────────────────

function markerName(lanes: GanttLane[], id: string): string {
  for (const l of lanes) if (l.marker?.id === id) return l.marker.name;
  return '';
}
function markerIso(lanes: GanttLane[], id: string): string {
  for (const l of lanes) if (l.marker?.id === id) return l.marker.targetIso;
  return '';
}

// ── The timeline pane ─────────────────────────────────────────────────────────

interface GanttTimelineProps {
  lanes: GanttLane[];
  geometry: GanttGeometry;
  ticks: GanttAxisTick[];
  todayLeft: number | null;
  /** The shared flat rows — bars paint in table-row order with their predecessor names. */
  rows: GanttFlatRow[];
  /** Dependency edges, forwarded for the connector SVG (typed for readability). */
  edges: GanttEdge[];
  onBarActivate?: (id: string) => void;
}

const GanttTimeline: React.FC<GanttTimelineProps> = ({
  lanes,
  geometry,
  ticks,
  todayLeft,
  rows,
  edges,
  onBarActivate,
}) => {
  const prefersReducedMotion = usePrefersReducedMotion();
  const { contentWidth, contentHeight } = geometry;

  // Geometry-indexed lookup for the timeline pane.
  const barBoxById = React.useMemo(() => {
    const m = new Map<string, GanttBarBox>();
    geometry.bars.forEach((b) => m.set(b.id, b));
    return m;
  }, [geometry]);

  return (
    <div className="shrink-0" style={{ width: contentWidth + 32, padding: '0 16px' }}>
      {/* Axis — frozen on vertical scroll. Opaque bg so bars pass under it. */}
      <div className="sticky top-0 z-20 bg-card">
        <GanttAxis ticks={ticks} todayLeft={todayLeft} contentWidth={contentWidth} />
      </div>

      {/* Content box: SVG overlay (gridlines + edges) under the bars/diamonds. */}
      <div className="relative" style={{ width: contentWidth, height: contentHeight }}>
        <svg
          aria-hidden="true"
          width={contentWidth}
          height={contentHeight}
          className="pointer-events-none absolute inset-0"
        >
          {/* Vertical gridlines at each tick */}
          {ticks.map((t) => (
            <line
              key={`grid-${t.iso}`}
              x1={t.left * contentWidth}
              x2={t.left * contentWidth}
              y1={0}
              y2={contentHeight}
              stroke="hsl(var(--border))"
              strokeWidth={1}
            />
          ))}
          {/* Today line */}
          {todayLeft != null && (
            <line
              x1={todayLeft * contentWidth}
              x2={todayLeft * contentWidth}
              y1={0}
              y2={contentHeight}
              stroke="hsl(var(--primary))"
              strokeWidth={1}
              strokeDasharray="2 2"
            />
          )}
          {/* Dependency connectors (structural — muted-foreground, NOT action-blue) */}
          {edges.map((e) => (
            <g key={e.id}>
              <path
                d={edgePath(e)}
                fill="none"
                stroke="hsl(var(--muted-foreground) / 0.55)"
                strokeWidth={1.25}
              />
              <polygon
                points={arrowHead(e)}
                fill="hsl(var(--muted-foreground) / 0.55)"
              />
            </g>
          ))}
        </svg>

        {/* Milestone diamonds + vertical dotted guides (D4) */}
        {geometry.markers.map((mk) => (
          <MilestoneDiamond
            key={`marker-${mk.id}`}
            marker={mk}
            name={markerName(lanes, mk.id)}
            targetIso={markerIso(lanes, mk.id)}
            contentHeight={contentHeight}
          />
        ))}

        {/* Bars */}
        {rows.map((row) => {
          if (row.kind !== 'task') return null;
          const box = barBoxById.get(row.bar.id);
          if (!box) return null;
          return (
            <GanttBarBlock
              key={`bar-${row.bar.id}`}
              bar={row.bar}
              box={box}
              predecessorNames={row.predecessorNames}
              prefersReducedMotion={prefersReducedMotion}
              onActivate={onBarActivate ? () => onBarActivate(row.bar.id) : undefined}
            />
          );
        })}
      </div>
    </div>
  );
};

export default GanttTimeline;
