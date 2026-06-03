import { Company, Project, User, ProjectStatus, CompanyType, Procurement, ProcurementStatus, BudgetLineItem, BudgetCategory, BudgetVersion, Timesheet, TimesheetEntry, TimesheetStatus, Task, TaskStatus, UserRole, HSEIncident, IncidentSeverity, ProjectDocument } from '../types';

export const companies: Company[] = [
  { id: 1, name: 'Innovate Corp', type: CompanyType.Client },
  { id: 2, name: 'Quantum Solutions', type: CompanyType.Client },
  { id: 3, name: 'Apex Engineering', type: CompanyType.Client },
  { id: 4, name: 'Synergy Supplies', type: CompanyType.Vendor },
  { id: 5, name: 'Internal Engineering', type: CompanyType.Internal },
  { id: 6, name: 'BuildRight Construction', type: CompanyType.Vendor },
  { id: 7, name: 'TechEquip Solutions', type: CompanyType.Vendor },
];

export const users: User[] = [
  { id: 1, name: 'Alice Johnson', email: 'alice@pmoportal.com', avatarUrl: 'https://picsum.photos/id/1027/100/100', companyId: 5, role: UserRole.ProjectManager, title: 'Senior Project Manager', location: 'Onshore - HQ', certifications: ['PMP', 'H2S'], utilization: 85 },
  { id: 2, name: 'Bob Williams', email: 'bob@pmoportal.com', avatarUrl: 'https://picsum.photos/id/1005/100/100', companyId: 5, role: UserRole.Executive, title: 'Operations Director', location: 'Onshore - HQ', certifications: ['MBA'], utilization: 50 },
  { id: 3, name: 'Charlie Brown', email: 'charlie@pmoportal.com', avatarUrl: 'https://picsum.photos/id/1011/100/100', companyId: 5, role: UserRole.Engineer, title: 'Structural Engineer', location: 'Offshore', certifications: ['BOSIET', 'HUET', 'OGUK'], utilization: 95 },
  { id: 4, name: 'Diana Prince', email: 'diana@pmoportal.com', avatarUrl: 'https://picsum.photos/id/1012/100/100', companyId: 5, role: UserRole.Finance, title: 'Finance Controller', location: 'Onshore - HQ', certifications: ['CPA'], utilization: 70 },
  { id: 5, name: 'Ethan Hunt', email: 'ethan@pmoportal.com', avatarUrl: 'https://picsum.photos/id/1025/100/100', companyId: 5, role: UserRole.Engineer, title: 'Process Engineer', location: 'Onshore - Site', certifications: ['HAZOP Leader', 'H2S'], utilization: 90 },
];

