// Belgian regions and their rental law specifics
export const REGIONS = {
  flanders: {
    name: { en: "Flanders", nl: "Vlaanderen", fr: "Flandre", de: "Flandern" },
    indexationAutomatic: true,
    indexationRequestPeriod: null, // No limit, automatic
    defaultLeaseLength: 9, // years
    // Flanders EPC-based indexation restrictions:
    // - Freeze period Oct 1 2022 – Sep 30 2023 for contracts started before Oct 1, 2022
    // - From Oct 1 2023: correction factor permanently applied to D/E/F/no-EPC contracts started before Oct 1, 2022
    // - From 2028: E/F labels banned from indexation entirely
    // - From 2030: further restrictions
    // - Does NOT apply to student leases
    epcIndexationRestrictions: true,
  },
  wallonia: {
    name: { en: "Wallonia", nl: "Wallonie", fr: "Wallonie", de: "Wallonien" },
    indexationAutomatic: false,
    indexationRequestPeriod: 3, // months after anniversary
    defaultLeaseLength: 9,
    epcIndexationRestrictions: false,
  },
  brussels: {
    name: {
      en: "Brussels",
      nl: "Brussel",
      fr: "Bruxelles",
      de: "Bruessel",
    },
    indexationAutomatic: false,
    indexationRequestPeriod: 3,
    defaultLeaseLength: 9,
    // Brussels has permanent EPC-based indexation restrictions since Oct 2022
    epcIndexationRestrictions: true,
  },
} as const;

// Property types with translations
export const PROPERTY_TYPES = {
  apartment: { en: "Apartment", nl: "Appartement", fr: "Appartement", de: "Wohnung" },
  house: { en: "House", nl: "Huis", fr: "Maison", de: "Haus" },
  studio: { en: "Studio", nl: "Studio", fr: "Studio", de: "Studio" },
  commercial: { en: "Commercial", nl: "Commercieel", fr: "Commercial", de: "Gewerbe" },
  garage: { en: "Garage", nl: "Garage", fr: "Garage", de: "Garage" },
  other: { en: "Other", nl: "Andere", fr: "Autre", de: "Andere" },
} as const;

// Payment reminder escalation defaults (in days after due date)
// Day 0: friendly reminder on the due date
// Day 3: formal reminder
// Day 6: final notice with PDF overview and optional interest
export const REMINDER_DEFAULTS = {
  friendly: 0,
  formal: 3,
  final: 6,
} as const;

// Default annual interest rate for late payments (Belgian legal interest rate)
export const DEFAULT_INTEREST_RATE = 3.75;

// Default administrative fee for late payments (EUR)
export const DEFAULT_LATE_PAYMENT_FEE = 15.0;

// Soft enforcement grace period (days after fee notice to pay without owing the fee)
export const SOFT_ENFORCEMENT_GRACE_DAYS = 7;

// Default days of the month to send landlord payment overview reports
export const DEFAULT_LANDLORD_REPORT_DAYS = [3, 7, 15, 28] as const;

// Balance check schedule (3x per day)
export const BALANCE_CHECK_CRON = [
  "0 0 * * *",   // 00:00
  "0 10 * * *",  // 10:00
  "0 17 * * *",  // 17:00
] as const;

// Default email templates with placeholder variables
export const DEFAULT_EMAIL_TEMPLATES = {
  friendly: {
    subject: "Friendly reminder: rent payment due",
    body: `Dear {{tenantName}},

This is a friendly reminder that your rent payment of {{amount}} for {{propertyName}} was due on {{dueDate}}.

If you have already made this payment, please disregard this message. Otherwise, we kindly ask you to arrange payment at your earliest convenience.

Best regards,
{{ownerName}}`,
  },
  formal: {
    subject: "Payment overdue - action required",
    body: `Dear {{tenantName}},

We have not yet received your rent payment of {{amount}} for {{propertyName}}, which was due on {{dueDate}}. This payment is now {{daysPastDue}} days overdue.

Please arrange payment as soon as possible to avoid further action.

Kind regards,
{{ownerName}}`,
  },
  final: {
    subject: "Final notice: overdue rent payment",
    body: `Dear {{tenantName}},

Despite previous reminders, we have not received your rent payment for {{propertyName}}.

Amount due: {{amount}}
Due date: {{dueDate}}
Days overdue: {{daysPastDue}}
Interest charges: {{interestAmount}}
Administrative fee: {{adminFee}}
Total amount owed: {{totalOwed}}

Please find attached a detailed overview of the outstanding amount.

We urge you to settle this amount immediately. Failure to do so may result in further legal action.

Regards,
{{ownerName}}`,
  },
} as const;

