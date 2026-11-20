// Enums still read by the app shell and the timesheet screen. Every other
// prototype-era shape that lived here was superseded by the typed repository
// layer (`src/lib/repositories`) and is gone.
export enum ProjectStatus {
  Leads = 'Leads',
  PQSubmitted = 'PQ Submitted',
  QuotationSubmitted = 'Quotation Submitted',
  TenderSubmitted = 'Tender Submitted',
  Negotiation = 'Negotiation',
  WonPendingKoM = 'Won, Pending KoM',
  Ongoing = 'Ongoing Project',
  OnHold = 'On Hold',
  CloseOut = 'Close Out',
  Loss = 'Loss Tender',
  Declined = 'Declined',
  Internal = 'Internal Project'
}

export enum UserRole {
    Executive = 'Executive',
    ProjectManager = 'Project Manager',
    Finance = 'Finance',
    Engineer = 'Engineer',
    Admin = 'Admin'
}

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

export enum TimesheetStatus {
    Draft = 'Draft',
    Submitted = 'Submitted',
    Approved = 'Approved',
    Rejected = 'Rejected',
}