export const projects: Project[] = [
  {
    id: 'P001',
    name: 'Innovate Corp Tower',
    status: ProjectStatus.Ongoing,
    clientId: 1,
    projectManagerId: 1,
    contractValue: 5000000,
    budget: 4700000, // Updated for active budget BV002
    spent: 2350000,
    startDate: '2023-01-15',
    endDate: '2025-06-30',
    lastUpdate: '2024-07-20',
  },
  {
    id: 'P002',
    name: 'Quantum Solutions Lab',
    status: ProjectStatus.Ongoing,
    clientId: 2,
    projectManagerId: 1, // Changed to 1 (Alice) to give her more projects for the demo
    contractValue: 7500000,
    budget: 6800000,
    spent: 5150000,
    startDate: '2023-03-01',
    endDate: '2024-12-31',
    lastUpdate: '2024-07-18',
  },
  {
    id: 'P003',
    name: 'Apex Bridge Retrofit',
    status: ProjectStatus.CloseOut,
    clientId: 3,
    projectManagerId: 1,
    contractValue: 2200000,
    budget: 2000000,
    spent: 1950000,
    startDate: '2022-05-20',
    endDate: '2024-05-30',
    lastUpdate: '2024-06-15',
  },
  {
    id: 'P004',
    name: 'Innovate HQ Feasibility',
    status: ProjectStatus.QuotationSubmitted,
    clientId: 1,
    projectManagerId: 3, // Charlie (Engineer) acting as PM for small project
    contractValue: 150000,
    budget: 120000,
    spent: 10000,
    startDate: '2024-06-01',
    endDate: '2024-08-31',
    lastUpdate: '2024-07-10',
  },
  {
    id: 'P005',
    name: 'Synergy Supply Chain Study',
    status: ProjectStatus.Leads,
    clientId: 4, 
    projectManagerId: 1,
    contractValue: 75000,
    budget: 60000,
    spent: 0,
    startDate: '2024-08-01',
    endDate: '2024-10-31',
    lastUpdate: '2024-07-01',
  },
    {
    id: 'P006',
    name: 'Quantum Data Center',
    status: ProjectStatus.WonPendingKoM,
    clientId: 2,
    projectManagerId: 1,
    contractValue: 12000000,
    budget: 10500000,
    spent: 50000,
    startDate: '2024-09-01',
    endDate: '2026-08-31',
    lastUpdate: '2024-07-19',
  },
   {
    id: 'P007',
    name: 'Apex Industrial Park',
    status: ProjectStatus.TenderSubmitted,
    clientId: 3,
    projectManagerId: 3,
    contractValue: 8500000,
    budget: 7800000,
    spent: 1250000,
    startDate: '2024-02-10',
    endDate: '2025-11-20',
    lastUpdate: '2024-07-21',
  },
   {
    id: 'P008',
    name: 'City Metro Expansion',
    status: ProjectStatus.Loss,
    clientId: 1,
    projectManagerId: 1,
    contractValue: 25000000,
    budget: 22000000,
    spent: 25000,
    startDate: '2024-01-01',
    endDate: '2024-03-01',
    lastUpdate: '2024-03-15',
  },
  {
    id: 'P009',
    name: 'Internal R&D: AI Tools',
    status: ProjectStatus.Internal,
    clientId: 5,
    projectManagerId: 3,
    contractValue: 0,
    budget: 50000,
    spent: 12000,
    startDate: '2024-01-01',
    endDate: '2024-12-31',
    lastUpdate: '2024-07-01',
  },
  {
    id: 'P010',
    name: 'Offshore Wind Farm FEED',
    status: ProjectStatus.PQSubmitted,
    clientId: 2,
    projectManagerId: 1,
    contractValue: 450000,
    budget: 380000,
    spent: 5000,
    startDate: '2024-10-01',
    endDate: '2025-01-31',
    lastUpdate: '2024-07-24',
  },
];

