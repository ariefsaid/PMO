
import React, { useState, useMemo } from 'react';
import Card from '../components/Card';
import TimesheetStatusBadge from '../components/TimesheetStatusBadge';
import { TimesheetStatus } from '../types';
import { TimesheetsIcon, ClipboardDocumentCheckIcon } from '../components/icons';
import { useTimesheets } from '@/src/hooks/useTimesheets';
import type { TimesheetEntryWithProject } from '@/src/lib/db/timesheets';

const getWeekStartDate = (date: Date): Date => {
    const d = new Date(date);
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1);
    return new Date(d.setDate(diff));
};

const formatDate = (date: Date): string => {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
};

const TimesheetsPage: React.FC = () => {
    const { data: sheets, isPending, isError, refetch } = useTimesheets();

    const [currentDate, setCurrentDate] = useState(new Date());

    const weekStartDate = getWeekStartDate(new Date(currentDate));
    const weekStartString = formatDate(weekStartDate);

    const weekDates = useMemo(() => Array.from({ length: 7 }).map((_, i) => {
        const date = new Date(weekStartDate);
        date.setDate(date.getDate() + i);
        return date;
    }), [weekStartDate]);

    const currentTimesheet = useMemo(
        () => (sheets ?? []).find(t => t.week_start_date === weekStartString) ?? null,
        [sheets, weekStartString],
    );

    const currentWeekEntries = useMemo<TimesheetEntryWithProject[]>(
        () => currentTimesheet?.entries ?? [],
        [currentTimesheet],
    );

    const rows = useMemo(() => {
        const map = new Map<string, { id: string; projectId: string; projectName: string; notes: string }>();
        for (const e of currentWeekEntries) {
            const key = `${e.project_id}::${e.notes ?? ''}`;
            if (!map.has(key)) map.set(key, {
                id: key, projectId: e.project_id,
                projectName: e.project?.name ?? 'Unknown Project', notes: e.notes ?? '',
            });
        }
        return Array.from(map.values()).sort((a, b) => a.projectName.localeCompare(b.projectName));
    }, [currentWeekEntries]);

    const weeklyTotal = useMemo(
        () => currentWeekEntries.reduce((sum, e) => sum + e.hours, 0),
        [currentWeekEntries],
    );

    const weeklyUtilization = Math.min((weeklyTotal / 40) * 100, 100);

    const dailyTotals = useMemo(() => weekDates.map(d => {
        const ds = formatDate(d);
        return currentWeekEntries.filter(e => e.entry_date === ds).reduce((s, e) => s + e.hours, 0);
    }), [currentWeekEntries, weekDates]);

    const handlePrevWeek = () => {
        const newDate = new Date(currentDate);
        newDate.setDate(newDate.getDate() - 7);
        setCurrentDate(newDate);
    };

    const handleNextWeek = () => {
        const newDate = new Date(currentDate);
        newDate.setDate(newDate.getDate() + 7);
        setCurrentDate(newDate);
    };

    const handleJumpToToday = () => {
        setCurrentDate(new Date());
    };

    // --- State branches ---
    if (isPending) {
        return (
            <Card>
                <div data-testid="timesheets-loading" className="animate-pulse space-y-4">
                    <div className="h-8 w-48 bg-gray-200 dark:bg-gray-700 rounded" />
                    <div className="h-64 bg-gray-200 dark:bg-gray-700 rounded-xl" />
                </div>
            </Card>
        );
    }

    if (isError) {
        return (
            <Card>
                <div className="text-center py-16 border-2 border-dashed border-red-200 dark:border-red-800 rounded-xl">
                    <h3 className="text-lg font-medium text-gray-900 dark:text-white">Couldn't load timesheets</h3>
                    <p className="mt-1 text-gray-500 dark:text-gray-400">Something went wrong fetching your hours.</p>
                    <button
                        onClick={() => refetch()}
                        className="mt-4 text-primary-600 hover:text-primary-500 font-medium text-sm"
                    >
                        Retry
                    </button>
                </div>
            </Card>
        );
    }

    return (
        <Card className="min-h-[calc(100vh-140px)]">
            <div className="space-y-6">
                {/* Summary Header */}
                <div className="bg-white dark:bg-gray-800 rounded-lg p-6 border border-gray-200 dark:border-gray-700 shadow-sm flex flex-col md:flex-row items-center justify-between gap-6">
                    <div className="flex items-center space-x-6">
                        <div className="flex flex-col items-center justify-center w-16 h-16 rounded-full bg-primary-50 dark:bg-primary-900/30 text-primary-600 dark:text-primary-400 border border-primary-100 dark:border-primary-800">
                            <span
                                data-testid="timesheets-weekly-total"
                                className="text-xl font-bold"
                            >
                                {weeklyTotal.toFixed(1)}
                            </span>
                            <span className="text-[10px] uppercase font-medium">Hours</span>
                        </div>
                        <div>
                            <h2 className="text-lg font-bold text-gray-900 dark:text-white flex items-center gap-2">
                                Weekly Timesheet
                                {currentTimesheet && <TimesheetStatusBadge status={currentTimesheet.status as TimesheetStatus} />}
                            </h2>
                            <div className="flex items-center space-x-2 mt-1">
                                <button
                                    onClick={handlePrevWeek}
                                    aria-label="Previous week"
                                    className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded text-gray-500"
                                >
                                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                                    </svg>
                                </button>
                                <span className="text-sm text-gray-600 dark:text-gray-300 font-medium min-w-[140px] text-center">
                                    {weekStartDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} - {weekDates[6].toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
                                </span>
                                <button
                                    onClick={handleNextWeek}
                                    aria-label="Next week"
                                    className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded text-gray-500"
                                >
                                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                                    </svg>
                                </button>
                                <button
                                    onClick={handleJumpToToday}
                                    className="text-xs text-primary-600 hover:text-primary-700 font-medium ml-2"
                                >
                                    Today
                                </button>
                            </div>
                        </div>
                    </div>

                    <div className="flex-1 w-full md:max-w-xs flex flex-col items-end">
                        <div className="flex justify-between w-full text-xs mb-1.5">
                            <span className="text-gray-500 dark:text-gray-400">Utilization Goal (40h)</span>
                            <span className="font-bold text-gray-700 dark:text-gray-200">{Math.round(weeklyUtilization)}%</span>
                        </div>
                        <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2.5 overflow-hidden">
                            <div
                                className={`h-full rounded-full ${weeklyTotal >= 40 ? 'bg-green-500' : 'bg-primary-500'}`}
                                style={{ width: `${weeklyUtilization}%` }}
                            />
                        </div>
                        <div className="mt-4">
                            <button
                                disabled
                                title="Submitting is coming soon"
                                className="px-4 py-2 text-sm font-medium text-white rounded-md shadow-sm bg-gray-400 cursor-not-allowed"
                            >
                                Submit Timesheet
                            </button>
                        </div>
                    </div>
                </div>

                {/* Matrix Table View */}
                <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden">
                    <div className="overflow-x-auto">
                        <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                            <thead className="bg-gray-50 dark:bg-gray-700/50">
                                <tr>
                                    <th className="px-6 py-4 text-left text-xs font-semibold text-gray-500 dark:text-gray-300 uppercase tracking-wider w-56">Project</th>
                                    <th className="px-4 py-4 text-left text-xs font-semibold text-gray-500 dark:text-gray-300 uppercase tracking-wider w-64">Task / Notes</th>
                                    {weekDates.map((date, i) => {
                                        const isToday = new Date().toDateString() === date.toDateString();
                                        return (
                                            <th key={i} className={`px-2 py-4 text-center text-xs font-semibold uppercase tracking-wider min-w-[70px] ${isToday ? 'text-primary-600 dark:text-primary-400 bg-primary-50 dark:bg-primary-900/20' : 'text-gray-500 dark:text-gray-300'}`}>
                                                <div>{date.toLocaleDateString(undefined, { weekday: 'short' })}</div>
                                                <div className="mt-1">{date.getDate()}</div>
                                            </th>
                                        );
                                    })}
                                    <th className="px-4 py-4 text-center text-xs font-semibold text-gray-900 dark:text-white uppercase tracking-wider w-16 bg-gray-100 dark:bg-gray-700">Total</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                                {currentWeekEntries.length === 0 ? (
                                    <tr>
                                        <td colSpan={10} className="px-6 py-12 text-center">
                                            <div data-testid="timesheets-empty" className="text-gray-500 dark:text-gray-400">
                                                No hours logged for this week.
                                            </div>
                                        </td>
                                    </tr>
                                ) : (
                                    rows.map(row => {
                                        // NOTE: revisit for manager/team view (OD-T1)
                                        const rowTotal = currentWeekEntries
                                            .filter(e => e.project_id === row.projectId && (e.notes ?? '') === row.notes)
                                            .reduce((sum, e) => sum + e.hours, 0);

                                        return (
                                            <tr key={row.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors">
                                                <td className="px-6 py-3 whitespace-nowrap">
                                                    <div className="text-sm font-medium text-gray-900 dark:text-white">{row.projectName}</div>
                                                </td>
                                                <td className="px-4 py-3">
                                                    <span className="text-sm text-gray-600 dark:text-gray-300">{row.notes || '-'}</span>
                                                </td>
                                                {weekDates.map((date, i) => {
                                                    const dateStr = formatDate(date);
                                                    const entry = currentWeekEntries.find(
                                                        e => e.project_id === row.projectId && e.entry_date === dateStr && (e.notes ?? '') === row.notes
                                                    );
                                                    const isToday = new Date().toDateString() === date.toDateString();

                                                    return (
                                                        <td
                                                            key={i}
                                                            className={`px-1 py-1 text-center border-l border-transparent ${isToday ? 'bg-primary-50/30 dark:bg-primary-900/10' : ''}`}
                                                        >
                                                            <span className={`text-sm ${entry ? 'font-bold text-gray-900 dark:text-white' : 'text-gray-300 dark:text-gray-600'}`}>
                                                                {entry ? entry.hours.toFixed(2) : '-'}
                                                            </span>
                                                        </td>
                                                    );
                                                })}
                                                <td className="px-4 py-3 text-center text-sm font-bold text-gray-900 dark:text-white bg-gray-50 dark:bg-gray-800 border-l border-gray-200 dark:border-gray-700">
                                                    {rowTotal > 0 ? rowTotal.toFixed(2) : '-'}
                                                </td>
                                            </tr>
                                        );
                                    })
                                )}

                                {/* Totals Row */}
                                <tr className="bg-gray-100 dark:bg-gray-700 border-t-2 border-gray-300 dark:border-gray-600 font-bold">
                                    <td colSpan={2} className="px-6 py-4 text-xs uppercase tracking-wider text-gray-600 dark:text-gray-300 text-right">Daily Total</td>
                                    {dailyTotals.map((dayTotal, i) => (
                                        <td key={i} className="px-2 py-4 text-center text-sm text-gray-900 dark:text-white">
                                            {dayTotal > 0 ? dayTotal.toFixed(2) : '-'}
                                        </td>
                                    ))}
                                    <td className="px-4 py-4 text-center text-sm text-primary-700 dark:text-primary-300 bg-gray-200 dark:bg-gray-600">
                                        {weeklyTotal.toFixed(2)}
                                    </td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                </div>

                <div className="flex items-start p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg text-sm text-blue-700 dark:text-blue-300">
                    <ClipboardDocumentCheckIcon className="w-5 h-5 mr-3 flex-shrink-0" />
                    <p>
                        <strong>View only:</strong> Entry editing and timesheet submission are coming soon.
                    </p>
                </div>

                {/* Approvals tab is deferred — OD-T1 */}
                <div className="text-xs text-gray-400 dark:text-gray-600 flex items-center gap-2">
                    <TimesheetsIcon className="w-4 h-4" />
                    <span>Approvals workflow coming soon.</span>
                </div>
            </div>
        </Card>
    );
};

export default TimesheetsPage;
