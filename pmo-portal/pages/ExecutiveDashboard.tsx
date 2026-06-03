import React from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, LineChart, Line, PieChart, Pie, Cell } from 'recharts';
import Card from '../components/Card';
import { projects, companies, tasks, procurements } from '../data/mockData';
import { ProjectStatus, Kpi, UserRole, TaskStatus, ProcurementStatus } from '../types';
import ProjectStatusBadge from '../components/ProjectStatusBadge';
import { useUser } from '../context/UserContext';

const KpiCard: React.FC<{ kpi: Kpi }> = ({ kpi }) => (
    <Card>
        <div className="flex items-center justify-between">
            <div>
                <p className="text-sm font-medium text-gray-500 dark:text-gray-400 truncate">{kpi.title}</p>
                <p className="text-2xl sm:text-3xl font-bold text-gray-900 dark:text-white">{kpi.value}</p>
            </div>
            <div className={`text-sm font-semibold ${kpi.changeType === 'increase' ? 'text-green-500' : 'text-red-500'}`}>
                {kpi.changeType === 'increase' ? '▲' : '▼'} {kpi.change}
            </div>
        </div>
        <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">{kpi.description}</p>
    </Card>
);

const formatCurrency = (value: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(value);

const EngineerDashboard: React.FC<{ userId: number }> = ({ userId }) => {
    const myTasks = tasks.filter(t => t.assigneeId === userId);
    const activeTasks = myTasks.filter(t => t.status === TaskStatus.InProgress || t.status === TaskStatus.ToDo);
    const completedTasks = myTasks.filter(t => t.status === TaskStatus.Done);
    
    // Mock hours data
    const weeklyHours = [
        { day: 'Mon', hours: 8 },
        { day: 'Tue', hours: 7.5 },
        { day: 'Wed', hours: 8 },
        { day: 'Thu', hours: 9 },
        { day: 'Fri', hours: 8 },
    ];

    return (
        <div className="space-y-6">
             <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                 <Card className="bg-blue-50 dark:bg-blue-900/20 border-l-4 border-blue-500">
                     <p className="text-sm font-medium text-blue-600 dark:text-blue-300">Active Tasks</p>
                     <p className="text-2xl font-bold text-gray-900 dark:text-white">{activeTasks.length}</p>
                 </Card>
                 <Card className="bg-green-50 dark:bg-green-900/20 border-l-4 border-green-500">
                     <p className="text-sm font-medium text-green-600 dark:text-green-300">Completed Tasks</p>
                     <p className="text-2xl font-bold text-gray-900 dark:text-white">{completedTasks.length}</p>
                 </Card>
                 <Card className="bg-purple-50 dark:bg-purple-900/20 border-l-4 border-purple-500">
                     <p className="text-sm font-medium text-purple-600 dark:text-purple-300">Hours This Week</p>
                     <p className="text-2xl font-bold text-gray-900 dark:text-white">40.5</p>
                 </Card>
             </div>

             <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                 <Card>
                     <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">My Active Tasks</h3>
                     <div className="overflow-x-auto">
                         <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                             <thead>
                                 <tr>
                                     <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Task</th>
                                     <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Project</th>
                                     <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Due Date</th>
                                     <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Status</th>
                                 </tr>
                             </thead>
                             <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                                 {activeTasks.slice(0, 5).map(task => (
                                     <tr key={task.id}>
                                         <td className="px-4 py-3 text-sm text-gray-900 dark:text-white font-medium">{task.name}</td>
                                         <td className="px-4 py-3 text-sm text-gray-500 dark:text-gray-400">{projects.find(p => p.id === task.projectId)?.name}</td>
                                         <td className="px-4 py-3 text-sm text-gray-500 dark:text-gray-400">{new Date(task.endDate).toLocaleDateString()}</td>
                                         <td className="px-4 py-3 text-sm"><span className={`px-2 py-0.5 rounded-full text-xs font-medium ${task.status === TaskStatus.InProgress ? 'bg-blue-100 text-blue-800' : 'bg-gray-100 text-gray-800'}`}>{task.status}</span></td>
                                     </tr>
                                 ))}
                             </tbody>
                         </table>
                     </div>
                 </Card>
                 <Card>
                     <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Weekly Hours</h3>
                     <ResponsiveContainer width="100%" height={250}>
                        <BarChart data={weeklyHours}>
                            <CartesianGrid strokeDasharray="3 3" className="stroke-gray-200 dark:stroke-gray-700"/>
                            <XAxis dataKey="day" className="fill-gray-500 dark:fill-gray-400"/>
                            <YAxis className="fill-gray-500 dark:fill-gray-400"/>
                            <Tooltip contentStyle={{ backgroundColor: 'rgba(31, 41, 55, 0.8)', border: 'none' }} cursor={{fill: 'rgba(107, 114, 128, 0.2)'}}/>
                            <Bar dataKey="hours" fill="#8b5cf6" radius={[4, 4, 0, 0]} />
                        </BarChart>
                    </ResponsiveContainer>
                 </Card>
             </div>
        </div>
    );
}

const PMDashboard: React.FC<{ userId: number }> = ({ userId }) => {
    const myProjects = projects.filter(p => p.projectManagerId === userId);

    // Mock Pending Approvals
    const pendingTimesheets = 3;
    const pendingProcurements = 2;

    const projectHealthData = myProjects.map(p => ({
        name: p.id,
        budget: p.budget,
        spent: p.spent
    }));

    return (
        <div className="space-y-6">
             <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
                 <Card>
                     <p className="text-sm font-medium text-gray-500 dark:text-gray-400">My Projects</p>
                     <p className="text-3xl font-bold text-gray-900 dark:text-white">{myProjects.length}</p>
                 </Card>
                 <Card>
                     <p className="text-sm font-medium text-gray-500 dark:text-gray-400">Total Contract Value</p>
                     <p className="text-2xl font-bold text-primary-600">{formatCurrency(myProjects.reduce((s, p) => s + p.contractValue, 0))}</p>
                 </Card>
                  <Card className="bg-yellow-50 dark:bg-yellow-900/20 border-l-4 border-yellow-500">
                     <p className="text-sm font-medium text-yellow-600 dark:text-yellow-300">Pending Approvals</p>
                     <p className="text-2xl font-bold text-gray-900 dark:text-white">{pendingTimesheets + pendingProcurements}</p>
                 </Card>
             </div>
             
             <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                 <Card>
                     <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Budget Health (My Projects)</h3>
                     <ResponsiveContainer width="100%" height={300}>
                        <BarChart data={projectHealthData} layout="vertical">
                            <CartesianGrid strokeDasharray="3 3" className="stroke-gray-200 dark:stroke-gray-700"/>
                            <XAxis type="number" className="fill-gray-500 dark:fill-gray-400" tickFormatter={(val) => `$${val/1000}k`}/>
                            <YAxis dataKey="name" type="category" className="fill-gray-500 dark:fill-gray-400" width={50}/>
                            <Tooltip contentStyle={{ backgroundColor: 'rgba(31, 41, 55, 0.8)', border: 'none' }} cursor={{fill: 'rgba(107, 114, 128, 0.2)'}} formatter={(value:number) => formatCurrency(value)}/>
                            <Legend />
                            <Bar dataKey="budget" fill="#3b82f6" name="Total Budget" radius={[0, 4, 4, 0]} />
                            <Bar dataKey="spent" fill="#ef4444" name="Spent" radius={[0, 4, 4, 0]} />
                        </BarChart>
                    </ResponsiveContainer>
                 </Card>
                 <Card>
                     <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Project Status Overview</h3>
                     <div className="overflow-x-auto">
                        <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                            <thead>
                                <tr>
                                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Project</th>
                                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Status</th>
                                    <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Margin</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                                {myProjects.map(p => {
                                    const margin = ((p.contractValue - p.spent) / p.contractValue) * 100;
                                    return (
                                        <tr key={p.id}>
                                            <td className="px-4 py-3 text-sm text-gray-900 dark:text-white font-medium">{p.name}</td>
                                            <td className="px-4 py-3 text-sm"><ProjectStatusBadge status={p.status} /></td>
                                            <td className={`px-4 py-3 text-sm text-right font-bold ${margin < 10 ? 'text-red-500' : 'text-green-500'}`}>{margin.toFixed(1)}%</td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                     </div>
                 </Card>
             </div>
        </div>
    );
}

const FinanceDashboard: React.FC = () => {
    // Aggregated Data
    const totalRevenue = projects.reduce((acc, p) => acc + p.contractValue, 0);
    const totalSpent = projects.reduce((acc, p) => acc + p.spent, 0);
    const procurementTotal = procurements.reduce((acc, p) => acc + p.totalValue, 0);
    const pendingInvoices = procurements.filter(p => p.status === ProcurementStatus.VendorInvoiced).reduce((acc, p) => acc + p.totalValue, 0);

    const spendByCategory = [
        { name: 'Labor', value: totalSpent * 0.4 },
        { name: 'Materials', value: totalSpent * 0.35 },
        { name: 'Subcontractors', value: totalSpent * 0.15 },
        { name: 'Overheads', value: totalSpent * 0.1 },
    ];
    
    const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444'];

    return (
        <div className="space-y-6">
             <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
                 <Card>
                     <p className="text-sm font-medium text-gray-500 dark:text-gray-400">Total Contracted Revenue</p>
                     <p className="text-2xl font-bold text-green-600 dark:text-green-400">{formatCurrency(totalRevenue)}</p>
                 </Card>
                 <Card>
                     <p className="text-sm font-medium text-gray-500 dark:text-gray-400">Total Project Spend</p>
                     <p className="text-2xl font-bold text-red-600 dark:text-red-400">{formatCurrency(totalSpent)}</p>
                 </Card>
                 <Card>
                     <p className="text-sm font-medium text-gray-500 dark:text-gray-400">Procurement Total</p>
                     <p className="text-2xl font-bold text-blue-600 dark:text-blue-400">{formatCurrency(procurementTotal)}</p>
                 </Card>
                 <Card className="bg-red-50 dark:bg-red-900/20 border-l-4 border-red-500">
                     <p className="text-sm font-medium text-red-600 dark:text-red-300">Outstanding Invoices</p>
                     <p className="text-2xl font-bold text-gray-900 dark:text-white">{formatCurrency(pendingInvoices)}</p>
                 </Card>
             </div>

             <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                 <Card>
                     <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Cost Distribution</h3>
                      <ResponsiveContainer width="100%" height={300}>
                        <PieChart>
                            <Pie
                                data={spendByCategory}
                                cx="50%"
                                cy="50%"
                                innerRadius={60}
                                outerRadius={80}
                                fill="#8884d8"
                                paddingAngle={5}
                                dataKey="value"
                            >
                                {spendByCategory.map((entry, index) => (
                                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                                ))}
                            </Pie>
                            <Tooltip formatter={(value: number) => formatCurrency(value)} contentStyle={{ backgroundColor: 'rgba(31, 41, 55, 0.8)', border: 'none' }} />
                            <Legend />
                        </PieChart>
                    </ResponsiveContainer>
                 </Card>
                 <Card>
                     <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Top 5 Projects by Spend</h3>
                     <div className="overflow-x-auto">
                         <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                             <thead>
                                 <tr>
                                     <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Project</th>
                                     <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Budget</th>
                                     <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Spent</th>
                                     <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Utilization</th>
                                 </tr>
                             </thead>
                             <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                                 {[...projects].sort((a,b) => b.spent - a.spent).slice(0,5).map(p => (
                                     <tr key={p.id}>
                                         <td className="px-4 py-3 text-sm text-gray-900 dark:text-white font-medium">{p.name}</td>
                                         <td className="px-4 py-3 text-sm text-right text-gray-500 dark:text-gray-400">{formatCurrency(p.budget)}</td>
                                         <td className="px-4 py-3 text-sm text-right text-gray-500 dark:text-gray-400">{formatCurrency(p.spent)}</td>
                                         <td className="px-4 py-3 text-sm text-right text-gray-900 dark:text-white font-bold">{((p.spent/p.budget)*100).toFixed(1)}%</td>
                                     </tr>
                                 ))}
                             </tbody>
                         </table>
                     </div>
                 </Card>
             </div>
        </div>
    );
}

const ExecutiveDashboard: React.FC = () => {
    const { currentUser } = useUser();

    // Default Executive View
    const renderExecutiveView = () => {
        const activeProjects = projects.filter(p => p.status === ProjectStatus.Ongoing);
        const totalContractValue = activeProjects.reduce((sum, p) => sum + p.contractValue, 0);
        const avgGrossMargin = activeProjects.length > 0
            ? activeProjects.reduce((sum, p) => sum + (p.budget - p.spent) / p.budget, 0) / activeProjects.length
            : 0;

        const kpis: Kpi[] = [
            { title: 'Active Projects', value: `${activeProjects.length}`, change: '+2', changeType: 'increase', description: 'vs last month' },
            { title: 'Total Contract Value', value: `${(totalContractValue / 1000000).toFixed(1)}M`, change: '+5.2%', changeType: 'increase', description: 'Ongoing projects' },
            { title: 'Average Gross Margin', value: `${(avgGrossMargin * 100).toFixed(1)}%`, change: '-1.1%', changeType: 'decrease', description: 'Based on budget vs spent' },
            { title: 'Projects at Risk', value: '3', change: '+1', changeType: 'increase', description: 'Budget usage > 90%' },
        ];
        
        const pipelineData = Object.values(ProjectStatus).map(status => ({
            name: status,
            count: projects.filter(p => p.status === status).length
        }));
        
        const performanceData = [
          { name: 'Jan', revenue: 4000, spend: 2400 },
          { name: 'Feb', revenue: 3000, spend: 1398 },
          { name: 'Mar', revenue: 2000, spend: 9800 },
          { name: 'Apr', revenue: 2780, spend: 3908 },
          { name: 'May', revenue: 1890, spend: 4800 },
          { name: 'Jun', revenue: 2390, spend: 3800 },
          { name: 'Jul', revenue: 3490, spend: 4300 },
        ];

        const topProjects = [...projects]
            .sort((a, b) => b.contractValue - a.contractValue)
            .slice(0, 5);

        return (
            <div className="space-y-6">
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                    {kpis.map(kpi => <KpiCard key={kpi.title} kpi={kpi} />)}
                </div>

                <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                    <Card>
                        <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Project Pipeline</h3>
                        <ResponsiveContainer width="100%" height={300}>
                            <BarChart data={pipelineData}>
                                <CartesianGrid strokeDasharray="3 3" className="stroke-gray-200 dark:stroke-gray-700"/>
                                <XAxis dataKey="name" fontSize={10} className="fill-gray-500 dark:fill-gray-400" angle={-45} textAnchor="end" height={60} />
                                <YAxis className="fill-gray-500 dark:fill-gray-400"/>
                                <Tooltip contentStyle={{ backgroundColor: 'rgba(31, 41, 55, 0.8)', border: 'none' }} cursor={{fill: 'rgba(107, 114, 128, 0.2)'}}/>
                                <Legend />
                                <Bar dataKey="count" fill="#3b82f6" name="Projects" />
                            </BarChart>
                        </ResponsiveContainer>
                    </Card>
                     <Card>
                        <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Monthly Performance (YTD)</h3>
                        <ResponsiveContainer width="100%" height={300}>
                            <LineChart data={performanceData}>
                                <CartesianGrid strokeDasharray="3 3" className="stroke-gray-200 dark:stroke-gray-700"/>
                                <XAxis dataKey="name" className="fill-gray-500 dark:fill-gray-400"/>
                                <YAxis className="fill-gray-500 dark:fill-gray-400"/>
                                 <Tooltip contentStyle={{ backgroundColor: 'rgba(31, 41, 55, 0.8)', border: 'none' }} cursor={{stroke: 'rgba(107, 114, 128, 0.5)'}}/>
                                <Legend />
                                <Line type="monotone" dataKey="revenue" stroke="#3b82f6" name="Revenue ($k)" />
                                <Line type="monotone" dataKey="spend" stroke="#ef4444" name="Spend ($k)" />
                            </LineChart>
                        </ResponsiveContainer>
                    </Card>
                </div>

                <Card>
                     <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Top Projects by Value</h3>
                    <div className="overflow-x-auto">
                        <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                            <thead className="bg-gray-50 dark:bg-gray-700">
                                <tr>
                                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Project Name</th>
                                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Client</th>
                                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Value</th>
                                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Status</th>
                                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Progress</th>
                                </tr>
                            </thead>
                            <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                                {topProjects.map((project) => {
                                    const progress = project.budget > 0 ? (project.spent / project.budget) * 100 : 0;
                                    return (
                                    <tr key={project.id} className="hover:bg-gray-50 dark:hover:bg-gray-700">
                                        <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900 dark:text-white">{project.name}</td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-300">{companies.find(c => c.id === project.clientId)?.name}</td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-300">{formatCurrency(project.contractValue)}</td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm"><ProjectStatusBadge status={project.status} /></td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-300">
                                            <div className="flex items-center">
                                                <div className="w-24 bg-gray-200 dark:bg-gray-600 rounded-full h-2.5 mr-2">
                                                    <div className="bg-primary-600 h-2.5 rounded-full" style={{ width: `${progress}%` }}></div>
                                                </div>
                                                <span>{Math.round(progress)}%</span>
                                            </div>
                                        </td>
                                    </tr>
                                    )
                                })}
                            </tbody>
                        </table>
                    </div>
                </Card>
            </div>
        );
    };

    switch (currentUser.role) {
        case UserRole.Engineer:
            return <EngineerDashboard userId={currentUser.id} />;
        case UserRole.ProjectManager:
            return <PMDashboard userId={currentUser.id} />;
        case UserRole.Finance:
            return <FinanceDashboard />;
        case UserRole.Executive:
        case UserRole.Admin:
        default:
            return renderExecutiveView();
    }
};

export default ExecutiveDashboard;