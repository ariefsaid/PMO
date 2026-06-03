
import React, { useState } from 'react';
import { NavLink } from 'react-router-dom';
import { useUser } from '../context/UserContext';
import { UserRole } from '../types';
import { AdminIcon, CompaniesIcon, DashboardIcon, ProcurementIcon, ProjectsIcon, ReportsIcon, TasksIcon, TimesheetsIcon, FunnelIcon } from './icons';

const Sidebar: React.FC = () => {
    const { currentUser } = useUser();
    const [isSidebarOpen, setSidebarOpen] = useState(false);

    const activeLinkClass = "bg-primary-500 text-white";
    const inactiveLinkClass = "text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700";
    const linkBaseClass = "flex items-center p-2 rounded-lg transition-colors duration-200";

    // Navigation configuration based on roles
    const getNavItems = () => {
        const role = currentUser.role;
        const allItems = [
            { to: '/', text: 'Dashboard', icon: DashboardIcon, roles: [UserRole.Executive, UserRole.ProjectManager, UserRole.Finance, UserRole.Engineer, UserRole.Admin] },
            { to: '/projects', text: 'Projects', icon: ProjectsIcon, roles: [UserRole.Executive, UserRole.ProjectManager, UserRole.Finance, UserRole.Engineer, UserRole.Admin] },
            { to: '/sales', text: 'Sales Pipeline', icon: FunnelIcon, roles: [UserRole.Executive, UserRole.ProjectManager, UserRole.Finance, UserRole.Admin] },
            { to: '/procurement', text: 'Procurement', icon: ProcurementIcon, roles: [UserRole.Executive, UserRole.ProjectManager, UserRole.Finance, UserRole.Admin] },
            { to: '/timesheets', text: 'Timesheets', icon: TimesheetsIcon, roles: [UserRole.Executive, UserRole.ProjectManager, UserRole.Engineer, UserRole.Admin] },
            { to: '/tasks', text: 'Tasks', icon: TasksIcon, roles: [UserRole.ProjectManager, UserRole.Engineer, UserRole.Admin] },
            { to: '/companies', text: 'Companies', icon: CompaniesIcon, roles: [UserRole.Executive, UserRole.ProjectManager, UserRole.Finance, UserRole.Admin] },
            { to: '/reports', text: 'Reports', icon: ReportsIcon, roles: [UserRole.Executive, UserRole.ProjectManager, UserRole.Finance, UserRole.Admin] },
        ];

        return allItems.filter(item => item.roles.includes(role));
    };

    const navItems = getNavItems();

    const handleNavClick = () => {
        if (window.innerWidth < 1024) {
            setSidebarOpen(false);
        }
    };

    return (
        <>
            {/* Mobile toggle button */}
            <button onClick={() => setSidebarOpen(!isSidebarOpen)} className="fixed top-4 left-4 z-50 p-2 bg-white dark:bg-gray-800 rounded-md lg:hidden shadow-md">
                <svg className="w-6 h-6 text-gray-800 dark:text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 6h16M4 12h16m-7 6h7"></path></svg>
            </button>
            
            {/* Backdrop for mobile */}
            {isSidebarOpen && (
                <div 
                    className="fixed inset-0 bg-black bg-opacity-50 z-30 lg:hidden"
                    onClick={() => setSidebarOpen(false)}
                ></div>
            )}

            <aside className={`fixed lg:relative z-40 inset-y-0 left-0 w-64 bg-white dark:bg-gray-800 border-r border-gray-200 dark:border-gray-700 transform ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full'} lg:translate-x-0 transition-transform duration-300 ease-in-out`}>
                <div className="flex flex-col h-full">
                    <div className="flex items-center justify-center h-20 border-b border-gray-200 dark:border-gray-700">
                        <h1 className="text-2xl font-bold text-primary-600 dark:text-primary-400">PMO Portal</h1>
                    </div>
                    <nav className="flex-1 p-4 space-y-2 overflow-y-auto">
                        {navItems.map(item => (
                            <NavLink
                                key={item.to}
                                to={item.to}
                                onClick={handleNavClick}
                                className={({ isActive }) =>
                                    `${linkBaseClass} ${isActive ? activeLinkClass : inactiveLinkClass}`
                                }
                                end
                            >
                                <item.icon className="w-6 h-6 mr-3" />
                                <span>{item.text}</span>
                            </NavLink>
                        ))}
                        
                        {(currentUser.role === UserRole.Executive || currentUser.role === UserRole.Admin) && (
                            <div className="pt-4 mt-4 border-t border-gray-200 dark:border-gray-700">
                                <NavLink
                                    to="/administration"
                                    onClick={handleNavClick}
                                    className={({ isActive }) =>
                                        `${linkBaseClass} ${isActive ? activeLinkClass : inactiveLinkClass}`
                                    }
                                >
                                    <AdminIcon className="w-6 h-6 mr-3" />
                                    <span>Administration</span>
                                </NavLink>
                            </div>
                        )}
                    </nav>
                </div>
            </aside>
        </>
    );
};

export default Sidebar;
