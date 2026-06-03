import React, { useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuth } from '@/src/auth/useAuth';
import { useEffectiveRole } from '@/src/auth/impersonation';
import type { Role } from '@/src/auth/AuthContext';
import { UserRole } from '../types';

const Header: React.FC = () => {
  const location = useLocation();
  const { currentUser, signOut } = useAuth();
  const { effectiveRole, canImpersonate, viewAs } = useEffectiveRole();
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);

  const getPageTitle = () => {
    const path = location.pathname;
    if (path === '/') return 'Dashboard';
    const title = path.replace(/^\//, '').replace(/-/g, ' ');
    // Remove query params or IDs simply for title
    return title.split('/')[0].charAt(0).toUpperCase() + title.split('/')[0].slice(1);
  };

  const impersonationRoles = Object.values(UserRole).filter(
    (r) => r !== UserRole.Admin
  ) as Role[];

  const avatarUrl =
    currentUser?.avatar_url ??
    `https://ui-avatars.com/api/?name=${encodeURIComponent(currentUser?.full_name ?? 'User')}`;

  return (
    <header className="flex-shrink-0 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 z-20">
      <div className="flex items-center justify-between p-4 h-20">
        <h1 className="text-xl font-semibold text-gray-800 dark:text-white ml-12 lg:ml-0">
          {getPageTitle()}
        </h1>
        <div className="flex items-center space-x-4">
          {/* Admin-only client-side impersonation (ADR-0008): view-only, does NOT change RLS/server identity. */}
          {canImpersonate && (
            <div className="relative">
              <button
                onClick={() => setIsDropdownOpen(!isDropdownOpen)}
                aria-haspopup="menu"
                aria-expanded={isDropdownOpen}
                className="hidden md:flex items-center space-x-2 px-3 py-2 bg-gray-100 dark:bg-gray-700 rounded-md text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
              >
                <span>
                  View as role: <strong>{effectiveRole}</strong>
                </span>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    d="M19 9l-7 7-7-7"
                  ></path>
                </svg>
              </button>

              {isDropdownOpen && (
                <div
                  role="menu"
                  className="absolute right-0 mt-2 w-48 bg-white dark:bg-gray-800 rounded-md shadow-lg py-1 border border-gray-200 dark:border-gray-700 z-50"
                >
                  {impersonationRoles.map((role) => (
                    <button
                      key={role}
                      role="menuitem"
                      onClick={() => {
                        viewAs(role);
                        setIsDropdownOpen(false);
                      }}
                      className={`block w-full text-left px-4 py-2 text-sm ${
                        effectiveRole === role
                          ? 'bg-primary-50 text-primary-700 dark:bg-gray-700 dark:text-primary-300'
                          : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
                      }`}
                    >
                      {role}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* User Profile */}
          <div className="flex items-center space-x-3 pl-4 border-l border-gray-200 dark:border-gray-600">
            <div className="flex-shrink-0">
              <img
                className="w-10 h-10 rounded-full"
                src={avatarUrl}
                alt={currentUser?.full_name ?? 'User'}
              />
            </div>
            <div className="hidden sm:block">
              <div className="font-semibold text-gray-800 dark:text-white">
                {currentUser?.full_name}
              </div>
              <div className="text-sm text-gray-500 dark:text-gray-400">{effectiveRole}</div>
            </div>
          </div>

          <button
            type="button"
            onClick={() => void signOut()}
            className="px-3 py-2 text-sm rounded-md border border-gray-200 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
          >
            Sign out
          </button>
        </div>
      </div>
    </header>
  );
};

export default Header;