export const procurements: Procurement[] = [
  {
    id: 'PROC-2024-001',
    title: 'Structural Steel for Tower',
    projectId: 'P001',
    requestedById: 1,
    status: ProcurementStatus.Received,
    totalValue: 150000,
    vendorId: 4,
    createdAt: '2024-05-10',
    items: [
      { id: 'PI-001', name: 'H-Beam 300x300', description: 'Structural Steel H-Beams', quantity: 200, rate: 500, amount: 100000 },
      { id: 'PI-002', name: 'I-Beam 200x200', description: 'Structural Steel I-Beams', quantity: 250, rate: 200, amount: 50000 },
    ],
    quotations: [
       { id: 'QT-001', vendorId: 4, reference: 'Q-Synergy-001', totalAmount: 150000, receivedDate: '2024-05-15', isSelected: true },
       { id: 'QT-002', vendorId: 6, reference: 'Q-BuildRight-99', totalAmount: 165000, receivedDate: '2024-05-16', isSelected: false }
    ],
    documents: [
      { id: 'PR-001', type: 'Purchase Request', referenceNumber: 'PR-2024-001', status: 'Approved', date: '2024-05-10' },
      { id: 'RFQ-001', type: 'Request for Quotation', referenceNumber: 'RFQ-2024-005', status: 'Completed', date: '2024-05-12' },
      { id: 'PO-001', type: 'Purchase Order', referenceNumber: 'PO-2024-051', status: 'Completed', date: '2024-05-20' },
      { id: 'REC-001', type: 'Purchase Receipt', referenceNumber: 'REC-2024-012', status: 'Completed', date: '2024-06-15' },
    ]
  },
  {
    id: 'PROC-2024-002',
    title: 'HVAC Systems Phase 1',
    projectId: 'P002',
    requestedById: 2,
    status: ProcurementStatus.Ordered,
    totalValue: 220000,
    vendorId: 7,
    createdAt: '2024-06-01',
    items: [
        { id: 'PI-003', name: 'Industrial HVAC Unit', description: 'High capacity filtration', quantity: 5, rate: 44000, amount: 220000 }
    ],
    quotations: [
        { id: 'QT-003', vendorId: 7, reference: 'QT-Tech-2024', totalAmount: 220000, receivedDate: '2024-06-05', isSelected: true }
    ],
    documents: [
        { id: 'PR-002', type: 'Purchase Request', referenceNumber: 'PR-2024-002', status: 'Approved', date: '2024-06-01' },
        { id: 'PO-002', type: 'Purchase Order', referenceNumber: 'PO-2024-055', status: 'Issued', date: '2024-06-10' },
    ]
  },
  {
    id: 'PROC-2024-003',
    title: 'Foundation Concrete',
    projectId: 'P007',
    requestedById: 3,
    status: ProcurementStatus.Paid,
    totalValue: 85000,
    vendorId: 6,
    createdAt: '2024-04-15',
    items: [
        { id: 'PI-004', name: 'Ready Mix Concrete', description: 'Grade 40', quantity: 1000, rate: 85, amount: 85000 }
    ],
    quotations: [],
    documents: [
        // Direct PO Flow (Skipped PR/RFQ)
        { id: 'PO-003', type: 'Purchase Order', referenceNumber: 'PO-2024-030', status: 'Completed', date: '2024-04-18' },
        { id: 'REC-002', type: 'Purchase Receipt', referenceNumber: 'REC-2024-005', status: 'Completed', date: '2024-05-05' },
        { id: 'PINV-001', type: 'Purchase Invoice', referenceNumber: 'PINV-2024-099', status: 'Paid', date: '2024-05-08' },
        { id: 'PAY-001', type: 'Payment Entry', referenceNumber: 'PAY-2024-111', status: 'Completed', date: '2024-06-07' },
    ]
  },
  {
    id: 'PROC-2024-004',
    title: 'Electrical Conduits Bulk',
    projectId: 'P001',
    requestedById: 1,
    status: ProcurementStatus.VendorQuoted,
    totalValue: 0, // Value not set until quote selected
    createdAt: '2024-07-18',
    items: [
        { id: 'PI-005', name: 'PVC Conduit 20mm', description: 'Heavy duty', quantity: 5000, rate: 0, amount: 0 },
        { id: 'PI-006', name: 'Junction Boxes', description: '4-way', quantity: 200, rate: 0, amount: 0 }
    ],
    quotations: [
        { id: 'QT-004', vendorId: 4, reference: 'Q-Syn-Draft', totalAmount: 70000, receivedDate: '2024-07-20', isSelected: false },
        { id: 'QT-005', vendorId: 7, reference: 'Q-Tech-Draft', totalAmount: 72500, receivedDate: '2024-07-21', isSelected: false }
    ],
    documents: [
        { id: 'PR-004', type: 'Purchase Request', referenceNumber: 'PR-2024-010', status: 'Approved', date: '2024-07-18' },
        { id: 'RFQ-002', type: 'Request for Quotation', referenceNumber: 'RFQ-2024-012', status: 'Sent', date: '2024-07-19' }
    ]
  },
    {
    id: 'PROC-2024-005',
    title: 'Lab Calibration Equipment',
    projectId: 'P002',
    requestedById: 2,
    status: ProcurementStatus.Requested,
    totalValue: 25000, // Estimated
    createdAt: '2024-07-21',
    items: [
        { id: 'PI-007', name: 'Precision Scale', description: '0.001g accuracy', quantity: 1, rate: 25000, amount: 25000 }
    ],
    quotations: [],
    documents: [
         { id: 'PR-005', type: 'Purchase Request', referenceNumber: 'PR-2024-015', status: 'Pending Approval', date: '2024-07-21' }
    ]
  },
];

export const budgetVersions: BudgetVersion[] = [
  // Project P001 Versions
  { id: 'BV001', projectId: 'P001', version: 1, name: 'Initial Budget', createdAt: '2023-01-10', status: 'Archived' },
  { id: 'BV002', projectId: 'P001', version: 2, name: 'Revision A - Steel Increase', createdAt: '2024-03-05', status: 'Active' },

  // Project P002 Version
  { id: 'BV003', projectId: 'P002', version: 1, name: 'As-Bid Budget', createdAt: '2023-02-20', status: 'Active' },

  // Project P007 Version
  { id: 'BV004', projectId: 'P007', version: 1, name: 'Initial Approved Budget', createdAt: '2024-02-01', status: 'Active' },
];

