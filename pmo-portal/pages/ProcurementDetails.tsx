
import React, { useState, useEffect } from 'react';
import { useParams, Navigate, Link } from 'react-router-dom';
import Card from '../components/Card';
import ProcurementStatusBadge from '../components/ProcurementStatusBadge';
import ProcurementPipeline from '../components/ProcurementPipeline';
import { procurements, users, companies, projects } from '../data/mockData';
import { BuildingOfficeIcon, UserIcon, CurrencyDollarIcon, CheckCircleIcon, ClipboardDocumentCheckIcon, CalendarDaysIcon } from '../components/icons';
import { Procurement, ProcurementStatus } from '../types';

const formatCurrency = (value: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(value);

const DocumentIcon = ({ type }: { type: string }) => {
    const colorClass = type.includes('Request') ? 'bg-blue-100 text-blue-600 dark:bg-blue-900 dark:text-blue-300' : 
                       type.includes('Order') ? 'bg-orange-100 text-orange-600 dark:bg-orange-900 dark:text-orange-300' : 
                       type.includes('Invoice') ? 'bg-pink-100 text-pink-600 dark:bg-pink-900 dark:text-pink-300' :
                       'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300';
    return (
        <div className={`w-8 h-8 rounded flex items-center justify-center font-bold text-xs ${colorClass}`}>
            {type.split(' ').map(w => w[0]).join('')}
        </div>
    )
}

const StatCard: React.FC<{ label: string; value: React.ReactNode; icon: React.ElementType; subtext?: string }> = ({ label, value, icon: Icon, subtext }) => (
    <div className="bg-white dark:bg-gray-800 rounded-lg p-4 border border-gray-200 dark:border-gray-700 shadow-sm flex items-start space-x-4 transition-all hover:shadow-md">
        <div className="p-2 bg-gray-50 dark:bg-gray-700 rounded-lg">
            <Icon className="w-5 h-5 text-gray-500 dark:text-gray-400" />
        </div>
        <div className="flex-1 min-w-0">
            <p className="text-xs font-medium text-gray-500 dark:text-gray-400 truncate">{label}</p>
            <div className="text-base font-bold text-gray-900 dark:text-white mt-0.5 truncate">{value}</div>
            {subtext && <p className="text-xs text-gray-400 mt-1 truncate">{subtext}</p>}
        </div>
    </div>
);

const ProcurementDetails: React.FC = () => {
    const { procurementId } = useParams<{ procurementId: string }>();
    const [activeTab, setActiveTab] = useState('Worksheet');

    // Initialize state from mock data to allow local mutation for the demo
    const [procurement, setProcurement] = useState<Procurement | undefined>(() => {
        const found = procurements.find(p => p.id === procurementId);
        return found ? JSON.parse(JSON.stringify(found)) : undefined;
    });

    useEffect(() => {
        const found = procurements.find(p => p.id === procurementId);
        setProcurement(found ? JSON.parse(JSON.stringify(found)) : undefined);
    }, [procurementId]);
    
    if (!procurement) {
        return <Navigate to="/procurement" replace />;
    }

    const project = projects.find(p => p.id === procurement.projectId);
    // Derive vendor/user from current state (which might update during selection)
    const vendor = companies.find(c => c.id === procurement.vendorId);
    const requestedBy = users.find(u => u.id === procurement.requestedById);

    const handleSelectQuote = (quoteId: string) => {
        if (!window.confirm("Confirm selection of this quotation? This will update the procurement status to 'Quote Selected'.")) return;

        setProcurement(prev => {
            if (!prev) return prev;
            
            const selectedQuote = prev.quotations.find(q => q.id === quoteId);
            const updatedQuotes = prev.quotations.map(q => ({
                ...q,
                isSelected: q.id === quoteId
            }));

            return {
                ...prev,
                quotations: updatedQuotes,
                status: ProcurementStatus.QuoteSelected,
                // Update header info based on selection
                vendorId: selectedQuote ? selectedQuote.vendorId : prev.vendorId,
                totalValue: selectedQuote ? selectedQuote.totalAmount : prev.totalValue,
            };
        });
    };

    const scrollToQuotes = () => {
        setActiveTab('Worksheet');
        setTimeout(() => {
            const el = document.getElementById('quotations-section');
            if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }, 100);
    };

    // Smart Action Bar Logic
    const getActions = () => {
        const btnBase = "px-4 py-2 rounded-md font-medium shadow-sm transition-colors text-sm focus:outline-none focus:ring-2 focus:ring-offset-2";
        
        switch (procurement.status) {
            case ProcurementStatus.Requested:
                return (
                    <>
                        <button className={`${btnBase} bg-green-600 hover:bg-green-700 text-white focus:ring-green-500`}>
                            Approve Request
                        </button>
                        <button className={`${btnBase} bg-white text-red-600 border border-red-200 hover:bg-red-50 dark:bg-gray-800 dark:border-red-900 dark:text-red-400`}>
                            Reject
                        </button>
                    </>
                );
            case ProcurementStatus.Approved:
                return (
                    <button className={`${btnBase} bg-primary-600 hover:bg-primary-700 text-white focus:ring-primary-500`}>
                        Request Quotes
                    </button>
                );
            case ProcurementStatus.VendorQuoted:
                return (
                    <button 
                        onClick={scrollToQuotes}
                        className={`${btnBase} bg-primary-600 hover:bg-primary-700 text-white focus:ring-primary-500`}
                    >
                        Compare & Select Quote
                    </button>
                );
            case ProcurementStatus.QuoteSelected:
                 return (
                    <button className={`${btnBase} bg-orange-600 hover:bg-orange-700 text-white focus:ring-orange-500`}>
                        Generate Purchase Order
                    </button>
                );
            case ProcurementStatus.Ordered:
                 return (
                    <button className={`${btnBase} bg-teal-600 hover:bg-teal-700 text-white focus:ring-teal-500`}>
                        Receive Goods
                    </button>
                );
            default:
                return (
                     <button className={`${btnBase} bg-white text-gray-700 border border-gray-300 hover:bg-gray-50 dark:bg-gray-800 dark:text-gray-300 dark:border-gray-600 dark:hover:bg-gray-700`}>
                        Actions
                    </button>
                );
        }
    };

    return (
        <div className="h-full flex flex-col space-y-6 pb-12">
            {/* Top Navigation & Header */}
            <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-4">
                <div className="flex-1">
                    <div className="flex items-center gap-2 mb-2">
                        <button onClick={() => window.history.back()} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors">
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 19l-7-7m0 0l7-7m-7 7h18"></path></svg>
                        </button>
                        <nav className="flex text-sm font-medium text-gray-500 dark:text-gray-400">
                             <span>Procurement</span>
                             <span className="mx-2">/</span>
                             <span className="font-mono text-gray-700 dark:text-gray-300">{procurement.id}</span>
                        </nav>
                    </div>
                    <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">{procurement.title}</h1>
                        <ProcurementStatusBadge status={procurement.status} />
                    </div>
                </div>
                
                {/* Action Buttons */}
                <div className="flex flex-wrap gap-2 lg:mt-6">
                    {getActions()}
                </div>
            </div>

            {/* Workflow & Key Stats - Maximized Real Estate */}
            <div className="space-y-4">
                 {/* Full width pipeline */}
                <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4 shadow-sm">
                     <ProcurementPipeline currentStatus={procurement.status} orientation="horizontal" />
                </div>

                {/* Key Metrics Grid - Replaces Sidebar Details */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                     <StatCard 
                        label="Total Value" 
                        value={formatCurrency(procurement.totalValue)} 
                        icon={CurrencyDollarIcon} 
                     />
                     <StatCard 
                        label="Project" 
                        value={project ? <Link to={`/projects/${project.id}`} className="hover:text-primary-600 transition-colors underline decoration-dotted">{project.name}</Link> : 'N/A'} 
                        icon={BuildingOfficeIcon}
                     />
                     <StatCard 
                        label="Vendor" 
                        value={vendor?.name || <span className="text-gray-400 italic font-normal">Pending Selection</span>} 
                        icon={ClipboardDocumentCheckIcon}
                     />
                     <StatCard 
                        label="Requested By" 
                        value={requestedBy?.name || 'Unknown'} 
                        icon={UserIcon}
                        subtext={`on ${new Date(procurement.createdAt).toLocaleDateString()}`}
                     />
                </div>
            </div>

            {/* Main Content Area - Full Width Tabs */}
            <div className="space-y-6">
                <div className="border-b border-gray-200 dark:border-gray-700">
                    <nav className="-mb-px flex space-x-8">
                        {['Worksheet', 'Documents', 'History'].map(tab => (
                            <button
                                key={tab}
                                onClick={() => setActiveTab(tab)}
                                className={`whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm transition-colors ${
                                    activeTab === tab
                                        ? 'border-primary-500 text-primary-600 dark:text-primary-400'
                                        : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300 dark:text-gray-400 dark:hover:text-gray-300'
                                }`}
                            >
                                {tab}
                            </button>
                        ))}
                    </nav>
                </div>

                <div className="min-h-[400px]">
                     {activeTab === 'Worksheet' && (
                        <div className="space-y-6">
                            {/* Items Section - Full Width */}
                            <Card className="overflow-hidden">
                                <div className="flex items-center justify-between mb-4">
                                    <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Request Items</h3>
                                    <span className="bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 text-xs font-medium px-2.5 py-0.5 rounded-full">{procurement.items.length} items</span>
                                </div>
                                <div className="overflow-x-auto -mx-4 sm:-mx-6">
                                    <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                                        <thead className="bg-gray-50 dark:bg-gray-800/50">
                                            <tr>
                                                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Item Details</th>
                                                <th scope="col" className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Quantity</th>
                                                <th scope="col" className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Est. Rate</th>
                                                <th scope="col" className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Amount</th>
                                            </tr>
                                        </thead>
                                        <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                                            {procurement.items.map((item) => (
                                                <tr key={item.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors">
                                                    <td className="px-6 py-4">
                                                        <div className="text-sm font-medium text-gray-900 dark:text-white">{item.name}</div>
                                                        <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">{item.description}</div>
                                                    </td>
                                                    <td className="px-6 py-4 text-right text-sm text-gray-500 dark:text-gray-300">{item.quantity}</td>
                                                    <td className="px-6 py-4 text-right text-sm text-gray-500 dark:text-gray-300">{formatCurrency(item.rate)}</td>
                                                    <td className="px-6 py-4 text-right text-sm font-medium text-gray-900 dark:text-white">{formatCurrency(item.amount)}</td>
                                                </tr>
                                            ))}
                                            <tr className="bg-gray-50 dark:bg-gray-900/50 border-t-2 border-gray-100 dark:border-gray-700">
                                                <td colSpan={3} className="px-6 py-4 text-right text-sm font-medium text-gray-900 dark:text-white">Total Estimated Value</td>
                                                <td className="px-6 py-4 text-right text-lg font-bold text-gray-900 dark:text-white">{formatCurrency(procurement.totalValue)}</td>
                                            </tr>
                                        </tbody>
                                    </table>
                                </div>
                            </Card>

                            {/* Quotations Section - Grid Layout */}
                            {procurement.status !== ProcurementStatus.Draft && procurement.status !== ProcurementStatus.Requested && (
                                <Card>
                                    <div className="flex items-center justify-between mb-6" id="quotations-section">
                                        <div>
                                            <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Vendor Quotations</h3>
                                            <p className="text-sm text-gray-500 dark:text-gray-400">Compare received quotes from suppliers.</p>
                                        </div>
                                        {procurement.status === ProcurementStatus.Approved && (
                                            <button className="inline-flex items-center px-3 py-1.5 border border-primary-600 text-primary-600 dark:text-primary-400 dark:border-primary-400 rounded text-sm font-medium hover:bg-primary-50 dark:hover:bg-primary-900/20 transition-colors">
                                                + Add Quote
                                            </button>
                                        )}
                                    </div>
                                    {procurement.quotations.length > 0 ? (
                                        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
                                            {procurement.quotations.map(quote => {
                                                const qVendor = companies.find(c => c.id === quote.vendorId);
                                                return (
                                                    <div key={quote.id} className={`flex flex-col border rounded-xl p-5 relative transition-all ${quote.isSelected ? 'border-green-500 bg-green-50 dark:bg-green-900/10 dark:border-green-500 shadow-md' : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 hover:border-gray-300 dark:hover:border-gray-600'}`}>
                                                        {quote.isSelected && (
                                                            <div className="absolute -top-3 -right-3 bg-white dark:bg-gray-800 rounded-full p-0.5">
                                                                <CheckCircleIcon className="w-8 h-8 text-green-500" />
                                                            </div>
                                                        )}
                                                        <div className="flex-1">
                                                            <div className="flex justify-between items-start">
                                                                <p className="font-bold text-lg text-gray-900 dark:text-white">{qVendor?.name}</p>
                                                                {quote.isSelected && <span className="text-xs font-bold text-green-700 dark:text-green-400 bg-green-100 dark:bg-green-900/30 px-2 py-1 rounded">Selected</span>}
                                                            </div>
                                                            <p className="text-xs font-mono text-gray-500 dark:text-gray-400 mt-1">Ref: {quote.reference}</p>
                                                            <div className="mt-4 flex items-center text-xs text-gray-500">
                                                                <CalendarDaysIcon className="w-3.5 h-3.5 mr-1"/>
                                                                Received: {new Date(quote.receivedDate).toLocaleDateString()}
                                                            </div>
                                                        </div>
                                                        
                                                        <div className="mt-6 pt-4 border-t border-gray-100 dark:border-gray-700/50 flex justify-between items-end">
                                                            <div>
                                                                <p className="text-xs text-gray-500 uppercase tracking-wide">Quote Total</p>
                                                                <p className="text-xl font-bold text-gray-900 dark:text-white">{formatCurrency(quote.totalAmount)}</p>
                                                            </div>
                                                            {!quote.isSelected && (procurement.status === ProcurementStatus.VendorQuoted || procurement.status === ProcurementStatus.QuoteSelected) && (
                                                                <button 
                                                                    onClick={() => handleSelectQuote(quote.id)}
                                                                    className="text-sm bg-gray-900 text-white dark:bg-white dark:text-gray-900 px-4 py-2 rounded-lg font-medium hover:opacity-90 transition-opacity shadow-sm"
                                                                >
                                                                    Select
                                                                </button>
                                                            )}
                                                        </div>
                                                    </div>
                                                )
                                            })}
                                        </div>
                                    ) : (
                                        <div className="text-center py-10 bg-gray-50 dark:bg-gray-800/50 rounded-xl border border-dashed border-gray-300 dark:border-gray-700">
                                            <div className="mx-auto w-12 h-12 text-gray-400 mb-3">
                                                 <ClipboardDocumentCheckIcon />
                                            </div>
                                            <h3 className="text-sm font-medium text-gray-900 dark:text-white">No quotations yet</h3>
                                            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Request quotes from vendors to start comparing.</p>
                                        </div>
                                    )}
                                </Card>
                            )}
                        </div>
                     )}

                     {activeTab === 'Documents' && (
                        <Card>
                            <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-6">Document Chain</h3>
                            {procurement.documents.length > 0 ? (
                                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                                    {[...procurement.documents].sort((a,b) => new Date(b.date).getTime() - new Date(a.date).getTime()).map((doc) => (
                                        <div key={doc.id} className="flex items-start p-4 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg hover:shadow-md transition-shadow group cursor-pointer">
                                            <div className="mr-4 mt-1">
                                                <DocumentIcon type={doc.type} />
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <div className="flex justify-between items-start">
                                                    <h4 className="text-sm font-bold text-gray-900 dark:text-white truncate pr-2" title={doc.type}>{doc.type}</h4>
                                                    <span className="flex-shrink-0 text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300 font-medium uppercase">{doc.status}</span>
                                                </div>
                                                <p className="text-xs text-primary-600 font-mono mt-1 font-medium group-hover:underline">{doc.referenceNumber}</p>
                                                <p className="text-xs text-gray-500 mt-2 flex items-center">
                                                    <CalendarDaysIcon className="w-3 h-3 mr-1" />
                                                    {new Date(doc.date).toLocaleDateString()}
                                                </p>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <p className="text-center text-gray-500 py-8">No documents generated yet.</p>
                            )}
                        </Card>
                     )}

                     {activeTab === 'History' && (
                         <Card>
                             <div className="text-center py-12">
                                 <div className="inline-block p-4 rounded-full bg-gray-100 dark:bg-gray-800 mb-4">
                                     <svg className="w-8 h-8 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                         <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                                     </svg>
                                 </div>
                                 <h3 className="text-lg font-medium text-gray-900 dark:text-white">Audit Log</h3>
                                 <p className="text-gray-500 dark:text-gray-400 max-w-sm mx-auto mt-2">
                                     Complete history of status changes, approvals, and edits for this procurement request.
                                 </p>
                             </div>
                         </Card>
                     )}
                </div>
            </div>
        </div>
    );
};

export default ProcurementDetails;
