
import React from 'react';
import { HashRouter, Route, Routes } from 'react-router-dom';
import Sidebar from './components/Sidebar';
import Header from './components/Header';
import ExecutiveDashboard from './pages/ExecutiveDashboard';
import Projects from './pages/Projects';
import ProjectDetails from './pages/ProjectDetails';
import SalesPipeline from './pages/SalesPipeline';
import ProcurementPage from './pages/Procurement';
import ProcurementDetails from './pages/ProcurementDetails';
import TimesheetsPage from './pages/Timesheets';
import PlaceholderPage from './pages/PlaceholderPage';
import { UserProvider } from './context/UserContext';

const App: React.FC = () => {
  // Basic dark mode toggle logic
  React.useEffect(() => {
    if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
      document.documentElement.classList.add('dark');
    }
  }, []);

  return (
    <UserProvider>
        <HashRouter>
        <div className="flex h-screen bg-gray-50 dark:bg-gray-900 overflow-hidden">
            <Sidebar />
            <div className="flex-1 flex flex-col overflow-hidden">
            <Header />
            <main className="flex-1 overflow-x-hidden overflow-y-auto bg-gray-100 dark:bg-gray-800 p-4 sm:p-6 lg:p-8">
                <Routes>
                <Route path="/" element={<ExecutiveDashboard />} />
                <Route path="/projects" element={<Projects />} />
                <Route path="/projects/:projectId" element={<ProjectDetails />} />
                <Route path="/sales" element={<SalesPipeline />} />
                <Route path="/procurement" element={<ProcurementPage />} />
                <Route path="/procurement/:procurementId" element={<ProcurementDetails />} />
                <Route path="/timesheets" element={<TimesheetsPage />} />
                <Route path="/tasks" element={<PlaceholderPage title="Tasks" />} />
                <Route path="/companies" element={<PlaceholderPage title="Companies" />} />
                <Route path="/work-orders" element={<PlaceholderPage title="Work Orders" />} />
                <Route path="/reports" element={<PlaceholderPage title="Reports" />} />
                <Route path="/administration" element={<PlaceholderPage title="Administration" />} />
                <Route path="*" element={<ExecutiveDashboard />} />
                </Routes>
            </main>
            </div>
        </div>
        </HashRouter>
    </UserProvider>
  );
};

export default App;
