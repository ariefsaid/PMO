import React, { useMemo, useState } from 'react';
import { Button, Icon, ListState, cn } from '@/src/components/ui';
import { useIsDesktop } from '@/src/components/ui/useIsDesktop';
import {
  buildMonthMatrix,
  monthLabel,
  addMonths,
  todayCursor,
  parseLocalDate,
  type MonthCursor,
} from '@/src/lib/calendar/monthMatrix';
import type { ProjectWithRefs } from '@/src/lib/db/projects';
import type { MilestoneDate } from '@/src/lib/db/milestones';

type CalEventKind = 'start' | 'end' | 'milestone';

interface CalEvent {
  kind: CalEventKind;
  /** YYYY-MM-DD (local — no TZ shift). */
  iso: string;
  projectId: string;
  /** Visible chip text: project name (start/end) or milestone name (milestone). */
  label: string;
  /** Accessible button name. */
  ariaLabel: string;
}

export interface ProjectCalendarViewProps {
  /** Already RLS-scoped + filtered by Projects.tsx. */
  projects: ProjectWithRefs[];
  /** From useProjectsMilestoneDates (undefined while loading). */
  milestoneDates: MilestoneDate[] | undefined;
  /** True while the milestone-dates query is pending (chips fill in once loaded). */
  milestonesPending?: boolean;
  onOpenProject: (id: string) => void;
  /** Test seam: force the initial displayed month (defaults to todayCursor()). */
  initialCursor?: MonthCursor;
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Chip token classes per event kind — text+shape, never color-only (NFR-CAL-A11Y-001). */
function chipClass(kind: CalEventKind): string {
  if (kind === 'milestone') return 'bg-primary/10 text-primary';
  if (kind === 'end') return 'bg-secondary text-foreground border-l-2 border-primary';
  return 'bg-secondary text-foreground';
}

/** Derive the flat event list from projects (start/end) + dated milestones. */
function deriveEvents(
  projects: ProjectWithRefs[],
  milestoneDates: MilestoneDate[] | undefined,
): CalEvent[] {
  const events: CalEvent[] = [];
  const nameById = new Map(projects.map((p) => [p.id, p.name]));
  for (const p of projects) {
    if (p.start_date) {
      events.push({
        kind: 'start',
        iso: p.start_date,
        projectId: p.id,
        label: p.name,
        ariaLabel: `${p.name} — start`,
      });
    }
    if (p.end_date) {
      events.push({
        kind: 'end',
        iso: p.end_date,
        projectId: p.id,
        label: p.name,
        ariaLabel: `${p.name} — end`,
      });
    }
  }
  for (const m of milestoneDates ?? []) {
    const projectName = nameById.get(m.projectId);
    // A milestone for a project not in the visible set is skipped (defensive).
    if (!projectName) continue;
    events.push({
      kind: 'milestone',
      iso: m.targetDate,
      projectId: m.projectId,
      label: m.name,
      ariaLabel: `${m.name} (${projectName})`,
    });
  }
  return events;
}

/** A clickable project event chip (start/end). */
const ProjectEventChip: React.FC<{ event: CalEvent; onOpen: (id: string) => void }> = ({
  event,
  onOpen,
}) => (
  <button
    type="button"
    onClick={() => onOpen(event.projectId)}
    aria-label={event.ariaLabel}
    title={event.ariaLabel}
    className={cn(
      'block w-full truncate rounded px-1.5 py-0.5 text-left text-[11px] font-medium',
      'hover:brightness-95 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring',
      chipClass(event.kind),
    )}
  >
    {event.label}
  </button>
);

/** A non-interactive milestone chip (display-only in v1 — only project events navigate). */
const MilestoneEventChip: React.FC<{ event: CalEvent }> = ({ event }) => (
  <span
    aria-label={event.ariaLabel}
    title={event.ariaLabel}
    className={cn(
      'block truncate rounded px-1.5 py-0.5 text-[11px] font-medium',
      chipClass('milestone'),
    )}
  >
    {event.label}
  </span>
);

const EventChip: React.FC<{ event: CalEvent; onOpen: (id: string) => void }> = ({
  event,
  onOpen,
}) =>
  event.kind === 'milestone' ? (
    <MilestoneEventChip event={event} />
  ) : (
    <ProjectEventChip event={event} onOpen={onOpen} />
  );

/**
 * Read-only Project Calendar (FR-CAL-001..007). Desktop = a hand-rolled month grid;
 * below the md breakpoint = a day-grouped agenda list (single-render via useIsDesktop).
 * Events: project start_date / end_date (navigate on click) + milestone target_date
 * (display-only in v1). No heavy calendar dependency — native Date + Intl only.
 */
const ProjectCalendarView: React.FC<ProjectCalendarViewProps> = ({
  projects,
  milestoneDates,
  onOpenProject,
  initialCursor,
}) => {
  const [cursor, setCursor] = useState<MonthCursor>(initialCursor ?? todayCursor());
  const isDesktop = useIsDesktop();

  const events = useMemo(
    () => deriveEvents(projects, milestoneDates),
    [projects, milestoneDates],
  );

  // Events keyed by day, only for the displayed month (the grid renders adjacent-month
  // cells but events live only on in-month days — agenda + empty-state derive from this).
  const monthIso = `${cursor.year}-${String(cursor.month + 1).padStart(2, '0')}`;
  const eventsByDay = useMemo(() => {
    const map = new Map<string, CalEvent[]>();
    for (const ev of events) {
      if (!ev.iso.startsWith(`${monthIso}-`)) continue;
      const list = map.get(ev.iso);
      if (list) list.push(ev);
      else map.set(ev.iso, [ev]);
    }
    return map;
  }, [events, monthIso]);

  const monthEventCount = useMemo(
    () => Array.from(eventsByDay.values()).reduce((n, l) => n + l.length, 0),
    [eventsByDay],
  );

  const goPrev = () => setCursor((c) => addMonths(c, -1));
  const goNext = () => setCursor((c) => addMonths(c, 1));
  const goToday = () => setCursor(todayCursor());

  const nav = (
    <div className="mb-3 flex items-center gap-2">
      <Button variant="outline" size="icon" onClick={goPrev} aria-label="Previous month">
        <Icon name="back" />
      </Button>
      <Button variant="outline" size="icon" onClick={goNext} aria-label="Next month">
        <Icon name="chev" />
      </Button>
      <Button variant="outline" size="sm" onClick={goToday} aria-label="Go to today">
        Today
      </Button>
      <h2 className="ml-1 text-[15px] font-semibold">{monthLabel(cursor.year, cursor.month)}</h2>
    </div>
  );

  const emptyOverlay =
    monthEventCount === 0 ? (
      <div className="mt-3">
        <ListState variant="empty" icon="cal" title="No events this month" sub="No project or milestone dates fall in this month." />
      </div>
    ) : null;

  if (isDesktop) {
    const weeks = buildMonthMatrix(cursor.year, cursor.month);
    return (
      <div>
        {nav}
        <div
          data-testid="calendar-month-grid"
          className="overflow-hidden rounded-lg border border-border bg-card"
        >
          <div className="grid grid-cols-7 border-b border-border">
            {WEEKDAYS.map((d) => (
              <div
                key={d}
                className="px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground"
              >
                {d}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7">
            {weeks.flat().map((cell) => {
              const dayEvents = cell.inMonth ? eventsByDay.get(cell.iso) ?? [] : [];
              return (
                <div
                  key={cell.iso}
                  data-testid={`calendar-cell-${cell.iso}`}
                  className={cn(
                    'min-h-[88px] border-b border-r border-border p-1',
                    !cell.inMonth && 'bg-secondary/30 text-muted-foreground/60',
                    cell.isToday && cell.inMonth && 'ring-1 ring-inset ring-primary',
                  )}
                >
                  <div
                    className={cn(
                      'mb-1 px-1 text-[11px] font-semibold',
                      cell.isToday && cell.inMonth && 'text-primary',
                    )}
                  >
                    {cell.day}
                  </div>
                  <div className="flex flex-col gap-0.5">
                    {dayEvents.map((ev, i) => (
                      <EventChip key={`${ev.kind}-${ev.projectId}-${i}`} event={ev} onOpen={onOpenProject} />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
        {emptyOverlay}
      </div>
    );
  }

  // Mobile: day-grouped agenda of the displayed month, chronological.
  const days = Array.from(eventsByDay.keys()).sort();
  return (
    <div>
      {nav}
      <div
        data-testid="calendar-agenda"
        className="overflow-hidden rounded-lg border border-border bg-card"
      >
        {days.map((iso) => {
          const date = parseLocalDate(iso);
          const heading = new Intl.DateTimeFormat('en-US', {
            weekday: 'short',
            month: 'short',
            day: 'numeric',
          }).format(date);
          return (
            <div key={iso} className="border-b border-border p-3 last:border-b-0">
              <div className="mb-1.5 text-[13px] font-semibold">{heading}</div>
              <div className="flex flex-col gap-1">
                {(eventsByDay.get(iso) ?? []).map((ev, i) => (
                  <EventChip key={`${ev.kind}-${ev.projectId}-${i}`} event={ev} onOpen={onOpenProject} />
                ))}
              </div>
            </div>
          );
        })}
      </div>
      {emptyOverlay}
    </div>
  );
};

export default ProjectCalendarView;