export const budgetLineItems: BudgetLineItem[] = [
    // Project P001 - Version 1 (BV001) - Archived
    { id: 'BLI001', budgetVersionId: 'BV001', category: BudgetCategory.Labor, description: 'Project Management & Engineering', budgetedAmount: 600000, actualAmount: 550000 },
    { id: 'BLI002', budgetVersionId: 'BV001', category: BudgetCategory.Materials, description: 'Structural Steel', budgetedAmount: 1500000, actualAmount: 1600000 },
    { id: 'BLI003', budgetVersionId: 'BV001', category: BudgetCategory.Subcontractors, description: 'MEP Systems', budgetedAmount: 1200000, actualAmount: 0 },
    { id: 'BLI004', budgetVersionId: 'BV001', category: BudgetCategory.Equipment, description: 'Crane Rental', budgetedAmount: 200000, actualAmount: 200000 },
    { id: 'BLI005', budgetVersionId: 'BV001', category: BudgetCategory.Permits, description: 'City Building Permits', budgetedAmount: 100000, actualAmount: 0 },
    { id: 'BLI006', budgetVersionId: 'BV001', category: BudgetCategory.Overheads, description: 'Site Office & Utilities', budgetedAmount: 400000, actualAmount: 0 },
    { id: 'BLI007', budgetVersionId: 'BV001', category: BudgetCategory.Contingency, description: 'Project Contingency Fund', budgetedAmount: 500000, actualAmount: 0 },

    // Project P001 - Version 2 (BV002) - Active
    { id: 'BLI001-V2', budgetVersionId: 'BV002', category: BudgetCategory.Labor, description: 'Project Management & Engineering', budgetedAmount: 600000, actualAmount: 550000 },
    { id: 'BLI002-V2', budgetVersionId: 'BV002', category: BudgetCategory.Materials, description: 'Structural Steel', budgetedAmount: 1700000, actualAmount: 1600000 }, // Increased budget
    { id: 'BLI003-V2', budgetVersionId: 'BV002', category: BudgetCategory.Subcontractors, description: 'MEP Systems', budgetedAmount: 1200000, actualAmount: 0 },
    { id: 'BLI004-V2', budgetVersionId: 'BV002', category: BudgetCategory.Equipment, description: 'Crane Rental', budgetedAmount: 200000, actualAmount: 200000 },
    { id: 'BLI005-V2', budgetVersionId: 'BV002', category: BudgetCategory.Permits, description: 'City Building Permits', budgetedAmount: 100000, actualAmount: 0 },
    { id: 'BLI006-V2', budgetVersionId: 'BV002', category: BudgetCategory.Overheads, description: 'Site Office & Utilities', budgetedAmount: 400000, actualAmount: 0 },
    { id: 'BLI007-V2', budgetVersionId: 'BV002', category: BudgetCategory.Contingency, description: 'Project Contingency Fund', budgetedAmount: 500000, actualAmount: 0 },

    // Project P002 - Version 1 (BV003) - Active
    { id: 'BLI008', budgetVersionId: 'BV003', category: BudgetCategory.Labor, description: 'Specialized Technicians', budgetedAmount: 1200000, actualAmount: 1300000 },
    { id: 'BLI009', budgetVersionId: 'BV003', category: BudgetCategory.Materials, description: 'Clean Room Paneling', budgetedAmount: 2500000, actualAmount: 2500000 },
    { id: 'BLI010', budgetVersionId: 'BV003', category: BudgetCategory.Equipment, description: 'HVAC & Filtration Units', budgetedAmount: 1800000, actualAmount: 1350000 },
    { id: 'BLI011', budgetVersionId: 'BV003', category: BudgetCategory.Contingency, description: 'Contingency', budgetedAmount: 1300000, actualAmount: 0 },

    // Project P007 - Version 1 (BV004) - Active
    { id: 'BLI012', budgetVersionId: 'BV004', category: BudgetCategory.Subcontractors, description: 'Earthworks & Grading', budgetedAmount: 2000000, actualAmount: 1000000 },
    { id: 'BLI013', budgetVersionId: 'BV004', category: BudgetCategory.Materials, description: 'Concrete & Rebar', budgetedAmount: 3500000, actualAmount: 250000 },
    { id: 'BLI014', budgetVersionId: 'BV004', category: BudgetCategory.Permits, description: 'Environmental Permits', budgetedAmount: 300000, actualAmount: 0 },
];