// === EPC-BASED INDEXATION RESTRICTIONS ===
// Both Brussels and Flanders have EPC-based restrictions on rent indexation.
// Wallonia currently has no EPC-based indexation restrictions.

// Brussels: permanent restrictions (since October 14, 2022)
// Determines what percentage of the calculated rent INCREASE can be applied
export const BRUSSELS_EPC_INDEXATION_FACTOR: Record<string, number> = {
  "A++": 1.0,
  "A+": 1.0,
  A: 1.0,
  B: 1.0,
  C: 0.5,   // Only 50% of the calculated increase
  D: 0.75,  // Only 75% of the calculated increase
  E: 0.5,   // Only 50% of the calculated increase
  F: 0.0,   // No indexation allowed
  G: 0.0,   // No indexation allowed
  none: 0.0, // No EPC certificate = no indexation
};

// Flanders: temporary freeze + permanent correction factor
// Only applies to residential leases (NOT student leases) started BEFORE Oct 1, 2022

// Freeze period: Oct 1, 2022 – Sep 30, 2023
export const FLANDERS_EPC_FREEZE_START = "2022-10-01";
export const FLANDERS_EPC_FREEZE_END = "2023-09-30";

// During the freeze period (Oct 2022 – Sep 2023):
export const FLANDERS_EPC_FREEZE_FACTOR: Record<string, number> = {
  "A++": 1.0,
  "A+": 1.0,
  A: 1.0,
  B: 1.0,
  C: 1.0,   // Full indexation allowed
  D: 0.5,   // Only 50% of the increase
  E: 0.0,   // No indexation
  F: 0.0,   // No indexation
  G: 0.0,   // No indexation
  none: 0.0, // No EPC = no indexation
};

// After the freeze (from Oct 1, 2023): indexation allowed again for all labels,
// BUT a correction factor must be applied that excludes the index growth during
// the freeze period. This correction factor is permanent for the contract's lifetime,
// unless a better EPC is obtained or a new contract is signed.
// Labels A+/A/B/C: no correction needed (they were never restricted)
// Labels D/E/F/G/none: correction factor must be applied
export const FLANDERS_EPC_NEEDS_CORRECTION: Record<string, boolean> = {
  "A++": false,
  "A+": false,
  A: false,
  B: false,
  C: false,
  D: true,
  E: true,
  F: true,
  G: true,
  none: true,
};

// Future Flanders restrictions:
// From 2028: E and F labels completely banned from indexation
// From 2030: further restrictions (details TBD by Flemish government)
export const FLANDERS_FUTURE_RESTRICTIONS = {
  2028: { bannedLabels: ["E", "F"] as readonly string[] },
  2030: { bannedLabels: ["D", "E", "F"] as readonly string[] },
} as const;

// EPC scores ordered from best to worst
export const EPC_SCORES = ["A++", "A+", "A", "B", "C", "D", "E", "F", "G"] as const;

// Property manager roles
export const PROPERTY_MANAGER_ROLES = {
  owner: { canManageManagers: true, canManageLeases: true, canManagePayments: true, canViewAll: true },
  co_owner: { canManageManagers: true, canManageLeases: true, canManagePayments: true, canViewAll: true },
  manager: { canManageManagers: false, canManageLeases: true, canManagePayments: true, canViewAll: true },
  accountant: { canManageManagers: false, canManageLeases: false, canManagePayments: true, canViewAll: true },
  viewer: { canManageManagers: false, canManageLeases: false, canManagePayments: false, canViewAll: true },
} as const;

// GoCardless scheme for Belgium
export const GOCARDLESS_SCHEME = "sepa_core" as const;

// Statbel health index API
export const STATBEL_API = {
  baseUrl: "https://statbel.fgov.be",
  healthIndexEndpoint: "/api/healthindex",
} as const;
