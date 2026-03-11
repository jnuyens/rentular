// Belgian regions and their rental law specifics
export const REGIONS = {
  flanders: {
    name: { en: "Flanders", nl: "Vlaanderen", fr: "Flandre", de: "Flandern" },
    indexationAutomatic: true,
    indexationRequestPeriod: null, // No limit, automatic
    defaultLeaseLength: 9, // years
  },
  wallonia: {
    name: { en: "Wallonia", nl: "Wallonie", fr: "Wallonie", de: "Wallonien" },
    indexationAutomatic: false,
    indexationRequestPeriod: 3, // months after anniversary
    defaultLeaseLength: 9,
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
    // Brussels has EPC-based indexation restrictions since Oct 2022
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
export const REMINDER_DEFAULTS = {
  friendly: 7, // 7 days after due date
  formal: 21, // 21 days after due date
  final: 45, // 45 days after due date - before legal proceedings
} as const;

// GoCardless scheme for Belgium
export const GOCARDLESS_SCHEME = "sepa_core" as const;

// Statbel health index API
export const STATBEL_API = {
  baseUrl: "https://statbel.fgov.be",
  healthIndexEndpoint: "/api/healthindex",
} as const;