export const timesheets: Timesheet[] = [
    // Alice Johnson (User 1) - Project Manager
    { id: 'TS001', userId: 1, weekStartDate: '2024-07-15', status: TimesheetStatus.Approved, approvedBy: 1, approvedAt: '2024-07-22' },
    { id: 'TS002', userId: 1, weekStartDate: '2024-07-22', status: TimesheetStatus.Draft },

    // Bob Williams (User 2) - Project Manager
    { id: 'TS003', userId: 2, weekStartDate: '2024-07-15', status: TimesheetStatus.Approved, approvedBy: 2, approvedAt: '2024-07-23' },
    { id: 'TS004', userId: 2, weekStartDate: '2024-07-22', status: TimesheetStatus.Submitted, submittedAt: '2024-07-29' },

    // Charlie Brown (User 3) - Engineer
    { id: 'TS005', userId: 3, weekStartDate: '2024-07-15', status: TimesheetStatus.Approved, approvedBy: 1, approvedAt: '2024-07-22' },
    { id: 'TS006', userId: 3, weekStartDate: '2024-07-22', status: TimesheetStatus.Submitted, submittedAt: '2024-07-29' },

    // Diana Prince (User 4) - Engineer
    { id: 'TS007', userId: 4, weekStartDate: '2024-07-15', status: TimesheetStatus.Approved, approvedBy: 2, approvedAt: '2024-07-24' },
    { id: 'TS008', userId: 4, weekStartDate: '2024-07-22', status: TimesheetStatus.Draft },
];

export const timesheetEntries: TimesheetEntry[] = [
    // TS001 - Alice, Week of 2024-07-15 (Approved)
    { id: 'TSE001', timesheetId: 'TS001', projectId: 'P001', date: '2024-07-15', hours: 8, notes: 'Project management tasks' },
    { id: 'TSE002', timesheetId: 'TS001', projectId: 'P003', date: '2024-07-16', hours: 8, notes: 'Close-out documentation review' },
    { id: 'TSE003', timesheetId: 'TS001', projectId: 'P001', date: '2024-07-17', hours: 8, notes: 'Client meeting and follow-up' },
    { id: 'TSE004', timesheetId: 'TS001', projectId: 'P003', date: '2024-07-18', hours: 8, notes: 'Final financial reconciliation' },
    { id: 'TSE005', timesheetId: 'TS001', projectId: 'P001', date: '2024-07-19', hours: 8, notes: 'Weekly progress report' },

    // TS002 - Alice, Week of 2024-07-22 (Draft)
    { id: 'TSE006', timesheetId: 'TS002', projectId: 'P001', date: '2024-07-22', hours: 6, notes: 'Coordination with subcontractors' },
    { id: 'TSE007', timesheetId: 'TS002', projectId: 'P008', date: '2024-07-22', hours: 2, notes: 'Loss analysis meeting' },

    // TS005 - Charlie, Week of 2024-07-15 (Approved)
    { id: 'TSE008', timesheetId: 'TS005', projectId: 'P001', date: '2024-07-15', hours: 8, notes: 'Structural design calculations' },
    { id: 'TSE009', timesheetId: 'TS005', projectId: 'P001', date: '2024-07-16', hours: 8, notes: 'CAD drawing updates' },
    { id: 'TSE010', timesheetId: 'TS005', projectId: 'P007', date: '2024-07-17', hours: 8, notes: 'Site visit and inspection report' },
    { id: 'TSE011', timesheetId: 'TS005', projectId: 'P007', date: '2024-07-18', hours: 8, notes: 'Material specifications review' },
    { id: 'TSE012', timesheetId: 'TS005', projectId: 'P004', date: '2024-07-19', hours: 8, notes: 'Feasibility study support' },
    
    // TS006 - Charlie, Week of 2024-07-22 (Submitted)
    { id: 'TSE013', timesheetId: 'TS006', projectId: 'P001', date: '2024-07-22', hours: 8, notes: 'Reviewing steel fabrication drawings.' },
    { id: 'TSE014', timesheetId: 'TS006', projectId: 'P001', date: '2024-07-23', hours: 8, notes: 'Updated foundation plans.' },
    { id: 'TSE015', timesheetId: 'TS006', projectId: 'P007', date: '2024-07-24', hours: 8, notes: 'Coordination meeting with earthworks sub.' },
    { id: 'TSE016', timesheetId: 'TS006', projectId: 'P007', date: '2024-07-25', hours: 8, notes: 'Preparing environmental permit application.' },
    { id: 'TSE017', timesheetId: 'TS006', projectId: 'P001', date: '2024-07-26', hours: 8, notes: 'End-of-week summary.' },

    // TS004 - Bob, Week of 2024-07-22 (Submitted)
    { id: 'TSE018', timesheetId: 'TS004', projectId: 'P002', date: '2024-07-22', hours: 8, notes: 'PM duties for Quantum Lab' },
    { id: 'TSE019', timesheetId: 'TS004', projectId: 'P006', date: '2024-07-23', hours: 8, notes: 'Project kick-off meeting for Data Center' },
    { id: 'TSE020', timesheetId: 'TS004', projectId: 'P002', date: '2024-07-24', hours: 8, notes: 'Vendor negotiation for HVAC units' },
];

