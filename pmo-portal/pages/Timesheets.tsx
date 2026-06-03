
import React, { useState, useMemo, useEffect } from 'react';
import Card from '../components/Card';
import { Timesheet, TimesheetEntry, TimesheetStatus, User, ProjectStatus } from '../types';
import { timesheets as mockTimesheets, timesheetEntries as mockTimesheetEntries, users, projects } from '../data/mockData';
import TimesheetStatusBadge from '../components/TimesheetStatusBadge';
import { TimesheetsIcon, ClipboardDocumentCheckIcon, CalendarDaysIcon, CheckCircleIcon, TrashIcon } from '../components/icons';

const getWeekStartDate = (date: Date): Date => {
    const day = date.getDay();
    const diff = date.getDate() - day + (day === 0 ? -6 : 1); // adjust when day is sunday
    return new Date(date.setDate(diff));
};

const formatDate = (date: Date): string => {
    return date.toISOString().split('T')[0];
};

// Assuming current user is Alice Johnson (ID: 1) who is a PM
const CURRENT_USER_ID = 1; 

interface UIRow {
    id: string;
    projectId: string;
    notes: string;
}

const TimesheetsPage: React.FC = () => {
    // In a real app, this would come from a global state/context
    const currentUser = users.find(u => u.id === CURRENT_USER_ID) as User;
    const isManager = projects.some(p => p.projectManagerId === currentUser.id);

    const [allTimesheets, setAllTimesheets] = useState<Timesheet[]>(mockTimesheets);
    const [allEntries, setAllEntries] = useState<TimesheetEntry[]>(mockTimesheetEntries);

    const [currentDate, setCurrentDate] = useState(new Date());
    const [activeTab, setActiveTab] = useState('My Timesheets');

    // UI Rows State for Matrix View
    const [uiRows, setUiRows] = useState<UIRow[]>([]);

    const weekStartDate = getWeekStartDate(new Date(currentDate));
    const weekStartString = formatDate(weekStartDate);

    const weekDates = useMemo(() => Array.from({ length: 7 }).map((_, i) => {
        const date = new Date(weekStartDate);
        date.setDate(date.getDate() + i);
        return date;
    }), [weekStartDate]);

    const currentTimesheet = useMemo(() => {
        let ts = allTimesheets.find(t => t.userId === currentUser.id && t.weekStartDate === weekStartString);
        if (!ts) {
            ts = {
                id: `TS_NEW_${weekStartString}`,
                userId: currentUser.id,
                weekStartDate: weekStartString,
                status: TimesheetStatus.Draft,
            };
        }
        return ts;
    }, [allTimesheets, currentUser.id, weekStartString]);
    
    const currentWeekEntries = useMemo(() => {
        return allEntries.filter(e => e.timesheetId === currentTimesheet.id);
    }, [allEntries, currentTimesheet.id]);

    // Initialize UI Rows when the week changes
    useEffect(() => {
        const rowMap = new Map<string, UIRow>();
        
        // Group existing entries by Project + Notes
        currentWeekEntries.forEach(e => {
            const key = `${e.projectId}::${e.notes || ''}`;
            if (!rowMap.has(key)) {
                rowMap.set(key, {
                    id: key,
                    projectId: e.projectId,
                    notes: e.notes || ''
                });
            }
        });
        
        // Convert to array
        const initialRows = Array.from(rowMap.values());
        
        // Sort slightly for stability (by project ID)
        initialRows.sort((a, b) => a.projectId.localeCompare(b.projectId));
        
        setUiRows(initialRows);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [currentTimesheet.id]); // Intentionally not dependent on currentWeekEntries deep changes to avoid typing jitters

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

    const handleAddRow = (projectId: string) => {
        if (!projectId) return;
        const newRow: UIRow = {
            id: `ROW_${Date.now()}`,
            projectId,
            notes: ''
        };
        setUiRows(prev => [...prev, newRow]);
    };

    const handleRowNotesChange = (rowId: string, newNotes: string) => {
        // 1. Update UI Row State
        const row = uiRows.find(r => r.id === rowId);
        if (!row) return;
        
        const oldNotes = row.notes;

        setUiRows(prev => prev.map(r => r.id === rowId ? { ...r, notes: newNotes } : r));

        // 2. Update all matching entries in the data
        setAllEntries(prev => prev.map(e => {
            if (e.timesheetId === currentTimesheet.id && e.projectId === row.projectId && (e.notes || '') === oldNotes) {
                return { ...e, notes: newNotes };
            }
            return e;
        }));
    };

    const handleDeleteRow = (rowId: string) => {
        const row = uiRows.find(r => r.id === rowId);
        if (!row) return;

        if (window.confirm('Are you sure you want to delete this row? All hours logged for this task line will be removed.')) {
            // Remove entries
            setAllEntries(prev => prev.filter(e => !(e.timesheetId === currentTimesheet.id && e.projectId === row.projectId && (e.notes || '') === row.notes)));
            // Remove UI row
            setUiRows(prev => prev.filter(r => r.id !== rowId));
        }
    }

    const handleHoursChange = (projectId: string, notes: string, date: Date, val: string) => {
        // Create timesheet if it doesn't exist
        if (!allTimesheets.find(ts => ts.id === currentTimesheet.id)) {
            setAllTimesheets(prev => [...prev, currentTimesheet]);
        }

        const dateStr = formatDate(date);
        const hours = val === '' ? 0 : parseFloat(val);

        setAllEntries(prev => {
            const existingIndex = prev.findIndex(e => 
                e.projectId === projectId && 
                e.date === dateStr && 
                e.timesheetId === currentTimesheet.id &&
                (e.notes || '') === notes
            );
            
            if (existingIndex >= 0) {
                 // Update existing
                 const newEntries = [...prev];
                 newEntries[existingIndex] = { ...newEntries[existingIndex], hours };
                 return newEntries;
            } else {
                 if (hours === 0) return prev; // Don't create entry for 0 if it doesn't exist
                 
                 // Create new entry
                 const newEntry: TimesheetEntry = {
                    id: `TSE_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                    timesheetId: currentTimesheet.id,
                    projectId,
                    date: dateStr,
                    hours,
                    notes // Link entry to the row's notes
                };
                return [...prev, newEntry];
            }
        });
    };

    const handleSubmitForApproval = () => {
        if (window.confirm('Are you sure you want to submit this timesheet for approval? You will not be able to edit it afterwards.')) {
            const updatedTimesheet = { ...currentTimesheet, status: TimesheetStatus.Submitted, submittedAt: new Date().toISOString() };
            setAllTimesheets(prev => {
                const exists = prev.find(ts => ts.id === updatedTimesheet.id);
                if (exists) {
                    return prev.map(ts => ts.id === updatedTimesheet.id ? updatedTimesheet : ts);
                } else {
                    return [...prev, updatedTimesheet];
                }
            });
        }
    };
    
    const weeklyTotal = currentWeekEntries.reduce((total, entry) => total + entry.hours, 0);
    const weeklyUtilization = Math.min((weeklyTotal / 40) * 100, 100);

    // Approval Logic
    const pendingApprovals = useMemo(() => {
        if (!isManager) return [];
        const managerProjectIds = projects.filter(p => p.projectManagerId === currentUser.id).map(p => p.id);
        const submittedTimesheets = allTimesheets.filter(ts => ts.status === TimesheetStatus.Submitted);

        return submittedTimesheets.map(ts => {
            const entries = allEntries.filter(e => e.timesheetId === ts.id);
            const user = users.find(u => u.id === ts.userId);
            const totalHours = entries.reduce((sum, e) => sum + e.hours, 0);
            const relevantHours = entries.filter(e => managerProjectIds.includes(e.projectId)).reduce((sum, e) => sum + e.hours, 0);

            return { ...ts, user, totalHours, relevantHours };
        }).filter(Boolean) as (Timesheet & { user: User; totalHours: number, relevantHours: number })[];

    }, [allTimesheets, allEntries, currentUser.id, isManager]);

    const handleApprovalAction = (timesheetId: string, newStatus: TimesheetStatus) => {
        const updatedTimesheet = { 
            status: newStatus, 
            approvedBy: currentUser.id, 
            approvedAt: new Date().toISOString() 
        };
        setAllTimesheets(prev => prev.map(ts => ts.id === timesheetId ? { ...ts, ...updatedTimesheet } : ts));
    };

    const MyTimesheetsView = () => (
        <div className="space-y-6">
            {/* Summary Header */}
            <div className="bg-white dark:bg-gray-800 rounded-lg p-6 border border-gray-200 dark:border-gray-700 shadow-sm flex flex-col md:flex-row items-center justify-between gap-6">
                <div className="flex items-center space-x-6">
                     <div className="flex flex-col items-center justify-center w-16 h-16 rounded-full bg-primary-50 dark:bg-primary-900/30 text-primary-600 dark:text-primary-400 border border-primary-100 dark:border-primary-800">
                        <span className="text-xl font-bold">{weeklyTotal.toFixed(1)}</span>
                        <span className="text-[10px] uppercase font-medium">Hours</span>
                     </div>
                     <div>
                        <h2 className="text-lg font-bold text-gray-900 dark:text-white flex items-center gap-2">
                             Weekly Timesheet
                             <TimesheetStatusBadge status={currentTimesheet.status} />
                        </h2>
                        <div className="flex items-center space-x-2 mt-1">
                            <button onClick={handlePrevWeek} className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded text-gray-500">
                                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
                            </button>
                            <span className="text-sm text-gray-600 dark:text-gray-300 font-medium min-w-[140px] text-center">
                                {weekStartDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} - {weekDates[6].toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
                            </span>
                            <button onClick={handleNextWeek} className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded text-gray-500">
                                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
                            </button>
                            <button onClick={handleJumpToToday} className="text-xs text-primary-600 hover:text-primary-700 font-medium ml-2">
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
                        <div className={`h-full rounded-full ${weeklyTotal >= 40 ? 'bg-green-500' : 'bg-primary-500'}`} style={{ width: `${weeklyUtilization}%` }}></div>
                    </div>
                    {currentTimesheet.status === TimesheetStatus.Draft && (
                         <div className="mt-4">
                            <button 
                                onClick={handleSubmitForApproval}
                                disabled={weeklyTotal === 0}
                                className={`px-4 py-2 text-sm font-medium text-white rounded-md shadow-sm transition-colors ${
                                    weeklyTotal === 0 
                                    ? 'bg-gray-400 cursor-not-allowed' 
                                    : 'bg-primary-600 hover:bg-primary-700'
                                }`}
                            >
                                Submit Timesheet
                            </button>
                         </div>
                    )}
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
                                <th className="px-2 py-4 w-10"></th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                            {uiRows.map(row => {
                                const project = projects.find(p => p.id === row.projectId);
                                const rowTotal = currentWeekEntries
                                    .filter(e => e.projectId === row.projectId && (e.notes || '') === row.notes)
                                    .reduce((sum, e) => sum + e.hours, 0);

                                const isDraft = currentTimesheet.status === TimesheetStatus.Draft;

                                return (
                                    <tr key={row.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors">
                                        <td className="px-6 py-3 whitespace-nowrap">
                                            <div className="text-sm font-medium text-gray-900 dark:text-white">{project?.name || 'Unknown Project'}</div>
                                            <div className="text-xs text-gray-500 dark:text-gray-400">{project?.id}</div>
                                        </td>
                                        <td className="px-4 py-3">
                                            {isDraft ? (
                                                <input 
                                                    type="text" 
                                                    value={row.notes}
                                                    onChange={(e) => handleRowNotesChange(row.id, e.target.value)}
                                                    placeholder="Enter task description..."
                                                    className="w-full text-sm bg-transparent border-b border-transparent hover:border-gray-300 focus:border-primary-500 focus:outline-none py-1 text-gray-700 dark:text-gray-300"
                                                />
                                            ) : (
                                                <span className="text-sm text-gray-600 dark:text-gray-300">{row.notes || '-'}</span>
                                            )}
                                        </td>
                                        {weekDates.map((date, i) => {
                                            const dateStr = formatDate(date);
                                            // Match entry by Project AND Note
                                            const entry = currentWeekEntries.find(e => e.projectId === row.projectId && e.date === dateStr && (e.notes || '') === row.notes);
                                            const isToday = new Date().toDateString() === date.toDateString();
                                            
                                            return (
                                                <td 
                                                    key={i} 
                                                    className={`px-1 py-1 text-center border-l border-transparent ${isToday ? 'bg-primary-50/30 dark:bg-primary-900/10' : ''}`}
                                                >
                                                    {isDraft ? (
                                                        <div className="relative group h-10 w-full">
                                                            <input
                                                                type="number"
                                                                min="0"
                                                                max="24"
                                                                step="0.5"
                                                                className={`w-full h-full text-center text-sm bg-transparent border border-transparent rounded-md focus:bg-white dark:focus:bg-gray-700 focus:border-primary-500 outline-none transition-all ${entry?.hours ? 'font-bold text-gray-900 dark:text-white' : 'font-normal text-gray-500'}`}
                                                                placeholder="-"
                                                                value={entry?.hours || ''}
                                                                onChange={(e) => handleHoursChange(row.projectId, row.notes, date, e.target.value)}
                                                                onFocus={(e) => e.target.select()}
                                                            />
                                                        </div>
                                                    ) : (
                                                        <span className={`text-sm ${entry ? 'font-bold text-gray-900 dark:text-white' : 'text-gray-300 dark:text-gray-600'}`}>
                                                            {entry?.hours || '-'}
                                                        </span>
                                                    )}
                                                </td>
                                            );
                                        })}
                                        <td className="px-4 py-3 text-center text-sm font-bold text-gray-900 dark:text-white bg-gray-50 dark:bg-gray-800 border-l border-gray-200 dark:border-gray-700">
                                            {rowTotal > 0 ? rowTotal.toFixed(2) : '-'}
                                        </td>
                                        <td className="px-2 py-3 text-center">
                                            {isDraft && (
                                                <button onClick={() => handleDeleteRow(row.id)} className="text-gray-300 hover:text-red-500 transition-colors">
                                                    <TrashIcon className="w-4 h-4" />
                                                </button>
                                            )}
                                        </td>
                                    </tr>
                                );
                            })}
                            
                            {/* Add Row Action */}
                             {currentTimesheet.status === TimesheetStatus.Draft && (
                                <tr className="bg-gray-50 dark:bg-gray-800/50 border-t border-gray-200 dark:border-gray-700">
                                    <td colSpan={11} className="px-6 py-3">
                                        <select 
                                            className="text-sm border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:ring-primary-500 focus:border-primary-500 bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-200 py-1.5 pr-8"
                                            onChange={(e) => {
                                                handleAddRow(e.target.value);
                                                e.target.value = '';
                                            }}
                                            value=""
                                        >
                                            <option value="" disabled>+ Add Line Item...</option>
                                            {projects
                                                .filter(p => p.status !== ProjectStatus.CloseOut && p.status !== ProjectStatus.Loss)
                                                .map(p => (
                                                    <option key={p.id} value={p.id}>{p.name} ({p.id})</option>
                                            ))}
                                        </select>
                                    </td>
                                </tr>
                             )}

                            {/* Totals Row */}
                            <tr className="bg-gray-100 dark:bg-gray-700 border-t-2 border-gray-300 dark:border-gray-600 font-bold">
                                <td colSpan={2} className="px-6 py-4 text-xs uppercase tracking-wider text-gray-600 dark:text-gray-300 text-right">Daily Total</td>
                                {weekDates.map((date, i) => {
                                    const dateStr = formatDate(date);
                                    const dayTotal = currentWeekEntries
                                        .filter(e => e.date === dateStr)
                                        .reduce((sum, e) => sum + e.hours, 0);
                                    return (
                                        <td key={i} className="px-2 py-4 text-center text-sm text-gray-900 dark:text-white">
                                            {dayTotal > 0 ? dayTotal.toFixed(2) : '-'}
                                        </td>
                                    );
                                })}
                                <td className="px-4 py-4 text-center text-sm text-primary-700 dark:text-primary-300 bg-gray-200 dark:bg-gray-600">
                                    {weeklyTotal.toFixed(2)}
                                </td>
                                <td></td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </div>
            
             <div className="flex items-start p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg text-sm text-blue-700 dark:text-blue-300">
                <ClipboardDocumentCheckIcon className="w-5 h-5 mr-3 flex-shrink-0" />
                <p>
                    <strong>Tip:</strong> You can add multiple rows for the same project to separate different tasks. Descriptions in the "Task / Notes" column are saved automatically.
                </p>
            </div>
        </div>
    );

    const ApprovalsView = () => (
         <div className="space-y-4">
            <div className="flex items-center justify-between p-4 bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 shadow-sm">
                <div>
                    <h3 className="text-lg font-medium text-gray-900 dark:text-white">Pending Approvals</h3>
                    <p className="text-sm text-gray-500 dark:text-gray-400">Review and approve time submitted by your team.</p>
                </div>
                <div className="text-right">
                     <span className="inline-flex items-center justify-center px-3 py-1 rounded-full text-sm font-medium bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300">
                        {pendingApprovals.length} Pending
                     </span>
                </div>
            </div>

            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                        <thead className="bg-gray-50 dark:bg-gray-700">
                            <tr>
                                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Employee</th>
                                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Period</th>
                                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Project Hours</th>
                                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Total Week</th>
                                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Submitted</th>
                                <th scope="col" className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Actions</th>
                            </tr>
                        </thead>
                        <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                            {pendingApprovals.map((ts) => (
                                <tr key={ts.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors">
                                    <td className="px-6 py-4 whitespace-nowrap">
                                        <div className="flex items-center">
                                            <div className="h-8 w-8 rounded-full bg-primary-100 dark:bg-primary-900 flex items-center justify-center text-primary-600 dark:text-primary-300 font-bold text-xs mr-3">
                                                {ts.user?.name.charAt(0)}
                                            </div>
                                            <div>
                                                <div className="text-sm font-medium text-gray-900 dark:text-white">{ts.user?.name}</div>
                                                <div className="text-xs text-gray-500 dark:text-gray-400">{ts.user?.role}</div>
                                            </div>
                                        </div>
                                    </td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-300">
                                        <div className="flex items-center">
                                            <CalendarDaysIcon className="w-4 h-4 mr-2 text-gray-400" />
                                            Week of {new Date(ts.weekStartDate).toLocaleDateString(undefined, {month:'short', day:'numeric'})}
                                        </div>
                                    </td>
                                    <td className="px-6 py-4 whitespace-nowrap">
                                        <div className="text-sm text-gray-900 dark:text-white font-medium">{ts.relevantHours.toFixed(2)} hrs</div>
                                        <div className="text-xs text-gray-500 dark:text-gray-400">on your projects</div>
                                    </td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-300">
                                         {ts.totalHours.toFixed(2)} hrs
                                    </td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-300">
                                        {ts.submittedAt ? new Date(ts.submittedAt).toLocaleDateString() : '-'}
                                    </td>
                                    <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium space-x-2">
                                        <button onClick={() => handleApprovalAction(ts.id, TimesheetStatus.Approved)} className="text-white bg-green-600 hover:bg-green-700 px-3 py-1.5 rounded-md text-xs shadow-sm transition-colors">Approve</button>
                                        <button onClick={() => handleApprovalAction(ts.id, TimesheetStatus.Rejected)} className="text-gray-700 bg-white border border-gray-300 hover:bg-red-50 hover:text-red-600 hover:border-red-200 dark:bg-gray-700 dark:text-gray-200 dark:border-gray-600 dark:hover:bg-gray-600 px-3 py-1.5 rounded-md text-xs transition-colors">Reject</button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                    {pendingApprovals.length === 0 && (
                        <div className="text-center py-12 flex flex-col items-center">
                             <div className="bg-green-50 dark:bg-green-900/20 p-4 rounded-full mb-3">
                                <CheckCircleIcon className="w-8 h-8 text-green-500" />
                             </div>
                             <p className="text-gray-500 dark:text-gray-400">All caught up! No timesheets pending approval.</p>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );

    return (
        <Card className="min-h-[calc(100vh-140px)]">
            {isManager && (
                <div className="mb-6 border-b border-gray-200 dark:border-gray-700">
                    <nav className="-mb-px flex space-x-8" aria-label="Tabs">
                        {['My Timesheets', 'Approvals'].map((tab) => (
                            <button
                                key={tab}
                                onClick={() => setActiveTab(tab)}
                                className={`${
                                    activeTab === tab
                                        ? 'border-primary-500 text-primary-600 dark:text-primary-400'
                                        : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300 dark:text-gray-400 dark:hover:text-gray-300'
                                } whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm flex items-center transition-colors`}
                            >
                                {tab === 'My Timesheets' ? <TimesheetsIcon className="w-5 h-5 mr-2" /> : <ClipboardDocumentCheckIcon className="w-5 h-5 mr-2" />}
                                {tab}
                                {tab === 'Approvals' && pendingApprovals.length > 0 && <span className="ml-2 bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300 text-xs font-bold px-2 py-0.5 rounded-full">{pendingApprovals.length}</span>}
                            </button>
                        ))}
                    </nav>
                </div>
            )}

            {activeTab === 'My Timesheets' ? <MyTimesheetsView /> : <ApprovalsView />}
        </Card>
    );
};

export default TimesheetsPage;
