
export enum ProjectStatus {
  Leads = 'Leads',
  PQSubmitted = 'PQ Submitted',
  QuotationSubmitted = 'Quotation Submitted',
  TenderSubmitted = 'Tender Submitted',
  Negotiation = 'Negotiation', // Added recommendation
  WonPendingKoM = 'Won, Pending KoM',
  Ongoing = 'Ongoing Project',
  OnHold = 'On Hold', // Added recommendation
  CloseOut = 'Close Out',
  Loss = 'Loss Tender',
  Internal = 'Internal Project'
}

export enum CompanyType {
  Internal = 'Internal',
  Client = 'Client',
  Vendor = 'Vendor',
}

export interface Company {
  id: number;
  name: string;
  type: CompanyType;
}

export enum UserRole {
    Executive = 'Executive',
    ProjectManager = 'Project Manager',
    Finance = 'Finance',
    Engineer = 'Engineer',
    Admin = 'Admin'
}

export interface User {
  id: number;
  name: string;
  email: string;
  avatarUrl: string;
  companyId: number;
  role: UserRole;
  // New for Resource Management
  title?: string;
  location?: 'Onshore - HQ' | 'Onshore - Site' | 'Offshore' | 'Remote';
  certifications?: string[]; // e.g. ["BOSIET", "H2S"]
  utilization?: number;
}

export interface Project {
  id: string;
  name: string;
  status: ProjectStatus;
  clientId: number;
  projectManagerId: number;
  contractValue: number;
  budget: number;
  spent: number;
  startDate: string;
  endDate: string;
  lastUpdate: string;
}

export interface Kpi {
    title: string;
    value: string;
    change: string;
    changeType: 'increase' | 'decrease';
    description: string;
}

// Updated for ADR-002: Unified Procurement Lifecycle
export enum ProcurementStatus {
  Draft = 'Draft',
  Requested = 'Requested',
  Approved = 'Approved',
  Rejected = 'Rejected',
  VendorQuoted = 'Vendor Quoted',
  QuoteSelected = 'Quote Selected',
  Ordered = 'Ordered',
  Received = 'Received',
  VendorInvoiced = 'Vendor Invoiced',
  Paid = 'Paid',
  Cancelled = 'Cancelled',
}

export interface ProcurementItem {
    id: string;
    name: string;
    description: string;
    quantity: number;
    rate: number;
    amount: number;
}

export interface ProcurementQuotation {
    id: string;
    vendorId: number;
    reference: string;
    totalAmount: number;
    receivedDate: string;
    isSelected: boolean;
    fileUrl?: string;
}

export interface ProcurementDocument {
    id: string;
    type: 'Purchase Request' | 'Request for Quotation' | 'Supplier Quotation' | 'Purchase Order' | 'Purchase Receipt' | 'Purchase Invoice' | 'Payment Entry';
    referenceNumber: string;
    status: string;
    date: string;
    link?: string;
}

export interface Procurement {
  id: string;
  title: string; // New: Descriptive title for the purchase journey
  projectId?: string; // Optional as per ADR
  requestedById: number;
  status: ProcurementStatus;
  totalValue: number; // Sum of items
  vendorId?: number; // Auto-set from selected quote
  createdAt: string;
  
  // Child Tables
  items: ProcurementItem[];
  quotations: ProcurementQuotation[];
  documents: ProcurementDocument[];
}

export enum BudgetCategory {
    Labor = 'Labor',
    Materials = 'Materials',
    Subcontractors = 'Subcontractors',
    Equipment = 'Equipment',
    Permits = 'Permits & Fees',
    Overheads = 'Overheads',
    Contingency = 'Contingency'
}

export interface BudgetVersion {
  id: string;
  projectId: string;
  version: number;
  name: string;
  createdAt: string;
  status: 'Draft' | 'Active' | 'Archived';
}

export interface BudgetLineItem {
    id: string;
    budgetVersionId: string;
    category: BudgetCategory;
    description: string;
    budgetedAmount: number;
    actualAmount: number;
}

export enum TimesheetStatus {
    Draft = 'Draft',
    Submitted = 'Submitted',
    Approved = 'Approved',
    Rejected = 'Rejected',
}

export interface TimesheetEntry {
    id: string;
    timesheetId: string;
    projectId: string;
    date: string; // YYYY-MM-DD
    hours: number;
    notes: string;
}

export interface Timesheet {
    id: string;
    userId: number;
    weekStartDate: string; // YYYY-MM-DD, always a Monday
    status: TimesheetStatus;
    submittedAt?: string;
    approvedBy?: number;
    approvedAt?: string;
}

export enum TaskStatus {
    ToDo = 'To Do',
    InProgress = 'In Progress',
    Done = 'Done',
    Blocked = 'Blocked',
}

export interface Task {
    id: string;
    projectId: string;
    name: string;
    startDate: string; // YYYY-MM-DD
    endDate: string; // YYYY-MM-DD
    assigneeId: number;
    status: TaskStatus;
    dependencies: string[]; // Array of task IDs
}

// --- NEW TYPES FOR O&G FEATURES ---

export enum IncidentSeverity {
    Low = 'Low',
    Medium = 'Medium',
    High = 'High',
    Critical = 'Critical'
}

export interface HSEIncident {
    id: string;
    date: string;
    type: 'Near Miss' | 'Injury' | 'Property Damage' | 'Environmental' | 'Safety Observation';
    severity: IncidentSeverity;
    location: string;
    description: string;
    status: 'Open' | 'Investigating' | 'Closed';
    reportedBy: string;
}

export interface ProjectDocument {
    id: string;
    projectId: string;
    code: string; // e.g., T-001, RFI-005
    category: 'RFI' | 'Transmittal' | 'Submittal' | 'Drawing' | 'Specification';
    title: string;
    revision: string;
    status: 'Draft' | 'Issued' | 'Approved' | 'Rejected' | 'Closed';
    date: string;
    author: string;
}
