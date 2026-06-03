
import React, { createContext, useContext, useState, useEffect } from 'react';
import { User, UserRole } from '../types';
import { users } from '../data/mockData';

interface UserContextType {
    currentUser: User;
    setCurrentUser: (user: User) => void;
    switchRole: (role: UserRole) => void;
}

const UserContext = createContext<UserContextType | undefined>(undefined);

export const UserProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    // Default to Executive (Bob) for first load
    const [currentUser, setCurrentUser] = useState<User>(users.find(u => u.role === UserRole.Executive) || users[0]);

    const switchRole = (role: UserRole) => {
        const user = users.find(u => u.role === role);
        if (user) {
            setCurrentUser(user);
        }
    };

    return (
        <UserContext.Provider value={{ currentUser, setCurrentUser, switchRole }}>
            {children}
        </UserContext.Provider>
    );
};

export const useUser = () => {
    const context = useContext(UserContext);
    if (!context) throw new Error('useUser must be used within a UserProvider');
    return context;
};
