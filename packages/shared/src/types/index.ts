// Property types
export type PropertyType =
  | "apartment"
  | "house"
  | "studio"
  | "commercial"
  | "garage"
  | "other";

// Lease types (Belgian-specific)
export type LeaseType =
  | "residential_short" // max 3 years
  | "residential_long" // 9 years (standard)
  | "residential_lifetime"
  | "student"
  | "commercial";

export type Region = "flanders" | "wallonia" | "brussels";

export type LeaseStatus = "draft" | "active" | "terminated" | "expired";

export type PaymentStatus =
  | "pending"
  | "processing"
  | "paid"
  | "failed"
  | "cancelled"
  | "refunded";

export type PaymentMethod = "gocardless" | "bank_transfer" | "cash" | "other";

export type ReminderType = "friendly" | "formal" | "final";

export type LatePaymentFeeEnforcement = "soft" | "strict";

export type Language = "nl" | "fr" | "de" | "en";

// Belgian structured communication format: +++xxx/xxxx/xxxxx+++
export interface StructuredCommunication {
  raw: string; // 12 digits
  formatted: string; // +++xxx/xxxx/xxxxx+++
}

// Payment follow-up settings
export interface PaymentFollowUpSettings {
  enabled: boolean;
  friendlyReminderDays: number;
  formalReminderDays: number;
  finalReminderDays: number;
  interestEnabled: boolean;
  annualInterestRate: number;
  friendlySubject: string;
  friendlyBody: string;
  formalSubject: string;
  formalBody: string;
  finalSubject: string;
  finalBody: string;
}

// Email template placeholders
export type TemplatePlaceholder =
  | "tenantName"
  | "amount"
  | "dueDate"
  | "propertyName"
  | "daysPastDue"
  | "interestAmount"
  | "totalOwed"
  | "ownerName";

// Indexation calculation result
export interface IndexationResult {
  leaseId: string;
  baseRent: number;
  baseIndex: number;
  currentIndex: number;
  newRent: number;
  difference: number;
  percentageChange: number;
  effectiveDate: string;
  region: Region;
  // Brussels EPC restriction info (only for Brussels region)
  epcScore?: string;
  epcIndexationFactor?: number; // 0.0 to 1.0
  epcRestricted?: boolean;      // true if indexation was reduced due to EPC
  unrestrictedNewRent?: number;  // What the rent would be without EPC restriction
}

// EPC scores
export type EpcScore = "A++" | "A+" | "A" | "B" | "C" | "D" | "E" | "F" | "G";

// Property manager roles
export type PropertyManagerRole = "owner" | "co_owner" | "manager" | "accountant" | "viewer";

// Bank account
export interface BankAccount {
  id: string;
  ownerId: string;
  label: string;
  iban: string;
  bic?: string;
  holderName: string;
  bankName?: string;
  isDefault: boolean;
}

// Property manager (multi-user access)
export interface PropertyManager {
  id: string;
  propertyId: string;
  userId: string;
  role: PropertyManagerRole;
  invitedBy?: string;
  invitedAt: string;
  acceptedAt?: string;
}
