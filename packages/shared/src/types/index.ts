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

export type Language = "nl" | "fr" | "de" | "en";

// Belgian structured communication format: +++xxx/xxxx/xxxxx+++
export interface StructuredCommunication {
  raw: string; // 12 digits
  formatted: string; // +++xxx/xxxx/xxxxx+++
}

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
}
