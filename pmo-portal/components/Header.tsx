
import React, { useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useUser } from '../context/UserContext';
import { UserRole } from '../types';

const Header: React.FC = () => {
  const location = useLocation();
  const { currentUser, switchRole } = useUser();
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);

  const getPageTitle = () => {
    const path = location.pathname;
    if (path === '/' || path.includes('__hrp')) return 'Dashboard';
    const title = path.replace(/^\//, '').replace(/-/g, ' ');
    // Remove query params or IDs simply for title
    return title.split('/')[0].charAt(0).toUpperCase() + title.split('/')[0].slice(1);
  };
  
  return (
    <header className="flex-shrink-0 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 z-20">
        <div className="flex items-center justify-between p-4 h-20">
            <h1 className="text-xl font-semibold text-gray-800 dark:text-white ml-12 lg:ml-0">{getPageTitle()}</h1>
            <div className="flex items-center space-x-4">
                {/* Role Switcher for Simulation */}
                <div className="relative">
                    <button 
                        onClick={() => setIsDropdownOpen(!isDropdownOpen)}
                        className="hidden md:flex items-center space-x-2 px-3 py-2 bg-gray-100 dark:bg-gray-700 rounded-md text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
                    >
                        <span>Simulate Role: <strong>{currentUser.role}</strong></span>
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7"></path></svg>
                    </button>
                    
                    {isDropdownOpen && (
                        <div className="absolute right-0 mt-2 w-48 bg-white dark:bg-gray-800 rounded-md shadow-lg py-1 border border-gray-200 dark:border-gray-700 z-50">
                            {Object.values(UserRole).filter(r => r !== UserRole.Admin).map((role) => (
                                <button
                                    key={role}
                                    onClick={() => { switchRole(role); setIsDropdownOpen(false); }}
                                    className={`block w-full text-left px-4 py-2 text-sm ${currentUser.role === role ? 'bg-primary-50 text-primary-700 dark:bg-gray-700 dark:text-primary-300' : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'}`}
                                >
                                    {role}
                                </button>
                            ))}
                        </div>
                    )}
                </div>

                {/* User Profile */}
                <div className="flex items-center space-x-3 pl-4 border-l border-gray-200 dark:border-gray-600">
                    <div className="flex-shrink-0">
                        <img className="w-10 h-10 rounded-full" src={currentUser.avatarUrl} alt={currentUser.name} />
                    </div>
                    <div className="hidden sm:block">
                        <div className="font-semibold text-gray-800 dark:text-white">{currentUser.name}</div>
                        <div className="text-sm text-gray-500 dark:text-gray-400">{currentUser.role}</div>
                    </div>
                </div>
            </div>
        </div>
    </header>
  );
};

export default Header;