export const tasks: Task[] = [
    // Tasks for Project P001 - Innovate Corp Tower
    { id: 'T1-001', projectId: 'P001', name: 'Site Preparation & Earthworks', startDate: '2023-01-20', endDate: '2023-03-10', assigneeId: 3, status: TaskStatus.Done, dependencies: [] },
    { id: 'T1-002', projectId: 'P001', name: 'Foundation Pouring', startDate: '2023-03-11', endDate: '2023-04-25', assigneeId: 4, status: TaskStatus.Done, dependencies: ['T1-001'] },
    { id: 'T1-003', projectId: 'P001', name: 'Structural Steel Erection (Floors 1-10)', startDate: '2023-04-26', endDate: '2023-08-15', assigneeId: 3, status: TaskStatus.Done, dependencies: ['T1-002'] },
    { id: 'T1-004', projectId: 'P001', name: 'Façade Installation (Floors 1-10)', startDate: '2023-08-16', endDate: '2023-11-30', assigneeId: 4, status: TaskStatus.InProgress, dependencies: ['T1-003'] },
    { id: 'T1-005', projectId: 'P001', name: 'MEP Rough-in (Floors 1-10)', startDate: '2023-09-01', endDate: '2023-12-15', assigneeId: 3, status: TaskStatus.InProgress, dependencies: ['T1-003'] },
    { id: 'T1-006', projectId: 'P001', name: 'Interior Finishes (Floors 1-5)', startDate: '2023-12-16', endDate: '2024-03-30', assigneeId: 4, status: TaskStatus.ToDo, dependencies: ['T1-005'] },
    { id: 'T1-007', projectId: 'P001', name: 'Structural Steel Erection (Floors 11-20)', startDate: '2023-08-16', endDate: '2023-12-20', assigneeId: 3, status: TaskStatus.ToDo, dependencies: ['T1-003'] },
    { id: 'T1-008', projectId: 'P001', name: 'Project Planning & Design', startDate: '2023-01-15', endDate: '2023-02-28', assigneeId: 1, status: TaskStatus.Done, dependencies: [] },
    { id: 'T1-009', projectId: 'P001', name: 'Core & Shell Completion', startDate: '2024-01-10', endDate: '2024-05-20', assigneeId: 1, status: TaskStatus.ToDo, dependencies: ['T1-007', 'T1-004'] },
];

// --- MOCK DATA FOR O&G FEATURES ---

export const hseIncidents: HSEIncident[] = [
    { id: 'INC-24-001', date: '2024-06-15', type: 'Near Miss', severity: IncidentSeverity.Low, location: 'Project P001 - Site', description: 'Worker slipped on loose gravel near entrance, no fall occurred.', status: 'Closed', reportedBy: 'Charlie Brown' },
    { id: 'INC-24-002', date: '2024-07-02', type: 'Property Damage', severity: IncidentSeverity.Medium, location: 'Offshore Platform Delta', description: 'Crane swing damaged railing during high wind operations.', status: 'Investigating', reportedBy: 'Site Supervisor' },
    { id: 'INC-24-003', date: '2024-07-20', type: 'Safety Observation', severity: IncidentSeverity.Low, location: 'HQ Office', description: 'Fire extinguisher blocked by delivery boxes in corridor.', status: 'Open', reportedBy: 'Alice Johnson' },
];

export const projectDocuments: ProjectDocument[] = [
    { id: 'DOC-001', projectId: 'P001', code: 'TR-P001-001', category: 'Transmittal', title: 'Structural Drawing Package A', revision: '0', status: 'Issued', date: '2023-04-10', author: 'Charlie Brown' },
    { id: 'DOC-002', projectId: 'P001', code: 'RFI-P001-001', category: 'RFI', title: 'Clarification on Beam Connection', revision: 'A', status: 'Approved', date: '2023-04-15', author: 'Ethan Hunt' }
];